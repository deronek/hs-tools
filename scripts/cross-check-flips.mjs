// Cross-checks this app's AH pricing against Coflnet's own forge flip list
// (https://sky.coflnet.com/api/flip/forge). Not part of the unit test suite;
// run after `pnpm data:update`: node scripts/cross-check-flips.mjs
//
// For every flip on a recipe we support, it compares
//   our revenue - our cost   vs   craftData.sellPrice - craftData.craftCost
// using Coflnet's per-ingredient costs for the cost side and our fee model on
// the change feed's `now` price for the revenue side. It also pins the feed
// semantics by reporting `recent` vs craftData.median per tag.
import fs from "node:fs";

const readJson = (file) =>
  JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

const get = async (path) => {
  const response = await fetch(`https://sky.coflnet.com/api/${path}`);
  if (!response.ok) throw new Error(`Coflnet ${path}: HTTP ${response.status}`);
  return response.json();
};

const recipes = readJson("src/data/recipes.json");
const committedChange = readJson("data/raw/coflnet-change.json");
const AH_CREATION_FEE_RATE = 0.02;
const AH_COLLECTION_TAX_RATE = 0.01;
const AH_COLLECTION_TAX_MIN = 1_000_000;

const flips = await get("flip/forge");
const byTag = new Map(
  recipes
    .filter((r) => r.outputMarket === "auction")
    .map((r) => [r.outputTag, r]),
);

// Refresh the change feed for the tags being compared so both sides of the
// comparison come from the same minute.
const tags = [...byTag.keys()];
const change = { ...committedChange };
{
  const fresh = await get(`prices/change?itemTags=${tags.join(",")}`);
  for (const [tag, entry] of Object.entries(fresh)) change[tag] = entry;
}

let compared = 0;
const legProblemRecipes = [];
const feedDrifts = [];
const costDrifts = [];
const profitGaps = [];
for (const flip of flips) {
  const recipe = byTag.get(flip.craftData.itemId);
  if (!recipe) continue;
  const entry = change[recipe.outputTag];
  if (!entry?.now) continue;
  compared++;

  const payout = entry.now * recipe.outputQty;
  const feeRate =
    AH_CREATION_FEE_RATE +
    (payout >= AH_COLLECTION_TAX_MIN ? AH_COLLECTION_TAX_RATE : 0);
  const ourRevenue = payout * (1 - feeRate);

  const legProblems = [];
  let ourCost = 0;
  for (const ingredient of recipe.ingredients) {
    const tag = ingredient.tag ?? ingredient.id;
    const flipIngredient = flip.craftData.ingredients.find(
      (i) => i.itemId === tag,
    );
    if (!flipIngredient) {
      legProblems.push(`${ingredient.name}: no flip ingredient`);
      continue;
    }
    if (flipIngredient.count !== ingredient.qty)
      legProblems.push(
        `${ingredient.name}: flip count ${flipIngredient.count} vs recipe qty ${ingredient.qty}`,
      );
    // `cost` is already the total for the ingredient's `count` units.
    ourCost += flipIngredient.cost;
  }
  if (legProblems.length > 0)
    legProblemRecipes.push({ recipe: recipe.name, legProblems });

  const craft = flip.craftData;
  const feedDrift = Math.abs(entry.now - craft.sellPrice) / craft.sellPrice;
  const costDrift = Math.abs(ourCost - craft.craftCost) / craft.craftCost;
  feedDrifts.push({ name: recipe.name, drift: feedDrift });
  costDrifts.push({ name: recipe.name, drift: costDrift });
  profitGaps.push({
    name: recipe.name,
    ourProfit: ourRevenue - ourCost,
    theirProfit: craft.sellPrice - craft.craftCost,
    gap: ourRevenue - ourCost - (craft.sellPrice - craft.craftCost),
  });
}

const summarize = (label, rows) => {
  if (rows.length === 0) {
    console.log(`${label}: nothing to compare`);
    return;
  }
  const sorted = [...rows].sort((a, b) => a.drift - b.drift);
  const pick = (p) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const worst = sorted.at(-1);
  console.log(
    `${label}: median ${pct(pick(0.5).drift)}, p90 ${pct(pick(0.9).drift)}, worst ${pct(worst.drift)} (${worst.name})`,
  );
};

console.log(
  `\ncompared ${compared} of ${flips.length} flips against our recipes`,
);
console.log(
  "price-level agreement between our change feed and the flipper's fresh estimates:",
);
summarize("output price: now vs sellPrice", feedDrifts);
summarize("cost: per-ingredient sum vs craftCost", costDrifts);

const wideProfit = profitGaps.filter(
  (row) =>
    Math.abs(row.gap) >
    Math.max(0.1 * Math.abs(row.theirProfit), 0.05 * Math.abs(row.ourProfit)),
);
console.log(
  `profit gap (includes our 2-3% fee wedge and sampling-time drift): ${profitGaps.length - wideProfit.length}/${profitGaps.length} within 10% of the flipper's profit or 5% of revenue`,
);
for (const row of wideProfit)
  console.log(
    `  ${row.name}: ours ${Math.round(row.ourProfit)} vs theirs ${Math.round(row.theirProfit)} (gap ${Math.round(row.gap)})`,
  );
if (legProblemRecipes.length > 0) {
  console.log(`leg problems: ${legProblemRecipes.length}`);
  for (const row of legProblemRecipes)
    console.log(`  ${row.recipe}: ${row.legProblems.join("; ")}`);
}

// Feed-semantics pin: `recent` should track Coflnet's flipper median.
let pinned = 0;
const pinDrifts = [];
for (const flip of flips) {
  const entry = change[flip.craftData.itemId];
  const median = flip.craftData.median;
  if (!entry?.recent || !median) continue;
  pinned++;
  pinDrifts.push({
    tag: flip.craftData.itemId,
    drift: Math.abs(entry.recent - median) / median,
    recent: entry.recent,
    median,
  });
}
pinDrifts.sort((a, b) => b.drift - a.drift);
const overTwo = pinDrifts.filter((row) => row.drift > 0.02);
for (const row of overTwo)
  console.log(
    `recent/median drift ${row.tag}: recent ${row.recent} vs median ${row.median} (${(row.drift * 100).toFixed(1)}%)`,
  );
console.log(
  `recent ≈ craftData.median within 2% on ${pinned - overTwo.length} of ${pinned} sampled tags; worst ${pinDrifts.length > 0 ? (pinDrifts[0].drift * 100).toFixed(1) : "0"}%`,
);
