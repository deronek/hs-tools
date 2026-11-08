import { describe, expect, it } from "vitest";

import { createLegClassifier } from "./lib/leg-market.mjs";

function makeClassifier(overrides = {}) {
  return createLegClassifier({
    products: { BAZAAR_ITEM: {} },
    ahNames: { "Mapped Item": "MAPPED_TAG" },
    isAuctionFlagged: (tag) =>
      ["MAPPED_TAG", "UNMAPPED_TAG", "DEAD_TAG"].includes(tag),
    hasLiveMarket: (tag) => tag !== "DEAD_TAG",
    ...overrides,
  });
}

describe("leg classification", () => {
  it("classifies bazaar legs first, even when a Coflnet mapping exists", () => {
    const { classifyLeg } = makeClassifier({
      ahNames: { "Dual Item": "MAPPED_TAG" },
    });
    expect(classifyLeg({ name: "Dual Item", id: "BAZAAR_ITEM" })).toEqual({
      market: "bazaar",
      tag: undefined,
    });
  });

  it("classifies mapped, flagged, live items as auction with their tag", () => {
    const { classifyLeg } = makeClassifier();
    expect(classifyLeg({ name: "Mapped Item", id: null })).toEqual({
      market: "auction",
      tag: "MAPPED_TAG",
    });
  });

  it("blocks on unmapped auction items that have live data", () => {
    const { classifyLeg } = makeClassifier();
    expect(() =>
      classifyLeg({ name: "Unmapped Item", id: "UNMAPPED_TAG" }),
    ).toThrow(/Unmapped Auction House item "Unmapped Item"/);
  });

  it("downgrades flagged-but-dead items to unpriced with a feed-data reason", () => {
    const { classifyLeg, marketReason } = makeClassifier();
    const leg = { name: "Dead Item", id: "DEAD_TAG" };
    expect(classifyLeg(leg)).toBeNull();
    expect(marketReason(leg, "output")).toBe(
      "Output Dead Item is Auction House listed but has no price feed data.",
    );
  });

  it("reports untradeable items as having no market", () => {
    const { classifyLeg, marketReason } = makeClassifier();
    const leg = { name: "Plain Item", id: "PLAIN_TAG" };
    expect(classifyLeg(leg)).toBeNull();
    expect(marketReason(leg, "input")).toBe(
      "Ingredient Plain Item has no market to price (not on the Bazaar or Auction House).",
    );
  });

  it("unmapped items with no live data do not block the update", () => {
    const { classifyLeg } = makeClassifier({ hasLiveMarket: () => false });
    expect(
      classifyLeg({ name: "Unmapped Item", id: "UNMAPPED_TAG" }),
    ).toBeNull();
  });
});
