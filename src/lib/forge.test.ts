import { describe, expect, it } from "vitest";

import type { BazaarProducts, Recipe } from "./forge";
import { DEFAULT_SETTINGS, priceRecipe } from "./forge";

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
  ingredients: [{ name: "A", qty: 2, id: "A" }],
};

describe("priceRecipe", () => {
  it("prices instant inputs and instant output after tax", () => {
    const priced = priceRecipe(recipe, products, DEFAULT_SETTINGS);

    expect(priced).not.toBeNull();
    expect(priced?.ingredients[0].id).toBe("A");
    expect(priced?.cost).toBe(200);
    expect(priced?.revenue).toBeCloseTo(190 * 0.9875);
    expect(priced?.profit).toBeCloseTo(190 * 0.9875 - 200);
    expect(priced?.profitPerHour).toBeCloseTo(priced!.profit);
    expect(priced?.confidence).toBeGreaterThan(0);
  });

  it("uses buy order and sell offer modes", () => {
    const priced = priceRecipe(recipe, products, {
      ...DEFAULT_SETTINGS,
      inputMode: "order",
      outputMode: "offer",
      taxRate: 0,
    });

    expect(priced?.cost).toBeCloseTo(90.1 * 2);
    expect(priced?.revenue).toBeCloseTo(199.9);
  });
});
