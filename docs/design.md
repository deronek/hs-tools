# Design

## Scope

This is an app for comparing Hypixel SkyBlock forge recipes by profit. It prices recipes whose output and every direct ingredient have a market price: a Bazaar product or an Auction House item priced through the [Coflnet API](https://sky.coflnet.com/data). Recipes with direct coin costs or without Hypixel item IDs (pets) are follow-up work.

The app uses a committed snapshot of the 92 supported recipes. The other 27 recipes and their exclusion reasons are listed in [recipe coverage](./recipes.md); they are not stored in the app data.

The main goal is a useful calculator with honest limits. Recursive crafted inputs, coin costs, and pets are follow-up work.

## Data pipeline

The app reads the committed `src/data/recipes.json` snapshot. It contains the 92 supported recipes. At runtime, the app fetches current prices from the Hypixel Bazaar API and the Coflnet price feed.

Run one command from the repository root to download any missing source files, parse recipes, classify legs, and rebuild the snapshot:

```sh
pnpm data:update
```

Refresh the committed item icons separately when needed:

```sh
pnpm icons:update
```

The icon updater requests WebP images for item IDs in `src/data/recipes.json`, writes content-hashed WebP files to `public/item-icons`, and updates `src/data/item-icons.json`. Review and commit the generated files with recipe changes.

Vercel serves these static files from its edge cache. `next.config.ts` gives hashed icon URLs a one-year immutable TTL; changing an icon changes its URL.

**Inputs**

- `data/raw/wiki-table.html`: fetched from the [Hypixel SkyBlock Wiki API](https://hypixelskyblock.minecraft.wiki/api.php?action=parse&page=The_Forge%2FTable&prop=text&format=json). Contains the table with The Forge recipe names, costs, and durations.
- `data/raw/items.json`: fetched from the [SkyBlock items endpoint](https://api.hypixel.net/v2/resources/skyblock/items). Contains item names and IDs.
- `data/raw/bazaar-sample.json`: fetched from the [SkyBlock Bazaar endpoint](https://api.hypixel.net/v2/skyblock/bazaar). Its products determine which recipe items are Bazaar-tradeable.
- `data/raw/coflnet-items.json`: fetched from Coflnet's [item catalog](https://sky.coflnet.com/api/items). Its per-item `flags` (`BAZAAR`, `AUCTION`, …) identify Auction House items.
- `data/raw/coflnet-change.json`: fetched from Coflnet's [price change endpoint](https://sky.coflnet.com/api/prices/change) for every tag in `src/data/ah-names.json`. Its live prices decide whether an Auction House item actually has a market right now.

The script downloads each file only if it is missing. Remove a file to refresh it. Git ignores all five.

**Leg classification**

Each recipe leg is classified once, at `data:update` time, and the snapshot stores the result:

- `bazaar`: the leg has a Bazaar product in the sample.
- `auction`: the leg is not a Bazaar product, its wiki display name maps to a Coflnet tag in `src/data/ah-names.json` (a reviewed, hand-checked mapping; Coflnet's catalog has typos such as "Saphhire Crystal", so name normalization alone is not trusted), the catalog flags the tag `AUCTION`, and the change feed has a live price for it. The tag is stored on the leg.
- unpriced: anything else. The recipe is excluded and the report gives the reason.

When Hypixel adds an item to the Bazaar, the next `data:update` flips its side automatically. An `AUCTION`-flagged item with live data but no mapping in `ah-names.json` stops the update with an error instead of being silently mispriced.

The updater prints a coverage report (per-section counts, exclusion groups, 92 of 119) and the observed distribution of `|now - recent| / recent` across the supported AH tags. Those percentiles are the calibration reference for the confidence stability clip.

**Outputs**

- `data/raw/recipes-raw.json`: parsed recipe data. This intermediate file is gitignored and not used by the app.
- `src/data/recipes.json`: the committed snapshot of supported recipes with per-leg market fields. The app imports this file.
- `docs/recipes.md`: the committed report of all parsed recipes and the reason each excluded recipe is unsupported.

The updater fetches the recipe-table page through MediaWiki's `action=parse` API. The parser takes recipe quantities from the rendered Cost lists. It ignores the embedded `data-bazaar` gadget because that gadget leaves out non-Bazaar ingredients and has outdated quantities for some recipes.

Current coverage:

| Section           | Total | In app |
| ----------------- | ----: | -----: |
| Refining          |     5 |      5 |
| Forging           |    10 |     10 |
| Tools             |    15 |     14 |
| Gear              |    26 |     24 |
| Reforge_Stones    |    10 |     10 |
| Drill_Parts       |    16 |     16 |
| Perfect_Gemstones |    12 |      0 |
| Pets              |     9 |      0 |
| Other             |    16 |     13 |
| Total             |   119 |     92 |

Section IDs keep the wiki underscore form in data, such as `Reforge_Stones`. The UI replaces underscores with spaces.

## Pricing

Two sources feed the calculator:

- **Bazaar legs** use `https://api.hypixel.net/v2/skyblock/bazaar`. No API key is needed. The Bazaar path (order books, input/output modes, tax) is unchanged from the bazaar-only build.
- **Auction House legs** use Coflnet's price feed (`https://sky.coflnet.com/api/prices/change`, free and keyless). AH items have no order book in this model: buying is a buy-now at the current market sale price.

The order arrays are not sorted, so the calculator does not trust their order.

Input modes:

- Instant buy walks `sell_summary` from the lowest price until the required quantity is filled.
- Buy order uses the highest `buy_summary` price plus 0.1 per unit. Depth is the total buy-order amount divided by the required quantity.

Output modes:

- Instant sell walks `buy_summary` from the highest price until the output quantity is filled.
- Sell offer uses the lowest `sell_summary` price minus 0.1 per unit, with a floor of 0.1.

The mode toggles apply only to Bazaar legs; AH legs are buy-nows and sell-at-market regardless of mode. The 0.85 mode penalty stays recipe-wide.

Revenue is gross output value minus market-specific fees:

- Bazaar output: gross minus the bazaar tax. All bazaar sales carry a 1.25% tax, and the Bazaar Flipper community upgrade reduces it by 0.125% per level up to -0.25%, making the tax 1%. The settings select offers exactly the values that can occur in game: 1.25% (no perk), 1.125% (Bazaar Flipper 1), and 1% (Bazaar Flipper 2). The default is 1.25%.
- Auction House output: `now × qty` minus a BIN creation fee of 2% and, when the payout reaches 1,000,000 coins, the 1% collection tax ([Auction House → Fees and Taxes](https://hypixelskyblock.minecraft.wiki/w/Auction_House)). Both rates are constants (`AH_CREATION_FEE_RATE`, `AH_COLLECTION_TAX_RATE` in `src/lib/forge.ts`); the wiki brackets the creation fee at 2-5% by type and price bracket, and 2% is the common BIN case. Derpy's doubled-tax mayor window is not modeled.

The AH price shown per row is Coflnet's `now` field: the current market sale price estimate, not a lowest-BIN quote. A lone floor listing is a fragile anchor and would put per-item listing calls on the render path. Each AH leg links to `https://sky.coflnet.com/item/{tag}` so a user can audit where the number came from. When `now` is missing, the leg prices from `recent` (the recent-window typical price) and is marked as using the fallback; a tag with neither value is treated as unlisted.

Forge time uses the recipe duration and the selected time reduction. Percentage reductions stack additively. The in-game sources (Hypixel SkyBlock wiki, The Forge → Mechanics):

| Reduction      | Source                              | Condition                                                                                                                                                                |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10.5% → 30%    | Quick Forge (HotM perk)             | Level 1 gives 10.5%, grows in 0.5% steps to 19.5% at level 19, then jumps to 30% from level 20; max level is 21 with Blue Cheese Goblin Omelette. Updates retroactively. |
| 25%            | Cole's Molten Forge (mayor perk)    | Only while Cole is mayor, and only for forge processes started during his term.                                                                                          |
| -0.5s per kill | Gemstone Gauntlet's Kinetic ability | Flat seconds per Perfect Gemstone kill with a 1s cooldown, applied after the percentage sources. Not a percentage, so the calculator ignores it.                         |

The UI slider therefore runs 0 to 55% (Quick Forge 30% + Cole's Molten Forge 25%) in 0.5% steps matching Quick Forge's granularity. The default stays 0 so nothing about the player's perks is assumed. Profit per hour uses the reduced duration, with a one-second floor to avoid division by zero. Pricing clamps the reduction at 60%, above the achievable maximum.

If an order book cannot fill the requested quantity, the remaining units use the last order price and the depth score falls below 1. The UI shows that risk through confidence, not a separate warning.

## Confidence

Confidence is a heuristic from 0 to 100. It is not a fill probability.

| Part   | Weight | Input                                                                                               |
| ------ | -----: | --------------------------------------------------------------------------------------------------- |
| Depth  |    40% | Minimum fill ratio across inputs and output                                                         |
| Volume |    35% | Lower of input daily volume per required unit and output daily volume per output unit, scaled by 10 |
| Spread |    25% | Average bid/ask spread, where 0% spread scores 1 and 10% or more scores 0                           |

Order and offer modes multiply the score by 0.85. The result is clamped to 0 to 100.

Auction House legs plug into the same three slots so mixed-market rows stay on one scale:

- The 0.4 depth slot uses price stability: `1 - |now - recent| / recent`, saturating like the Bazaar spread curve so 10% relative drift scores 0. The data:update report prints the observed drift percentiles (p50 ≈ 5%, p90 ≈ 16% in the November 2026 check) for calibrating that clip constant. `recent` is deliberately the base and not the month-scale `monthly` average, which reads legitimate trend moves as instability.
- The 0.35 volume slot uses Coflnet's 24-hour sold volume, the same daily-unit curve (`min(daily) / 10`) the Bazaar side gets from `sellMovingWeek / 7`.
- The 0.25 spread slot uses feed freshness `exp(-feedAgeHours / 6)` from the per-tag `lastUpdated` stamp. A stale feed and a wide Bazaar spread mean the same thing: this may not be the price you actually get. A NEU-fallback price has no freshness stamp, so it scores 0 here.

Depth and volume still take the minimum across legs; the spread slot averages the Bazaar spread curve (one term over its legs) with each AH leg's freshness. An unlisted AH output renders with zero revenue and confidence 0; an unlisted AH ingredient drops the recipe rather than pricing the leg as free.

The UI renders confidence as a plain percentage. A small info popover beside the column header explains the score and states that it is not a fill guarantee.

## Coflnet cache

`src/lib/ah.ts` fetches one batched `GET /api/prices/change?itemTags=<all AH tags>` call per revalidation, plus `GET /api/prices/neu` (a ~85 KB AH-average map) only when tags are missing from the change feed. There is no per-item loop and no scheduled job.

`unstable_cache` uses the key `["coflnet-forge", <sorted AH tags>]` and `revalidate: 3_600`, matching the Bazaar cadence so both sources age in lockstep. The fetch itself uses `cache: "no-store"` so the wrapper owns caching. AH tags never enter the Bazaar cache key, so Bazaar cache generations do not invalidate when the AH item list grows.

Rate limits are per IP: 30 requests / 10 s and 100 requests / 1 min ([Coflnet API wiki](https://sky.coflnet.com/wiki/api)). Steady state is two batched calls per hour, and 429s retry with backoff inside the cached wrapper. The data:update catalog call adds one request per deploy.

Attribution, per Coflnet's rules: the app footer links to `https://sky.coflnet.com/data` ("AH prices provided by SkyCofl") on every page, and each AH leg links to `https://sky.coflnet.com/item/{tag}` where the item's name is displayed. HS Tools is free and non-commercial, so no Premium+ subscription is required.

The app has no offline fallback. A failed change-feed request fails the page; the NEU fallback is best-effort and its loss only degrades the affected legs to unlisted.

## Cross-check

`node scripts/cross-check-flips.mjs` (manual, networked) compares this app's pricing against Coflnet's own forge flip list (`/api/flip/forge`): per-recipe output price (`now` vs the flipper's `sellPrice`), cost (per-ingredient sum vs `craftCost`), and profit gap. It also prints `recent` vs the flipper's `craftData.median` per tag to pin the feed semantics the confidence scores rely on. In the November 2026 check the two sources agreed to a median of 4.3% on output prices and 2.9% on costs; the gaps widen on fast-moving items because the two feeds are sampled at different times, and the flip oracle surfaces that drift instead of hiding it.

## Bazaar cache

The full bazaar response is about 4.7 MB. `src/lib/bazaar.ts` filters the response to the product IDs used by Bazaar-market recipe legs before caching it.

`unstable_cache` uses the key `["bazaar-recipes", <sorted product IDs>]` and `revalidate: 3_600`. The fetch itself uses `cache: "no-store"` so the wrapper owns caching. `src/app/page.tsx` also sets `revalidate = 3_600`. The key includes the Bazaar-market leg IDs of the supported recipes, so changing that set invalidates old cached data; AH tags deliberately never enter this key.

The app has no offline fallback. A failed bazaar request fails the page.

## Verification

```sh
pnpm test:unit
pnpm lint
pnpm build
```

`pnpm lint` runs Prettier check, ESLint, and `tsc --noEmit`.

Unit tests cover AH snapshot mapping (`now`/`recent`/NEU fallbacks) on a committed change-payload fixture, AH fee branches, the unlisted-output and unpriced-ingredient paths, and a regression fixture that pins the 30 pre-batch recipes' cost, revenue, and confidence to byte-identical values under both mode sets.

## Limitations

- Direct coin costs are recorded but not priced, which keeps four recipes (Divan's Drill, Gemstone Chamber, both Dwarven travel scrolls) out of the snapshot.
- Pets have no Hypixel item ID; their Coflnet tags exist and live in `ah-names.json`, but identity work (icons, the pet price-scale quirk) is a follow-up batch.
- Perfect Gemstones, Relic of Power, and Secret Railroad Pass have no market for a leg and cannot be priced honestly.
- AH prices are Coflnet feed estimates, not order-book quotes; on fast-moving items they can trail the market until the next revalidation, and the confidence score's freshness term reflects that.
- The 2% BIN creation fee is a constant; the wiki brackets it at 2-5% by type and price bracket, and Derpy's tax window is unmodeled.
- Item icons are copied from SkyCrypt during manual updates. If SkyCrypt changes or drops an item ID, rerun `pnpm icons:update`; the recipe row still works if an icon file is missing.
- There is no historical price chart, no auction history, and no saved user settings.
- There is no theme toggle; only dark mode is supported.
