import { unstable_cache } from "next/cache";
import { z } from "zod";

import type { AhPrices, Recipe } from "./forge";
import recipes from "../data/recipes.json";

const BASE_URL = "https://sky.coflnet.com";

const ChangeEntrySchema = z.object({
  now: z.number().optional(),
  recent: z.number().optional(),
  monthly: z.number().optional(),
  volume: z.number().optional(),
  lastUpdated: z.string().optional(),
});

const ChangeResponseSchema = z.record(z.string(), ChangeEntrySchema);

const NeuSchema = z.record(z.string(), z.number());

export type AhSnapshot = {
  fetchedAt: number;
  items: AhPrices;
};

const neededTags = new Set(
  (recipes as Recipe[]).flatMap((recipe) => [
    ...(recipe.outputMarket === "auction" && recipe.outputTag
      ? [recipe.outputTag]
      : []),
    ...recipe.ingredients.flatMap((ingredient) =>
      ingredient.market === "auction" && ingredient.tag ? [ingredient.tag] : [],
    ),
  ]),
);

function feedAgeMinutes(lastUpdated: string | undefined, fetchedAt: number) {
  if (!lastUpdated) return null;
  const stamp = Date.parse(lastUpdated);
  if (!Number.isFinite(stamp)) return null;
  return Math.max(0, (fetchedAt - stamp) / 60_000);
}

/**
 * Maps a `/api/prices/change` payload (plus the `/api/prices/neu` fallback
 * map) into the snapshot used for pricing. Pure so tests can drive it with
 * committed fixtures. Tags without any usable price are left out; pricing
 * treats those legs as unlisted.
 */
export function buildAhSnapshot(
  change: unknown,
  neu: Record<string, number> | null,
  fetchedAt: number,
): AhSnapshot {
  const parsed = ChangeResponseSchema.parse(change ?? {});
  const items: AhPrices = {};
  const gaps: string[] = [];

  for (const tag of neededTags) {
    const entry = parsed[tag];
    if (!entry) {
      gaps.push(tag);
      continue;
    }
    const age = feedAgeMinutes(entry.lastUpdated, fetchedAt);
    if (entry.now && entry.now > 0) {
      items[tag] = {
        price: entry.now,
        avg: entry.recent ?? null,
        monthly: entry.monthly ?? null,
        volumePerDay: entry.volume ?? null,
        feedAgeMinutes: age,
        source: "now",
      };
    } else if (entry.recent && entry.recent > 0) {
      items[tag] = {
        price: entry.recent,
        avg: entry.recent,
        monthly: entry.monthly ?? null,
        volumePerDay: entry.volume ?? null,
        feedAgeMinutes: age,
        source: "recent",
      };
    } else {
      gaps.push(tag);
    }
  }

  if (gaps.length > 0 && neu) {
    for (const tag of gaps) {
      const price = neu[tag];
      if (price && price > 0) {
        items[tag] = {
          price,
          avg: null,
          monthly: null,
          volumePerDay: null,
          feedAgeMinutes: null,
          source: "neu",
        };
      }
    }
  }

  return { fetchedAt, items };
}

async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) return response.json();
    if (response.status === 429 && attempt < 2) {
      await new Promise((resolve) =>
        setTimeout(resolve, 2_000 * (attempt + 1)),
      );
      continue;
    }
    throw new Error(`Coflnet API returned ${response.status} for ${url}`);
  }
}

const getCachedAh = unstable_cache(
  async (): Promise<AhSnapshot> => {
    const tags = [...neededTags].sort();
    if (tags.length === 0) return { fetchedAt: Date.now(), items: {} };

    const change = await fetchJson(
      `${BASE_URL}/api/prices/change?itemTags=${tags.join(",")}`,
    );
    const fetchedAt = Date.now();
    const snapshot = buildAhSnapshot(change, null, fetchedAt);

    const missing = tags.filter((tag) => !snapshot.items[tag]);
    if (missing.length > 0) {
      // Second line of defense for tags the change feed omits entirely.
      // Best-effort: losing it degrades those legs to unlisted instead of
      // failing the page over a secondary source.
      try {
        const neu = await NeuSchema.parseAsync(
          await fetchJson(`${BASE_URL}/api/prices/neu`),
        );
        return buildAhSnapshot(change, neu, fetchedAt);
      } catch {
        return snapshot;
      }
    }
    return snapshot;
  },
  ["coflnet-forge", [...neededTags].sort().join(",")],
  { revalidate: 3_600 },
);

export async function getAhSnapshot(): Promise<AhSnapshot> {
  return getCachedAh();
}
