import { unstable_cache } from "next/cache";
import { z } from "zod";

import type { AhPrices, AhSnapshot, Recipe } from "./forge";
import recipes from "../data/recipes.json";
import { collectMarketNeeds } from "./forge";

const BASE_URL = "https://sky.coflnet.com";

const ChangeEntrySchema = z.object({
  now: z.number().nullish(),
  recent: z.number().nullish(),
  volume: z.number().nullish(),
  lastUpdated: z.string().nullish(),
});

const ChangeResponseSchema = z.record(z.string(), ChangeEntrySchema);

const NeuSchema = z.record(z.string(), z.number());

const { auctionTags } = collectMarketNeeds(recipes as Recipe[]);
const neededTags = new Set(auctionTags);

function priceAgeMinutes(
  lastUpdated: string | null | undefined,
  fetchedAt: number,
) {
  if (!lastUpdated) return null;
  const stamp = Date.parse(lastUpdated);
  if (!Number.isFinite(stamp)) return null;
  return Math.max(0, (fetchedAt - stamp) / 60_000);
}

/**
 * Maps a `/api/prices/change` response (plus the `/api/prices/neu` fallback
 * map) into the price records used for pricing. Tags without any usable price
 * are left out; pricing treats those items as unpriced.
 */
export function buildAhSnapshot(
  change: unknown,
  neu: Record<string, number> | null,
  tags: Iterable<string>,
  fetchedAt: number,
): AhSnapshot {
  const parsed = ChangeResponseSchema.parse(change ?? {});
  const items: AhPrices = {};
  const gaps: string[] = [];

  for (const tag of tags) {
    const entry = parsed[tag];
    if (!entry) {
      gaps.push(tag);
      continue;
    }
    const age = priceAgeMinutes(entry.lastUpdated, fetchedAt);
    if (entry.now && entry.now > 0) {
      items[tag] = {
        price: entry.now,
        avg: entry.recent ?? null,
        volumePerDay: entry.volume ?? null,
        priceAgeMinutes: age,
      };
    } else if (entry.recent && entry.recent > 0) {
      items[tag] = {
        price: entry.recent,
        avg: entry.recent,
        volumePerDay: entry.volume ?? null,
        priceAgeMinutes: age,
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
          volumePerDay: null,
          priceAgeMinutes: null,
        };
      }
    }
  }

  return { fetchedAt, items };
}

async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
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
    const snapshot = buildAhSnapshot(change, null, neededTags, fetchedAt);

    const missing = tags.filter((tag) => !snapshot.items[tag]);
    if (missing.length > 0) {
      // Only fetched when the change response is missing tags. If it fails,
      // those items are treated as unpriced instead of failing the page over
      // a secondary source.
      try {
        const neu = await NeuSchema.parseAsync(
          await fetchJson(`${BASE_URL}/api/prices/neu`),
        );
        return buildAhSnapshot(change, neu, neededTags, fetchedAt);
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
