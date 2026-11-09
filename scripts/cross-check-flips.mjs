// Compares this app's Auction House profits against Coflnet's own forge
// calculator (https://sky.coflnet.com/api/flip/forge). Not part of the unit
// test suite; run after `pnpm data:update`: node scripts/cross-check-flips.mjs
//
// For every recipe both tools price, it compares
//   our revenue - our cost   vs   craftData.sellPrice - craftData.craftCost
// using Coflnet's per-ingredient costs for the cost side and the app's fee
// model (imported from src/lib/forge.ts) on the change response's `now`
// price for the revenue side. It also reports `recent` vs craftData.median
// per item, since our stability score relies on those two staying close.
import fs from "node:fs";

import { ahFeeRate } from "../src/lib/forge.ts";
import { percentile } from "./lib/stats.mjs";

const readJson = (file) =>
  JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

const get = async (path) => {
  const response = await fetch(`https://sky.coflnet.com/api/${path}`);
  if (!response.ok) throw new Error(`Coflnet ${path}: HTTP ${response.status}`);
  return response.json();
};

const recipes = readJson("src/data/recipes.json");
const committedChange = readJson("data/raw/coflnet-change.json");

const flips = await get("flip/forge");
const byTag = new Map(
  recipes
    .filter((r) => r.outputMarket === "auction")
    .map((r) => [r.outputTag, r]),
);

// Refetch prices for the tags being compared so both sides come from the
// same minute.
const tags = [...byTag.keys()];
const change = { ...committedChange };
{
  const fresh = await get(`prices/change?itemTags=${tags.join(",")}`);
  for (const [tag, entry] of Object.entries(fresh)) change[tag] = entry;
}

let compared = 0;
const missingPartRecipes = [];
const priceDrifts = [];
const costDrifts = [];
const profitGaps = [];
for (const flip of flips) {
  const recipe = byTag.get(flip.craftData.itemId);
  if (!recipe) continue;
  const entry = change[recipe.outputTag];
  if (!entry?.now) continue;
  compared++;

  const payout = entry.now * recipe.outputQty;
  const ourRevenue = payout * (1 - ahFeeRate(payout));

  const missingParts = [];
  let ourCost = 0;
  for (const ingredient of recipe.ingredients) {
    const tag = ingredient.tag ?? ingredient.id;
    const flipIngredient = flip.craftData.ingredients.find(
      (i) => i.itemId === tag,
    );
    if (!flipIngredient) {
      missingParts.push(`${ingredient.name}: no flip ingredient`);
      continue;
    }
    if (flipIngredient.count !== ingredient.qty)
      missingParts.push(
        `${ingredient.name}: flip count ${flipIngredient.count} vs recipe qty ${ingredient.qty}`,
      );
    // `cost` is already the total for the ingredient's `count` units.
    ourCost += flipIngredient.cost;
  }
  if (missingParts.length > 0)
    missingPartRecipes.push({ recipe: recipe.name, missingParts });

  const craft = flip.craftData;
  const priceDrift = Math.abs(entry.now - craft.sellPrice) / craft.sellPrice;
  const costDrift = Math.abs(ourCost - craft.craftCost) / craft.craftCost;
  priceDrifts.push({ name: recipe.name, drift: priceDrift });
  costDrifts.push({ name: recipe.name, drift: costDrift });
  profitGaps.push({
    name: recipe.name,
    ourRevenue,
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
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const worst = sorted.at(-1);
  console.log(
    `${label}: median ${pct(percentile(sorted, 0.5).drift)}, p90 ${pct(percentile(sorted, 0.9).drift)}, worst ${pct(worst.drift)} (${worst.name})`,
  );
};

console.log(
  `\ncompared ${compared} of ${flips.length} flips against our recipes`,
);
console.log(
  "price-level agreement between our change data and the flipper's fresh estimates:",
);
summarize("output price: now vs sellPrice", priceDrifts);
summarize("cost: per-ingredient sum vs craftCost", costDrifts);

const wideProfit = profitGaps.filter(
  (row) =>
    Math.abs(row.gap) >
    Math.max(0.1 * Math.abs(row.theirProfit), 0.05 * Math.abs(row.ourRevenue)),
);
console.log(
  `profit gap (includes our 2-3% fee wedge and sampling-time drift): ${profitGaps.length - wideProfit.length}/${profitGaps.length} within 10% of the flipper's profit or 5% of revenue`,
);
for (const row of wideProfit)
  console.log(
    `  ${row.name}: ours ${Math.round(row.ourProfit)} vs theirs ${Math.round(row.theirProfit)} (gap ${Math.round(row.gap)})`,
  );
if (missingPartRecipes.length > 0) {
  console.log(`missing ingredients: ${missingPartRecipes.length}`);
  for (const row of missingPartRecipes)
    console.log(`  ${row.recipe}: ${row.missingParts.join("; ")}`);
}

// Check that `recent` tracks the median Coflnet's own calculator uses.
let checked = 0;
const medianDrifts = [];
for (const flip of flips) {
  const entry = change[flip.craftData.itemId];
  const median = flip.craftData.median;
  if (!entry?.recent || !median) continue;
  checked++;
  medianDrifts.push({
    tag: flip.craftData.itemId,
    drift: Math.abs(entry.recent - median) / median,
    recent: entry.recent,
    median,
  });
}
medianDrifts.sort((a, b) => b.drift - a.drift);
const overTwo = medianDrifts.filter((row) => row.drift > 0.02);
for (const row of overTwo)
  console.log(
    `recent/median drift ${row.tag}: recent ${row.recent} vs median ${row.median} (${(row.drift * 100).toFixed(1)}%)`,
  );
console.log(
  `recent ≈ craftData.median within 2% on ${checked - overTwo.length} of ${checked} sampled tags; worst ${medianDrifts.length > 0 ? (medianDrifts[0].drift * 100).toFixed(1) : "0"}%`,
);
