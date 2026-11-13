import { unstable_cache } from "next/cache";
import { z } from "zod";

import type { BazaarProducts, Recipe } from "./forge";
import recipes from "@/data/recipes.json";
import { collectMarketNeeds } from "./forge";

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
  /** When this snapshot was fetched, used for the staleness check. */
  fetchedAt: number;
  lastUpdated: number;
  products: BazaarProducts;
};

const { bazaarIds } = collectMarketNeeds(recipes as Recipe[]);
const neededIds = new Set(bazaarIds);

const REVALIDATE_SECONDS = 3_600;

const getCachedBazaar = unstable_cache(
  async (): Promise<BazaarSnapshot> => {
    const response = await fetch("https://api.hypixel.net/v2/skyblock/bazaar", {
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Bazaar API returned ${response.status}`);
    }

    const parsed = ResponseSchema.parse(await response.json());
    if (!parsed.success) throw new Error("Bazaar API returned success=false");

    const products = Object.fromEntries(
      Object.entries(parsed.products).filter(([id]) => neededIds.has(id)),
    ) as BazaarProducts;

    const emptyBooks = [...neededIds].filter((id) => {
      const product = products[id];
      return (
        product &&
        (product.sell_summary.length === 0 || product.buy_summary.length === 0)
      );
    });
    if (emptyBooks.length > 0)
      console.warn(
        `Bazaar order book is empty for ${emptyBooks.join(", ")}; recipes relying on that side are dropped`,
      );

    return {
      fetchedAt: Date.now(),
      lastUpdated: parsed.lastUpdated,
      products,
    };
  },
  ["bazaar-recipes", [...neededIds].sort().join(",")],
  { revalidate: REVALIDATE_SECONDS },
);

export async function getBazaarSnapshot(): Promise<BazaarSnapshot> {
  const snapshot = await getCachedBazaar();
  // unstable_cache serves the stale value when a refresh fails, so a
  // snapshot older than the revalidate window means the refresh failed.
  // Throwing fails the regen, so ISR keeps the previous page instead of
  // publishing refreshed AH prices beside stale Bazaar prices. Mirrors the
  // check in getAhSnapshot.
  if (Date.now() - snapshot.fetchedAt > REVALIDATE_SECONDS * 1000) {
    throw new Error(`Bazaar snapshot is over ${REVALIDATE_SECONDS}s old`);
  }
  return snapshot;
}
