import type { AhPrices, Recipe } from "@/lib/forge";
import type { Metadata } from "next";

import { ForgeCalculator } from "@/components/forge-calculator";
import recipes from "@/data/recipes.json";
import { getAhSnapshot } from "@/lib/ah";
import { getBazaarSnapshot } from "@/lib/bazaar";

export const revalidate = 3_600;

export const metadata: Metadata = {
  title: "SkyBlock Forge Profit Calculator",
  description:
    "Compare Hypixel SkyBlock forge recipes by profit, profit per hour, and confidence.",
};

export default async function Page() {
  const snapshot = await getBazaarSnapshot();

  // A Coflnet outage falls back to bazaar-only rows, not a failed page.
  let ahPrices: AhPrices = {};
  let ahFetchedAt: number | null = null;
  try {
    const ah = await getAhSnapshot();
    ahPrices = ah.items;
    ahFetchedAt = ah.fetchedAt;
  } catch {
    // ahFetchedAt stays null
  }

  return (
    <main className="container mx-auto flex min-h-0 flex-1 flex-col p-4 pb-6 sm:px-6 sm:pt-6 sm:pb-8 md:px-8">
      <ForgeCalculator
        recipes={recipes as Recipe[]}
        products={snapshot.products}
        lastUpdated={snapshot.lastUpdated}
        ahPrices={ahPrices}
        ahFetchedAt={ahFetchedAt}
      />
    </main>
  );
}
