import { describe, expect, it, vi } from "vitest";

import { buildAhSnapshot } from "./ah";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

const fetchedAt = Date.parse("2026-11-08T12:00:00Z");

function changeEntry(overrides: Record<string, unknown> = {}) {
  return {
    now: 100,
    recent: 90,
    volume: 5,
    lastUpdated: "2026-11-08T11:30:00Z",
    ...overrides,
  };
}

describe("buildAhSnapshot", () => {
  it("uses the now price with the recent window for stability", () => {
    const { items } = buildAhSnapshot(
      { TAG: changeEntry() },
      null,
      ["TAG"],
      fetchedAt,
    );

    expect(items.TAG).toEqual({
      price: 100,
      avg: 90,
      volumePerDay: 5,
      priceAgeMinutes: 30,
    });
  });

  it("falls back to the recent price when now is missing", () => {
    const { items } = buildAhSnapshot(
      { TAG: changeEntry({ now: undefined }) },
      null,
      ["TAG"],
      fetchedAt,
    );

    expect(items.TAG).toEqual({
      price: 90,
      avg: 90,
      volumePerDay: 5,
      priceAgeMinutes: 30,
    });
  });

  it("fills missing tags from the NEU map without an age", () => {
    const { items } = buildAhSnapshot({}, { TAG: 70 }, ["TAG"], fetchedAt);

    expect(items.TAG).toEqual({
      price: 70,
      avg: null,
      volumePerDay: null,
      priceAgeMinutes: null,
    });
  });

  it("treats null fields as missing and leaves dead tags unpriced", () => {
    const { items } = buildAhSnapshot(
      {
        TAG: { now: null, recent: null, lastUpdated: null },
        DEAD: changeEntry({ now: 0, recent: 0 }),
      },
      null,
      ["TAG", "DEAD"],
      fetchedAt,
    );

    expect(items).toEqual({});
  });

  it("clamps future stamps to zero age and ignores unparseable stamps", () => {
    const { items } = buildAhSnapshot(
      {
        TAG: changeEntry({ lastUpdated: "2026-11-08T13:00:00Z" }),
        OTHER: changeEntry({ lastUpdated: "not-a-date" }),
      },
      null,
      ["TAG", "OTHER"],
      fetchedAt,
    );

    expect(items.TAG?.priceAgeMinutes).toBe(0);
    expect(items.OTHER?.priceAgeMinutes).toBeNull();
  });
});
