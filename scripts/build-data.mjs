import fs from "node:fs";
import prettier from "prettier";

import { createLegClassifier } from "./lib/leg-market.mjs";

const root = process.cwd();
const readJson = (file) =>
  JSON.parse(fs.readFileSync(`${root}/${file}`, "utf8").replace(/^\uFEFF/, ""));
const raw = readJson("data/raw/recipes-raw.json");
const bazaar = readJson("data/raw/bazaar-sample.json");
const products = bazaar.products;
const coflnetItems = readJson("data/raw/coflnet-items.json");
const change = readJson("data/raw/coflnet-change.json");
const ahNames = readJson("src/data/ah-names.json");

const units = {
  day: 86400,
  days: 86400,
  hour: 3600,
  hours: 3600,
  minute: 60,
  minutes: 60,
  second: 1,
  seconds: 1,
};

function parseDuration(text) {
  let total = 0;
  for (const match of text.matchAll(
    /(\d+)\s*(day|days|hour|hours|minute|minutes|second|seconds)/gi,
  )) {
    total += Number(match[1]) * units[match[2].toLowerCase()];
  }
  return total;
}

const flagsByTag = new Map(
  coflnetItems.map((item) => [
    item.tag,
    (item.flags ?? "NONE")
      .split(",")
      .map((flag) => flag.trim())
      .filter(Boolean),
  ]),
);

const isAuctionFlagged = (tag) =>
  (flagsByTag.get(tag) ?? []).includes("AUCTION");

const hasLiveMarket = (tag) =>
  isAuctionFlagged(tag) && (change[tag]?.now > 0 || change[tag]?.recent > 0);

const { classifyLeg, marketReason } = createLegClassifier({
  products,
  ahNames,
  isAuctionFlagged,
  hasLiveMarket,
});

const recipes = raw.map((recipe) => {
  const reasons = [];

  const outputLeg = { name: recipe.name, id: recipe.outputId };
  let outputMarket = null;
  let outputTag;
  if (!recipe.outputId) {
    reasons.push(
      "Output has no Hypixel item ID, so it cannot be matched to a priced market.",
    );
  } else {
    const classified = classifyLeg(outputLeg);
    if (classified) {
      outputMarket = classified.market;
      outputTag = classified.tag;
    } else {
      reasons.push(marketReason(outputLeg, "output"));
    }
  }

  const legs = recipe.ingredients.map((ingredient) => {
    if (ingredient.name === "Coins") {
      reasons.push("Requires a direct coin payment.");
      return { ...ingredient, market: null, tag: undefined };
    }
    const classified = classifyLeg(ingredient);
    if (!classified) {
      reasons.push(marketReason(ingredient, "input"));
      return { ...ingredient, market: null, tag: undefined };
    }
    return { ...ingredient, ...classified };
  });

  if (recipe.ingredients.length === 0)
    reasons.push("No direct ingredients were parsed.");
  const unique = [...new Set(reasons)];

  return {
    section: recipe.section,
    name: recipe.name,
    outputId: recipe.outputId,
    outputQty: recipe.outputQty,
    durationText: recipe.durationText,
    durationSeconds: parseDuration(recipe.durationText),
    hotm: recipe.hotm,
    outputMarket,
    outputTag,
    ingredients: legs.map(({ name, qty, id, market, tag }) => ({
      name,
      qty,
      id,
      market,
      tag,
    })),
    isSupported: unique.length === 0,
    reason: unique.length
      ? unique.join(" ")
      : outputMarket === "auction" || legs.some((l) => l.market === "auction")
        ? "Prices from the Auction House."
        : "Direct bazaar inputs and bazaar output.",
  };
});

const appRecipes = recipes
  .filter((recipe) => recipe.isSupported)
  .map((recipe) => ({
    section: recipe.section,
    name: recipe.name,
    outputId: recipe.outputId,
    outputQty: recipe.outputQty,
    durationSeconds: recipe.durationSeconds,
    hotm: recipe.hotm,
    outputMarket: recipe.outputMarket,
    ...(recipe.outputTag ? { outputTag: recipe.outputTag } : {}),
    ingredients: recipe.ingredients.map(({ name, qty, id, market, tag }) => ({
      name,
      qty,
      id,
      market,
      ...(tag ? { tag } : {}),
    })),
  }));

// Every supported auction leg must carry its tag into the snapshot.
for (const recipe of appRecipes) {
  if (recipe.outputMarket === "auction" && !recipe.outputTag)
    throw new Error(`Auction output without tag: ${recipe.name}`);
  for (const ingredient of recipe.ingredients) {
    if (ingredient.market === "auction" && !ingredient.tag)
      throw new Error(`Auction ingredient without tag: ${recipe.name}`);
    if (!["bazaar", "auction"].includes(ingredient.market))
      throw new Error(`Unclassified leg in supported recipe: ${recipe.name}`);
  }
}

fs.mkdirSync(`${root}/src/data`, { recursive: true });
fs.writeFileSync(
  `${root}/src/data/recipes.json`,
  JSON.stringify(appRecipes, null, 2) + "\n",
);

const supported = recipes.filter((recipe) => recipe.isSupported).length;
const rows = recipes
  .map(
    (recipe) =>
      `| ${recipe.section} | ${recipe.name} | ${recipe.durationText} | ${recipe.isSupported ? "In app" : "Excluded"} | ${recipe.reason.replaceAll("|", "\\|")} |`,
  )
  .join("\n");

const docs = `# Recipe coverage

The app snapshot contains ${supported} supported recipes from ${recipes.length} recipes on the wiki. A recipe is supported when its output and every direct ingredient have a market price: a Bazaar product or an Auction House item priced through the Coflnet API. Recipes with direct coin costs or without Hypixel item IDs (pets) stay excluded. This report lists every recipe and the reason each excluded one is unsupported.

The excluded recipes need coin-cost support, Coflnet identity work for pets, or a market for an untradeable item.

| Section | Recipe | Duration | Status | Why |
| --- | --- | --- | --- | --- |
${rows}
`;

fs.mkdirSync(`${root}/docs`, { recursive: true });
const prettierOptions = await prettier.resolveConfig(`${root}/docs/recipes.md`);
const formattedDocs = await prettier.format(docs, {
  ...prettierOptions,
  filepath: `${root}/docs/recipes.md`,
});
fs.writeFileSync(`${root}/docs/recipes.md`, formattedDocs);

// Coverage report: every recipe lands in exactly one bucket.
const sectionStats = Object.groupBy(recipes, (recipe) => recipe.section);
for (const [section, sectionRecipes] of Object.entries(sectionStats)) {
  const inApp = sectionRecipes.filter((r) => r.isSupported).length;
  console.log(
    `${section}: ${inApp} in app, ${sectionRecipes.length - inApp} excluded`,
  );
}

const excluded = recipes.filter((recipe) => !recipe.isSupported);
const coin = excluded.filter((r) => r.reason.includes("coin payment")).length;
const noId = excluded.filter((r) =>
  r.reason.includes("no Hypixel item ID"),
).length;
const noMarket = excluded.filter((r) =>
  r.reason.includes("no market to price"),
).length;
console.log(
  `coverage ${supported}/${recipes.length} in app; excluded: ${coin} coin cost, ${noId} no item ID (pets), ${noMarket} no market`,
);

// Calibration print for the AH stability clip constant: relative drift
// between the current price and the recent-window typical price.
const drifts = appRecipes
  .flatMap((recipe) =>
    [recipe.outputMarket === "auction" ? recipe.outputTag : null]
      .concat(
        recipe.ingredients
          .filter((l) => l.market === "auction")
          .map((l) => l.tag),
      )
      .filter(Boolean),
  )
  .filter((tag, index, tags) => tags.indexOf(tag) === index)
  .map((tag) => {
    const entry = change[tag];
    return entry?.now > 0 && entry?.recent > 0
      ? Math.abs(entry.now - entry.recent) / entry.recent
      : null;
  })
  .filter((drift) => drift != null)
  .sort((a, b) => a - b);
if (drifts.length > 0) {
  const percentile = (p) =>
    drifts[Math.min(drifts.length - 1, Math.floor(p * drifts.length))];
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  console.log(
    `AH now-vs-recent drift p50 ${pct(percentile(0.5))}, p90 ${pct(percentile(0.9))}, p99 ${pct(percentile(0.99))}, max ${pct(drifts.at(-1))} over ${drifts.length} tags`,
  );
}
