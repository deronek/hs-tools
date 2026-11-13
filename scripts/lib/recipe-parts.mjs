// Pure classification of recipe parts (each ingredient, and the output),
// shared by build-data.mjs and its tests.
//
// A part prices from the Bazaar when the Bazaar sample carries its product
// (this wins even if the item also has a Coflnet mapping, so items Hypixel
// later adds to the Bazaar switch sides automatically). Otherwise it prices
// from the Auction House when the reviewed name-to-tag mapping has it and
// Coflnet has a live price for it. Anything else is excluded with a code.
// An AUCTION-flagged item with live data but no reviewed mapping would be
// silently mispriced, so it stops the update instead.

/**
 * @returns {{ market: "bazaar", tag: undefined }
 *   | { market: "auction", tag: string }
 *   | { excluded: "coin-cost" | "no-price-data" | "no-market" }}
 */
export function createPartClassifier({
  products,
  ahNames,
  isAuctionFlagged,
  hasLiveMarket,
}) {
  function classifyPart(part) {
    if (part.name === "Coins") return { excluded: "coin-cost" };
    if (part.id && products[part.id])
      return { market: "bazaar", tag: undefined };
    const tag = ahNames[part.name];
    if (tag && hasLiveMarket(tag)) return { market: "auction", tag };
    if (isAuctionFlagged(part.id ?? "") || isAuctionFlagged(tag ?? "")) {
      if (!tag && part.id && hasLiveMarket(part.id)) {
        throw new Error(
          `Unmapped Auction House item "${part.name}" (${part.id}): add it to src/data/ah-names.json after verifying the tag, then rerun.`,
        );
      }
      return { excluded: "no-price-data" };
    }
    return { excluded: "no-market" };
  }

  return { classifyPart };
}

/** Report message for each exclusion code. */
export const EXCLUSION_MESSAGES = {
  "coin-cost": () => "Requires a direct coin payment.",
  "no-item-id": (label) =>
    `${label} has no Hypixel item ID, so it cannot be matched to a priced market.`,
  "no-price-data": (label, name) =>
    `${label} ${name} is listed on the Auction House but has no price data yet.`,
  "no-market": (label, name) =>
    `${label} ${name} has no market to price (not on the Bazaar or Auction House).`,
  "no-ingredients": () => "No direct ingredients were parsed.",
};

/**
 * Priority order assigning each excluded recipe to exactly one coverage
 * bucket when several exclusion codes apply.
 */
export const EXCLUSION_BUCKET_ORDER = [
  "no-item-id",
  "coin-cost",
  "no-price-data",
  "no-market",
];

/**
 * Every Coflnet tag the change payload must cover: the reviewed mappings
 * plus every recipe part the catalog flags AUCTION, mapped or not. Without
 * the unmapped parts, build-data's unmapped-item guard can never fire, and
 * newly added mappings go stale until the raw file is deleted.
 */
export function neededChangeTags(recipes, ahNames, auctionFlags) {
  const tags = new Set(Object.values(ahNames));
  for (const recipe of recipes) {
    for (const part of [{ id: recipe.outputId }, ...recipe.ingredients]) {
      if (part.id && auctionFlags.has(part.id)) tags.add(part.id);
    }
  }
  return [...tags].sort();
}
