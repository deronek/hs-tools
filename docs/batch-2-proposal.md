# Batch 2: Auction House pricing from Coflnet

Status: implemented in [PR #8](https://github.com/deronek/hs-tools/pull/8). This document keeps the reasoning behind the batch; the current system is described in [design](./design.md).

## Problem

The calculator priced only the 30 recipes whose ingredients and output all trade on the Bazaar. That left out every drill, most gear, and all drill parts — 62 more recipes — because they sell on the Auction House, which has no public price API from Hypixel. This batch prices those 62 through Coflnet, bringing coverage to 92 of 119 recipes.

## Decisions made

**Pricing source: Coflnet.** Free, keyless, and one request covers every item we price (`/api/prices/change?itemTags=…` returns the current price, a recent-window price, a 30-day price, 24-hour sold volume, and a per-item timestamp). Alternatives checked at the time: the official Auction House API works but needs ~96 MB across 42 paginated calls per refresh — kept only as a documented fallback if Coflnet's terms or availability change. Moulberry's `lowest_bin.json` is dead (HTTP 525).

**Which items to price.** An ingredient or output prices from the Bazaar when a Bazaar product exists, otherwise from the Auction House when a hand-checked name→tag mapping (`src/data/ah-names.json`) resolves it, Coflnet's catalog flags it `AUCTION`, and Coflnet has live price data for it. Everything else stays excluded with a reason. Items Hypixel later adds to the Bazaar switch automatically on the next `data:update`.

**What is still excluded (27 recipes).**

- 4 need a coin payment on top of items (Divan's Drill, Gemstone Chamber, both Dwarven travel scrolls). Next batch; the pricing path needs a `coin` field only.
- 9 are pets. They have Coflnet tags and live markets (the Mole had 90 active listings at check time) but no Hypixel item ID, so adopting them needs Coflnet's catalog as a second item registry plus an icon source.
- 14 have no market at all: the 12 Perfect Gemstones (crystals are collectibles, not tradeable items), Relic of Power, and Secret Railroad Pass. Coflnet's catalog still lists a stale `AUCTION` flag on Jasper Crystal with zero market data — a flag alone is not a market, which is why classification also requires live prices.

**Fees.** Selling on the Auction House costs a ~2% BIN creation fee, plus a 1% collection tax on sales of 1,000,000 coins or more ([wiki, Auction House → Fees and Taxes](https://hypixelskyblock.minecraft.wiki/w/Auction_House)). Both are constants in `src/lib/forge.ts`. Derpy's doubled-tax mayor window is not modeled.

**Attribution.** Coflnet requires a link on pages using their data: the footer credits SkyCofl, and every priced item links to `sky.coflnet.com/item/{tag}`. HS Tools is free and non-commercial, so no subscription is needed.

**Price choice.** Rows use Coflnet's current market-sale estimate (`now`), not the lowest visible listing: a lone floor listing is fragile and would put per-item requests on the render path. The `recent` and `monthly` fields bracket `now` for sanity, and the confidence score uses how far `now` sits from `recent` and how old the timestamp is.

**Cross-checking.** `scripts/cross-check-flips.mjs` compares our profits against Coflnet's own forge calculator (`/api/flip/forge`) and reports the gaps. At the November 2026 check the two agreed to a median of 4.3% on output prices and 2.9% on costs.

## Not in this batch

- Coin-cost support for the 4 recipes above.
- Pet recipes (identity work in Coflnet's catalog, icons, and the pet price-scale quirk noted during checks).
- Per-item listing depth from Coflnet's `/analysis/live` behind a lazily-cached route — a possible future confidence upgrade, never on the render path.
- The official Auction House crawl as an active fallback; documented, not shipped.
