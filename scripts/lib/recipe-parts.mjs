// Pure classification of recipe parts (each ingredient, and the output),
// shared by build-data.mjs and its tests.
//
// A part prices from the Bazaar when the Bazaar sample carries its product
// (this wins even if the item also has a Coflnet mapping, so items Hypixel
// later adds to the Bazaar switch sides automatically). Otherwise it prices
// from the Auction House when the reviewed name-to-tag mapping has it, the
// catalog flags it AUCTION, and Coflnet has a live price for it. Anything
// else is unpriced. An AUCTION-flagged item with live data but no reviewed
// mapping would be silently mispriced, so it stops the update instead.

export function createPartClassifier({
  products,
  ahNames,
  isAuctionFlagged,
  hasLiveMarket,
}) {
  function classifyPart(part) {
    if (part.id && products[part.id])
      return { market: "bazaar", tag: undefined };
    const tag = ahNames[part.name];
    if (tag && hasLiveMarket(tag)) return { market: "auction", tag };
    const hypixelTag = part.id;
    if (
      !tag &&
      hypixelTag &&
      isAuctionFlagged(hypixelTag) &&
      hasLiveMarket(hypixelTag)
    ) {
      throw new Error(
        `Unmapped Auction House item "${part.name}" (${hypixelTag}): add it to src/data/ah-names.json after verifying the tag, then rerun.`,
      );
    }
    return null;
  }

  function unpricedReason(part, kind) {
    const label = kind === "output" ? "Output" : "Ingredient";
    const flagged =
      (part.id && isAuctionFlagged(part.id)) ||
      isAuctionFlagged(ahNames[part.name] ?? "");
    return flagged
      ? `${label} ${part.name} is listed on the Auction House but has no price data yet.`
      : `${label} ${part.name} has no market to price (not on the Bazaar or Auction House).`;
  }

  return { classifyPart, unpricedReason };
}
