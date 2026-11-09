import { describe, expect, it } from "vitest";

import type { AhPrices, BazaarProducts, Recipe } from "./forge";
import {
  AH_COLLECTION_TAX_MIN,
  collectMarketNeeds,
  DEFAULT_SETTINGS,
  priceRecipe,
} from "./forge";

function product(sell: number, buy: number) {
  return {
    quick_status: {
      productId: "TEST",
      sellPrice: sell,
      sellVolume: 10,
      sellMovingWeek: 1_000,
      sellOrders: 1,
      buyPrice: buy,
      buyVolume: 10,
      buyMovingWeek: 1_000,
      buyOrders: 1,
    },
    sell_summary: [{ amount: 10, pricePerUnit: sell, orders: 1 }],
    buy_summary: [{ amount: 10, pricePerUnit: buy, orders: 1 }],
  };
}

const products: BazaarProducts = {
  A: product(100, 90),
  B: product(200, 190),
};

const recipe: Recipe = {
  section: "Test",
  name: "Test recipe",
  outputId: "B",
  outputQty: 1,
  durationSeconds: 3_600,
  hotm: "I",
  outputMarket: "bazaar",
  ingredients: [{ name: "A", qty: 2, id: "A", market: "bazaar" }],
};

describe("priceRecipe", () => {
  it("prices instant inputs and instant output after tax", () => {
    const priced = priceRecipe(recipe, products, DEFAULT_SETTINGS, {});

    expect(priced).not.toBeNull();
    expect(priced?.ingredients[0].id).toBe("A");
    expect(priced?.cost).toBe(200);
    expect(priced?.revenue).toBeCloseTo(190 * 0.9875);
    expect(priced?.profit).toBeCloseTo(190 * 0.9875 - 200);
    expect(priced?.profitPerHour).toBeCloseTo(priced!.profit ?? 0);
    expect(priced?.confidence).toBeGreaterThan(0);
  });

  it("uses buy order and sell offer modes", () => {
    const priced = priceRecipe(
      recipe,
      products,
      {
        ...DEFAULT_SETTINGS,
        inputMode: "order",
        outputMode: "offer",
        taxRate: 0,
      },
      {},
    );

    expect(priced?.cost).toBeCloseTo(90.1 * 2);
    expect(priced?.revenue).toBeCloseTo(199.9);
  });

  it("drops recipes whose ingredient order book is empty", () => {
    const empty: BazaarProducts = {
      A: { ...product(100, 90), sell_summary: [] },
      B: product(200, 190),
    };
    expect(priceRecipe(recipe, empty, DEFAULT_SETTINGS, {})).toBeNull();
  });

  it("drops recipes whose output order book is empty", () => {
    const empty: BazaarProducts = {
      A: product(100, 90),
      B: { ...product(200, 190), buy_summary: [] },
    };
    expect(priceRecipe(recipe, empty, DEFAULT_SETTINGS, {})).toBeNull();
  });

  it("drops recipes when a buy-order input has no bids", () => {
    const noBids: BazaarProducts = {
      A: { ...product(100, 90), buy_summary: [] },
      B: product(200, 190),
    };
    expect(
      priceRecipe(
        recipe,
        noBids,
        { ...DEFAULT_SETTINGS, inputMode: "order" },
        {},
      ),
    ).toBeNull();
  });
});

describe("auction house pricing", () => {
  const ahRecipe: Recipe = {
    section: "Test",
    name: "AH recipe",
    outputId: "OUT",
    outputQty: 1,
    durationSeconds: 3_600,
    hotm: "I",
    outputMarket: "auction",
    outputTag: "OUT_TAG",
    ingredients: [
      {
        name: "AH part",
        qty: 2,
        id: "AH_PART",
        market: "auction",
        tag: "PART_TAG",
      },
    ],
  };

  const ahPrices: AhPrices = {
    PART_TAG: {
      price: 100,
      avg: 102,
      volumePerDay: 50,
      priceAgeMinutes: 30,
    },
    OUT_TAG: {
      price: 2_000_000,
      avg: 1_950_000,
      volumePerDay: 8.5,
      priceAgeMinutes: 45,
    },
  };

  it("prices AH ingredients as buy-now without order modes", () => {
    const priced = priceRecipe(
      ahRecipe,
      products,
      { ...DEFAULT_SETTINGS, inputMode: "order" },
      ahPrices,
    );

    expect(priced?.ingredients[0]).toMatchObject({
      cost: 200,
      unit: 100,
      market: "auction",
      tag: "PART_TAG",
    });
    expect(priced?.cost).toBe(200);
  });

  it("applies the creation fee and the 1M collection tax to AH revenue", () => {
    const priced = priceRecipe(ahRecipe, products, DEFAULT_SETTINGS, ahPrices);

    const payout = 2_000_000;
    expect(payout).toBeGreaterThanOrEqual(AH_COLLECTION_TAX_MIN);
    expect(priced?.revenue).toBeCloseTo(payout * 0.97);
  });

  it("skips the collection tax when the payout is under 1M", () => {
    const cheap: AhPrices = {
      ...ahPrices,
      OUT_TAG: { ...ahPrices.OUT_TAG, price: 500_000 },
    };
    const priced = priceRecipe(ahRecipe, products, DEFAULT_SETTINGS, cheap);

    expect(priced?.revenue).toBeCloseTo(500_000 * 0.98);
  });

  it("keeps AH revenue independent of the output mode toggle", () => {
    const instant = priceRecipe(ahRecipe, products, DEFAULT_SETTINGS, ahPrices);
    const offer = priceRecipe(
      ahRecipe,
      products,
      { ...DEFAULT_SETTINGS, outputMode: "offer" },
      ahPrices,
    );

    expect(offer?.revenue).toBe(instant?.revenue);
  });

  it("renders no revenue and zero confidence for an unlisted AH output", () => {
    const priced = priceRecipe(ahRecipe, products, DEFAULT_SETTINGS, {
      PART_TAG: ahPrices.PART_TAG,
    });

    expect(priced).not.toBeNull();
    expect(priced?.revenue).toBeNull();
    expect(priced?.confidence).toBe(0);
    expect(priced?.profit).toBeNull();
  });

  it("drops recipes with unpriced AH ingredients instead of pricing them as free", () => {
    const priced = priceRecipe(ahRecipe, products, DEFAULT_SETTINGS, {
      OUT_TAG: ahPrices.OUT_TAG,
    });

    expect(priced).toBeNull();
  });

  it("prices mixed-market recipes with bazaar inputs and an AH output", () => {
    const mixed: Recipe = {
      section: "Test",
      name: "Mixed recipe",
      outputId: "OUT",
      outputQty: 1,
      durationSeconds: 3_600,
      hotm: "I",
      outputMarket: "auction",
      outputTag: "OUT_TAG",
      ingredients: [{ name: "A", qty: 2, id: "A", market: "bazaar" }],
    };
    const priced = priceRecipe(mixed, products, DEFAULT_SETTINGS, ahPrices);

    expect(priced?.cost).toBe(200); // bazaar instant buy
    expect(priced?.revenue).toBeCloseTo(2_000_000 * 0.97);
    expect(priced?.confidence).toBeGreaterThan(0);
    expect(priced?.confidence).toBeLessThanOrEqual(100);
  });
});

describe("collectMarketNeeds", () => {
  it("collects bazaar product IDs and auction tags from mixed recipes", () => {
    const mixed: Recipe[] = [
      recipe,
      {
        ...recipe,
        name: "AH recipe",
        outputId: "OUT",
        outputMarket: "auction",
        outputTag: "OUT_TAG",
        ingredients: [
          { name: "A", qty: 1, id: "A", market: "bazaar" },
          {
            name: "AH part",
            qty: 1,
            id: "AH_PART",
            market: "auction",
            tag: "PART_TAG",
          },
        ],
      },
    ];

    expect(collectMarketNeeds(mixed)).toEqual({
      bazaarIds: ["A", "B"],
      auctionTags: ["OUT_TAG", "PART_TAG"],
    });
  });
});
