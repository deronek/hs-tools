import { describe, expect, it } from "vitest";

import {
  createPartClassifier,
  EXCLUSION_MESSAGES,
  neededChangeTags,
} from "./lib/recipe-parts.mjs";

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

  it("excludes Auction House items without price data", () => {
    const { classifyPart } = makeClassifier();
    expect(classifyPart({ name: "Dead Item", id: "DEAD_TAG" })).toEqual({
      excluded: "no-price-data",
    });
  });

  it("excludes coin payments", () => {
    const { classifyPart } = makeClassifier();
    expect(classifyPart({ name: "Coins", id: null })).toEqual({
      excluded: "coin-cost",
    });
  });

  it("excludes untradeable items as having no market", () => {
    const { classifyPart } = makeClassifier();
    expect(classifyPart({ name: "Plain Item", id: "PLAIN_TAG" })).toEqual({
      excluded: "no-market",
    });
  });

  it("unmapped items without live prices do not block the update", () => {
    const { classifyPart } = makeClassifier({ hasLiveMarket: () => false });
    expect(classifyPart({ name: "Unmapped Item", id: "UNMAPPED_TAG" })).toEqual(
      { excluded: "no-price-data" },
    );
  });

  it("maps exclusion codes to the report messages", () => {
    expect(EXCLUSION_MESSAGES["coin-cost"]("Ingredient", "Coins")).toBe(
      "Requires a direct coin payment.",
    );
    expect(EXCLUSION_MESSAGES["no-item-id"]("Output", "Mole")).toBe(
      "Output has no Hypixel item ID, so it cannot be matched to a priced market.",
    );
    expect(EXCLUSION_MESSAGES["no-price-data"]("Output", "Divan's Drill")).toBe(
      "Output Divan's Drill is listed on the Auction House but has no price data yet.",
    );
    expect(EXCLUSION_MESSAGES["no-market"]("Ingredient", "Amber Crystal")).toBe(
      "Ingredient Amber Crystal has no market to price (not on the Bazaar or Auction House).",
    );
  });
});

describe("neededChangeTags", () => {
  it("covers mapped tags and every AUCTION-flagged part, mapped or not", () => {
    const recipes = [
      {
        outputId: "UNMAPPED_FLAGGED",
        ingredients: [{ name: "Bazaar Thing", id: "BAZAAR_ITEM" }],
      },
      {
        outputId: "BAZAAR_ITEM",
        ingredients: [{ name: "Mapped Item", id: "SOME_ID" }],
      },
    ];
    expect(
      neededChangeTags(
        recipes,
        { "Mapped Item": "MAPPED_TAG" },
        new Set(["UNMAPPED_FLAGGED"]),
      ),
    ).toEqual(["MAPPED_TAG", "UNMAPPED_FLAGGED"]);
  });
});
