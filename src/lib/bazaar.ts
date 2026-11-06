import { unstable_cache } from "next/cache";
import { z } from "zod";

import type { BazaarProducts, Recipe } from "./forge";
import recipes from "@/data/recipes.json";

const OrderSchema = z.object({
  amount: z.number(),
  pricePerUnit: z.number(),
  orders: z.number(),
});

const ProductSchema = z.object({
  quick_status: z.object({
    productId: z.string(),
    sellPrice: z.number(),
    sellVolume: z.number(),
    sellMovingWeek: z.number(),
    sellOrders: z.number(),
    buyPrice: z.number(),
    buyVolume: z.number(),
    buyMovingWeek: z.number(),
    buyOrders: z.number(),
  }),
  sell_summary: z.array(OrderSchema),
  buy_summary: z.array(OrderSchema),
});

const ResponseSchema = z.object({
  success: z.boolean(),
  lastUpdated: z.number(),
  products: z.record(z.string(), ProductSchema),
});

export type BazaarSnapshot = {
  lastUpdated: number;
  products: BazaarProducts;
};

const neededIds = new Set(
  (recipes as Recipe[]).flatMap((recipe) => [
    recipe.outputId,
    ...recipe.ingredients.flatMap((ingredient) =>
      ingredient.id ? [ingredient.id] : [],
    ),
  ]),
);

const getCachedBazaar = unstable_cache(
  async (): Promise<BazaarSnapshot> => {
    const response = await fetch("https://api.hypixel.net/v2/skyblock/bazaar", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Bazaar API returned ${response.status}`);
    }

    const parsed = ResponseSchema.parse(await response.json());
    if (!parsed.success) throw new Error("Bazaar API returned success=false");

    const products = Object.fromEntries(
      Object.entries(parsed.products).filter(([id]) => neededIds.has(id)),
    ) as BazaarProducts;

    return { lastUpdated: parsed.lastUpdated, products };
  },
  ["bazaar-recipes", [...neededIds].sort().join(",")],
  { revalidate: 3_600 },
);

export async function getBazaarSnapshot(): Promise<BazaarSnapshot> {
  return getCachedBazaar();
}
