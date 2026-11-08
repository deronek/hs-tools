// Pure leg classification shared by build-data.mjs and its tests.
//
// A leg is "bazaar" when the Bazaar sample carries its product (this wins even
// if the item also has a Coflnet mapping, so items Hypixel later adds to the
// Bazaar flip sides automatically). Otherwise it is "auction" when the
// reviewed name-to-tag mapping has it, the catalog flags it AUCTION, and the
// change feed has a live price. Anything else is unpriced. An AUCTION-flagged
// item with live data but no reviewed mapping would be silently mispriced, so
// it stops the update instead.

export function createLegClassifier({
  products,
  ahNames,
  isAuctionFlagged,
  hasLiveMarket,
}) {
  function classifyLeg(leg) {
    if (leg.id && products[leg.id]) return { market: "bazaar", tag: undefined };
    const tag = ahNames[leg.name];
    if (tag && hasLiveMarket(tag)) return { market: "auction", tag };
    const hypixelTag = leg.id;
    if (
      !tag &&
      hypixelTag &&
      isAuctionFlagged(hypixelTag) &&
      hasLiveMarket(hypixelTag)
    ) {
      throw new Error(
        `Unmapped Auction House item "${leg.name}" (${hypixelTag}): add it to src/data/ah-names.json after verifying the tag, then rerun.`,
      );
    }
    return null;
  }

  function marketReason(leg, kind) {
    const label = kind === "output" ? "Output" : "Ingredient";
    const flagged =
      (leg.id && isAuctionFlagged(leg.id)) ||
      isAuctionFlagged(ahNames[leg.name] ?? "");
    return flagged
      ? `${label} ${leg.name} is Auction House listed but has no price feed data.`
      : `${label} ${leg.name} has no market to price (not on the Bazaar or Auction House).`;
  }

  return { classifyLeg, marketReason };
}
