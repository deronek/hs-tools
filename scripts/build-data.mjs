import fs from "node:fs";
import prettier from "prettier";

const root = process.cwd();
const readJson = (file) =>
  JSON.parse(fs.readFileSync(`${root}/${file}`, "utf8").replace(/^\uFEFF/, ""));
const raw = readJson("data/raw/recipes-raw.json");
const bazaar = readJson("data/raw/bazaar-sample.json");
const products = bazaar.products;

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

const recipes = raw.map((recipe) => {
  const reasons = [];
  if (!recipe.outputId) {
    reasons.push(
      "Output has no Hypixel item ID, so it cannot be matched to a bazaar product.",
    );
  } else if (!products[recipe.outputId]) {
    reasons.push(
      "Output is not bazaar-tradeable; it needs Auction House pricing.",
    );
  }

  for (const ingredient of recipe.ingredients) {
    if (ingredient.name === "Coins") {
      reasons.push("Requires a direct coin payment.");
    } else if (!ingredient.id) {
      reasons.push(`Ingredient ${ingredient.name} has no Hypixel item ID.`);
    } else if (!products[ingredient.id]) {
      reasons.push(`Ingredient ${ingredient.name} is not bazaar-tradeable.`);
    }
  }

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
    ingredients: recipe.ingredients.map(({ name, qty, id }) => ({
      name,
      qty,
      id,
    })),
    isSimple: unique.length === 0,
    reason: unique.length
      ? unique.join(" ")
      : "Direct bazaar inputs and bazaar output.",
  };
});

const appRecipes = recipes
  .filter((recipe) => recipe.isSimple)
  .map((recipe) => ({
    section: recipe.section,
    name: recipe.name,
    outputId: recipe.outputId,
    outputQty: recipe.outputQty,
    durationSeconds: recipe.durationSeconds,
    hotm: recipe.hotm,
    ingredients: recipe.ingredients,
  }));

fs.mkdirSync(`${root}/src/data`, { recursive: true });
fs.writeFileSync(
  `${root}/src/data/recipes.json`,
  JSON.stringify(appRecipes, null, 2),
);

const simple = recipes.filter((recipe) => recipe.isSimple).length;
const rows = recipes
  .map(
    (recipe) =>
      `| ${recipe.section} | ${recipe.name} | ${recipe.durationText} | ${recipe.isSimple ? "Simple" : "Complex"} | ${recipe.reason.replaceAll("|", "\\|")} |`,
  )
  .join("\n");

const docs = `# Recipe coverage

The app snapshot contains ${simple} supported recipes from ${recipes.length} recipes on the wiki. A recipe is supported when its output and every direct ingredient have a bazaar product, with no coin cost or missing item ID. This report lists the excluded recipes and the reason for each exclusion.

The excluded recipes need Auction House pricing, support for crafted ingredients, coin-cost handling, or item IDs for pets and pet items.

| Section | Recipe | Duration | PoC status | Why |
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

console.log(
  `recipes ${recipes.length}, simple ${simple}, complex ${recipes.length - simple}`,
);
