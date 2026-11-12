# Design

## Scope

This is an app for comparing Hypixel SkyBlock forge recipes by profit. It prices recipes whose output and every direct ingredient have a market price: a Bazaar product or an Auction House item priced through the [Coflnet API](https://sky.coflnet.com/data). Recipes with direct coin costs or without Hypixel item IDs (pets) are follow-up work.

The app uses a committed snapshot of the 92 supported recipes. The other 27 recipes and their exclusion reasons are listed in [recipe coverage](./recipes.md); they are not stored in the app data.

The main goal is a useful calculator with honest limits. Recursive crafted inputs, coin costs, and pets are follow-up work.

## Data pipeline

The app reads the committed `src/data/recipes.json` snapshot. It contains the 92 supported recipes. At runtime, the app fetches current prices from the Hypixel Bazaar API and Coflnet's price API.

Run one command from the repository root to download any missing source files, parse recipes, choose a market for each ingredient and output, and rebuild the snapshot:

```sh
pnpm data:update
```

Refresh the committed item icons separately when needed:

```sh
pnpm icons:update
```

The committed icon set is sticky: the updater fetches only for items without a committed icon, for items in a curated wiki-override map, and to downsize committed icons stored as an exact upscale of their base texture — so upstream variant flapping never rewrites committed icons. SkyCrypt's item endpoint is the primary source for new icons; Coflnet's icon endpoint is the fallback when SkyCrypt cannot render an item properly (any response smaller than 128x128 is placeholder junk shared between items), and the wiki-override map covers the few items both upstreams render incorrectly. Every image is collapsed to its first frame, reduced to its base texture size when it is an exact nearest-neighbor upscale (most game textures are 16x16), and stored as a lossless WebP with a content-hashed filename in `public/item-icons`, recorded in `src/data/item-icons.json`. Review and commit the generated files with recipe changes.

Vercel serves these static files from its edge cache. `next.config.ts` gives hashed icon URLs a one-year immutable TTL; changing an icon changes its URL.

**Inputs**

- `data/raw/wiki-table.html`: fetched from the [Hypixel SkyBlock Wiki API](https://hypixelskyblock.minecraft.wiki/api.php?action=parse&page=The_Forge%2FTable&prop=text&format=json). Contains the table with The Forge recipe names, costs, and durations.
- `data/raw/items.json`: fetched from the [SkyBlock items endpoint](https://api.hypixel.net/v2/resources/skyblock/items). Contains item names and IDs.
- `data/raw/bazaar-sample.json`: fetched from the [SkyBlock Bazaar endpoint](https://api.hypixel.net/v2/skyblock/bazaar). Its products determine which recipe items are Bazaar-tradeable.
- `data/raw/coflnet-items.json`: fetched from Coflnet's [item catalog](https://sky.coflnet.com/api/items). Its per-item `flags` (`BAZAAR`, `AUCTION`, …) identify Auction House items.
- `data/raw/coflnet-change.json`: fetched from Coflnet's [price change endpoint](https://sky.coflnet.com/api/prices/change) for every Auction House tag the recipes can price: the reviewed `src/data/ah-names.json` mappings plus every recipe part the catalog flags `AUCTION`, mapped or not. Its live prices decide whether an Auction House item actually has a market right now, and they make the unmapped-item check below able to fire.

The script downloads each file only if it is missing, and re-fetches the change file whenever the recipes need tags outside the set requested for the cached download, recorded beside it in `data/raw/coflnet-change.tags.json` (Coflnet omits tags it has no data for, so the response itself cannot prove coverage). Remove a file to refresh it. Git ignores all of them.

**Choosing the market for each ingredient and output**

For every recipe, the build decides how each ingredient and the output get priced, and stores that in the snapshot:

- `bazaar`: the item has a Bazaar product in the sample.
- `auction`: the item is not on the Bazaar, its wiki display name maps to a Coflnet tag in `src/data/ah-names.json` (a reviewed, hand-checked mapping; Coflnet's catalog has typos such as "Saphhire Crystal", so name matching alone is not trusted), the catalog flags it `AUCTION`, and Coflnet has a live price for it. The tag is stored with the item.
- unpriced: anything else. The recipe is excluded and the report gives the reason.

When Hypixel adds an item to the Bazaar, the next `data:update` switches it to Bazaar pricing automatically. An `AUCTION`-flagged item with live prices but no entry in `ah-names.json` stops the update with an error instead of being silently mispriced.

The updater prints a coverage report (per-section counts, exclusion groups, 92 of 119) and the spread between Coflnet's current and recent prices across all priced items. Those percentiles are the reference for the confidence stability cutoff.

**Outputs**

- `data/raw/recipes-raw.json`: parsed recipe data. This intermediate file is gitignored and not used by the app.
- `src/data/recipes.json`: the committed snapshot of supported recipes with a market label on each recipe, ingredient, and output. The app imports this file.
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

Two sources price the calculator's rows:

- **Bazaar items** use `https://api.hypixel.net/v2/skyblock/bazaar`. No API key is needed. The Bazaar pricing rules (order books, input/output modes, tax) are unchanged from the bazaar-only build.
- **Auction House items** use Coflnet's price API (`https://sky.coflnet.com/api/prices/change`, free and keyless). AH items have no order book here: buying is a buy-now at the current market sale price.

Coflnet is the second source because Hypixel publishes no per-item price endpoint for the Auction House. The Bazaar alone covers 30 recipes; the 62 Auction House recipes take the app to 92 of 119. Two alternatives were rejected when this was built: the official Auction House API works but needs about 96 MB across 42 paginated calls per refresh, and Moulberry's `lowest_bin.json` was returning HTTP 525. The official Auction House crawl is the documented fallback if Coflnet's terms or availability change; it is not shipped.

The order arrays are not sorted, so the calculator does not trust their order.

Input modes:

- Instant buy walks `sell_summary` from the lowest price until the required quantity is filled.
- Buy order uses the highest `buy_summary` price plus 0.1 per unit. Depth is the total buy-order amount divided by the required quantity.

Output modes:

- Instant sell walks `buy_summary` from the highest price until the output quantity is filled.
- Sell offer uses the lowest `sell_summary` price minus 0.1 per unit, with a floor of 0.1.

The mode toggles apply only to Bazaar items; AH items are buy-nows and sell-at-market regardless of mode. The 0.85 mode penalty stays recipe-wide.

Revenue is gross output value minus market-specific fees:

- Bazaar output: gross minus the bazaar tax. All bazaar sales carry a 1.25% tax, and the Bazaar Flipper community upgrade reduces it by 0.125% per level up to -0.25%, making the tax 1%. The settings select offers exactly the values that can occur in game: 1.25% (no perk), 1.125% (Bazaar Flipper 1), and 1% (Bazaar Flipper 2). The default is 1.25%.
- Auction House output: `now × qty` minus a BIN creation fee of 2% and, when the payout reaches 1,000,000 coins, the 1% collection tax ([Auction House → Fees and Taxes](https://hypixelskyblock.minecraft.wiki/w/Auction_House)). Both rates are constants (`AH_CREATION_FEE_RATE`, `AH_COLLECTION_TAX_RATE` in `src/lib/forge.ts`); the wiki brackets the creation fee at 2-5% by type and price bracket, and 2% is the common BIN case. Derpy's doubled-tax mayor window is not modeled.

The AH price shown per row is Coflnet's `now` field: the current market sale price estimate, not a lowest-BIN quote. A lone floor listing is a fragile anchor and would put per-item listing calls on the render path. Each AH item links to `https://sky.coflnet.com/item/{tag}` so a user can audit where the number came from. When `now` is missing, the item prices from `recent` (the recent-window typical price); an item with neither value is treated as unpriced. Per-item listing depth from Coflnet's `/analysis/live` could sharpen the confidence score later, but only behind a lazy cache, never on the render path.

Forge time uses the recipe duration and the selected time reduction. Percentage reductions stack additively. The in-game sources (Hypixel SkyBlock wiki, The Forge → Mechanics):

| Reduction      | Source                              | Condition                                                                                                                                                                |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10.5% → 30%    | Quick Forge (HotM perk)             | Level 1 gives 10.5%, grows in 0.5% steps to 19.5% at level 19, then jumps to 30% from level 20; max level is 21 with Blue Cheese Goblin Omelette. Updates retroactively. |
| 25%            | Cole's Molten Forge (mayor perk)    | Only while Cole is mayor, and only for forge processes started during his term.                                                                                          |
| -0.5s per kill | Gemstone Gauntlet's Kinetic ability | Flat seconds per Perfect Gemstone kill with a 1s cooldown, applied after the percentage sources. Not a percentage, so the calculator ignores it.                         |

The UI slider therefore runs 0 to 55% (Quick Forge 30% + Cole's Molten Forge 25%) in 0.5% steps matching Quick Forge's granularity. The default stays 0 so nothing about the player's perks is assumed. Profit per hour uses the reduced duration, with a one-second floor to avoid division by zero. Pricing clamps the reduction at 60%, above the achievable maximum.

If an order book cannot fill the requested quantity, the remaining units use the last order price and the depth score falls below 1. An empty order book cannot price the part at all: the recipe is dropped instead of being priced as free. The UI shows fill risk through confidence, not a separate warning.

## Confidence

Confidence is a heuristic from 0 to 100. It is not a fill probability.

| Part   | Weight | Input                                                                                               |
| ------ | -----: | --------------------------------------------------------------------------------------------------- |
| Depth  |    40% | Minimum fill ratio across inputs and output                                                         |
| Volume |    35% | Lower of input daily volume per required unit and output daily volume per output unit, scaled by 10 |
| Spread |    25% | Average bid/ask spread, where 0% spread scores 1 and 10% or more scores 0                           |

Order and offer modes multiply the score by 0.85. The result is clamped to 0 to 100.

Auction House items score on the same three parts so mixed-market rows stay on one scale:

- The 0.4 depth slot uses price stability: `1 - |now - recent| / recent`, saturating like the Bazaar spread curve so 10% relative drift scores 0. The data:update report prints the observed drift percentiles (p50 ≈ 5%, p90 ≈ 16% in the November 2026 check) as the reference for that cutoff. `recent` is deliberately the base and not the month-scale `monthly` average, which reads legitimate trend moves as instability.
- The 0.35 volume slot uses Coflnet's 24-hour sold volume, the same daily-unit curve (`min(daily) / 10`) the Bazaar side gets from `sellMovingWeek / 7`.
- The 0.25 spread slot uses the age of the price data: `exp(-hoursOld / 6)` from the per-item `lastUpdated` stamp. A stale price and a wide Bazaar spread mean the same thing: this may not be the price you actually get. A NEU-fallback price has no timestamp, so it scores 0 here.

Depth and volume still take the minimum across all ingredients and the output; the spread slot averages the Bazaar spread score (one term over its items) with each AH item's price-age score. An unpriced AH output renders with no revenue, profit, or profit-per-hour value and confidence 0; an unpriced AH ingredient hides the recipe rather than pricing the item as free.

The UI renders confidence as a plain percentage. A small info popover beside the column header explains the score and states that it is not a fill guarantee.

## Coflnet cache

`src/lib/ah.ts` fetches all Auction House prices in one `GET /api/prices/change?itemTags=<all tags>` request per hourly refresh, plus `GET /api/prices/neu` (a ~85 KB average-price map) only when items are missing from the change response. There is no per-item loop and no scheduled job.

`unstable_cache` uses the key `["coflnet-forge", <sorted tags>]` and `revalidate: 3_600`, matching the Bazaar cadence so both sources age together. The fetch itself uses `cache: "no-store"` so the cache wrapper owns caching. `src/app/forge/page.tsx` also sets `revalidate = 3_600`, so a price can be up to roughly two hours old, the same worst case as the Bazaar path. AH tags never enter the Bazaar cache key, so Bazaar cache entries do not invalidate when the AH item list grows.

Rate limits are per IP: 30 requests / 10 s and 100 requests / 1 min ([Coflnet API wiki](https://sky.coflnet.com/wiki/api)). Steady state is two requests per hour, and a 429 response retries with a short wait. The data:update catalog call adds one request per deploy.

Attribution, per Coflnet's rules: the app footer links to `https://sky.coflnet.com/data` ("AH prices provided by SkyCofl") on every page, and each AH item links to `https://sky.coflnet.com/item/{tag}` where the item's name is displayed. HS Tools is free and non-commercial, so no Premium+ subscription is required.

Neither source has an offline fallback: a failed Bazaar or Coflnet request fails the page render. The ISR cache then keeps serving the last fully priced page while revalidation retries on the next request, so an outage shows stale prices instead of a degraded calculator. The NEU fallback is best-effort and losing it only marks the affected items as unpriced.

## Checking against Coflnet's calculator

`node scripts/cross-check-flips.mjs` (manual, networked) compares this app's pricing against Coflnet's own forge calculator (`/api/flip/forge`): per-recipe output price (`now` vs their `sellPrice`), cost (per-ingredient sum vs their `craftCost`), and profit. It also prints `recent` vs their `craftData.median` per item, since the confidence stability score relies on those two staying close. In the November 2026 check the two sources agreed to a median of 4.3% on output prices and 2.9% on costs; the gaps widen on fast-moving items because the two are read at different times, and this script surfaces that drift instead of hiding it. Runs are noisy: the same check put 27 of 62 recipes outside the wide-profit band, with the largest gaps on fast movers such as Pendant of Divan. That is AH volatility plus sampling-time drift, not a regression, and the confidence score is meant to surface it; do not expect every run to reproduce the medians above.

## Bazaar cache

The full bazaar response is about 4.7 MB. `src/lib/bazaar.ts` filters the response to the product IDs used by Bazaar-priced ingredients and outputs before caching it.

`unstable_cache` uses the key `["bazaar-recipes", <sorted product IDs>]` and `revalidate: 3_600`. The fetch itself uses `cache: "no-store"` so the cache wrapper owns caching. `src/app/forge/page.tsx` also sets `revalidate = 3_600`. The key includes the Bazaar-priced item IDs of the supported recipes, so changing that set invalidates old cached data; AH tags deliberately never enter this key.

The app has no offline fallback. A failed bazaar request fails the page.

## Verification

```sh
pnpm test:unit
pnpm lint
pnpm build
```

`pnpm lint` runs Prettier check, ESLint, and `tsc --noEmit`.

Unit tests cover the AH fee branches, the unpriced-output and unpriced-ingredient rules, the build-time market classification, and the shape of the committed recipe data.

## Limitations

- Direct coin costs are recorded but not priced, which keeps four recipes (Divan's Drill, Gemstone Chamber, both Dwarven travel scrolls) out of the snapshot.
- Pets have no Hypixel item ID; their Coflnet tags exist and live in `ah-names.json`, but identity work (icons, the pet price-scale quirk) is a follow-up batch. Their recipes, plus Bejeweled Collar, exit at the no-item-ID check before `ah-names.json` is consulted, so those mappings are inert until that work lands.
- Perfect Gemstones, Relic of Power, and Secret Railroad Pass have an ingredient or output with no market and cannot be priced honestly.
- AH prices are Coflnet estimates, not order-book quotes; on fast-moving items they can trail the market until the next refresh, and the confidence score's price-age term reflects that.
- The 2% BIN creation fee is a constant; the wiki brackets it at 2-5% by type and price bracket, and Derpy's tax window is unmodeled.
- Item icons are fetched from SkyCrypt, with Coflnet as a fallback, during manual updates. If an upstream icon changes or an item ID is dropped, rerun `pnpm icons:update`; the recipe row still works if an icon file is missing.
- There is no historical price chart, no auction history, and no saved user settings.
- There is no theme toggle; only dark mode is supported.
