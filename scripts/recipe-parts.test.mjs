import { describe, expect, it } from "vitest";

import { createPartClassifier } from "./lib/recipe-parts.mjs";

function makeClassifier(overrides = {}) {
  return createPartClassifier({
    products: { BAZAAR_ITEM: {} },
    ahNames: { "Mapped Item": "MAPPED_TAG" },
    isAuctionFlagged: (tag) =>
      ["MAPPED_TAG", "UNMAPPED_TAG", "DEAD_TAG"].includes(tag),
    hasLiveMarket: (tag) => tag !== "DEAD_TAG",
    ...overrides,
  });
}

describe("recipe part classification", () => {
  it("prices from the Bazaar when possible, even with a Coflnet mapping", () => {
    const { classifyPart } = makeClassifier({
      ahNames: { "Dual Item": "MAPPED_TAG" },
    });
    expect(classifyPart({ name: "Dual Item", id: "BAZAAR_ITEM" })).toEqual({
      market: "bazaar",
      tag: undefined,
    });
  });

  it("prices mapped, flagged, live items from the Auction House", () => {
    const { classifyPart } = makeClassifier();
    expect(classifyPart({ name: "Mapped Item", id: null })).toEqual({
      market: "auction",
      tag: "MAPPED_TAG",
    });
  });

  it("blocks the update on unmapped Auction House items that have live prices", () => {
    const { classifyPart } = makeClassifier();
    expect(() =>
      classifyPart({ name: "Unmapped Item", id: "UNMAPPED_TAG" }),
    ).toThrow(/Unmapped Auction House item "Unmapped Item"/);
  });

  it("excludes Auction House items without price data, with the right reason", () => {
    const { classifyPart, unpricedReason } = makeClassifier();
    const part = { name: "Dead Item", id: "DEAD_TAG" };
    expect(classifyPart(part)).toBeNull();
    expect(unpricedReason(part, "output")).toBe(
      "Output Dead Item is listed on the Auction House but has no price data yet.",
    );
  });

  it("excludes untradeable items as having no market", () => {
    const { classifyPart, unpricedReason } = makeClassifier();
    const part = { name: "Plain Item", id: "PLAIN_TAG" };
    expect(classifyPart(part)).toBeNull();
    expect(unpricedReason(part, "input")).toBe(
      "Ingredient Plain Item has no market to price (not on the Bazaar or Auction House).",
    );
  });

  it("unmapped items without live prices do not block the update", () => {
    const { classifyPart } = makeClassifier({ hasLiveMarket: () => false });
    expect(
      classifyPart({ name: "Unmapped Item", id: "UNMAPPED_TAG" }),
    ).toBeNull();
  });
});
