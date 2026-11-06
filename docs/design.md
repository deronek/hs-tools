# Design

## Scope

This is an app for comparing Hypixel SkyBlock forge recipes by bazaar profit. It prices simple recipes only. A recipe is simple when its output and every direct ingredient have a bazaar product. It also must have no coin cost and no missing item ID.

The app uses a committed snapshot of the 30 simple recipes. The other 89 recipes and their exclusion reasons are listed in [recipe coverage](./recipes.md); they are not stored in the app data.

The main goal is a useful calculator with honest limits. Auction House pricing, recursive crafted inputs, coin costs, and pets are follow-up work.

## Data pipeline

The app reads the committed `src/data/recipes.json` snapshot. It contains only the 30 supported recipes. At runtime, the app fetches current prices from the Hypixel Bazaar API.

Run one command from the repository root to download any missing source files, parse recipes, and rebuild the snapshot:

```sh
pnpm data:update
```

Refresh the committed item icons separately when needed:

```sh
pnpm icons:update
```

The icon updater reads item IDs from `src/data/recipes.json` and writes WebP files to `public/item-icons`. Review and commit those files with recipe changes. The UI references the expected WebP path even before it exists, so an out-of-date icon set remains visible as a broken image.

**Inputs**

- `data/raw/wiki-table.html`: fetched from the [Hypixel SkyBlock Wiki API](https://hypixelskyblock.minecraft.wiki/api.php?action=parse&page=The_Forge%2FTable&prop=text&format=json). Contains the table with The Forge recipe names, costs, and durations.
- `data/raw/items.json`: fetched from the [SkyBlock items endpoint](https://api.hypixel.net/v2/resources/skyblock/items). Contains item names and IDs.
- `data/raw/bazaar-sample.json`: fetched from the [SkyBlock Bazaar endpoint](https://api.hypixel.net/v2/skyblock/bazaar). Its products determine which recipe items are tradeable.

The script downloads each file only if it is missing. Remove a file to refresh it. Git ignores all three.

**Outputs**

- `data/raw/recipes-raw.json`: parsed recipe data. This intermediate file is gitignored and not used by the app.
- `src/data/recipes.json`: the committed snapshot of supported recipes. The app imports this file.
- `docs/recipes.md`: the committed report of all parsed recipes and the reason each excluded recipe is unsupported.

The updater fetches the recipe-table page through MediaWiki's `action=parse` API. The parser takes recipe quantities from the rendered Cost lists. It ignores the embedded `data-bazaar` gadget because that gadget leaves out non-Bazaar ingredients and has outdated quantities for some recipes.

Current coverage:

| Section           | Total | Simple |
| ----------------- | ----: | -----: |
| Refining          |     5 |      5 |
| Forging           |    10 |     10 |
| Tools             |    15 |      0 |
| Gear              |    26 |      1 |
| Reforge_Stones    |    10 |     10 |
| Drill_Parts       |    16 |      0 |
| Perfect_Gemstones |    12 |      0 |
| Pets              |     9 |      0 |
| Other             |    16 |      4 |
| Total             |   119 |     30 |

Section IDs keep the wiki underscore form in data, such as `Reforge_Stones`. The UI replaces underscores with spaces.

## Pricing

Prices come from `https://api.hypixel.net/v2/skyblock/bazaar`. No API key is needed.

The order arrays are not sorted, so the calculator does not trust their order.

Input modes:

- Instant buy walks `sell_summary` from the lowest price until the required quantity is filled.
- Buy order uses the highest `buy_summary` price plus 0.1 per unit. Depth is the total buy-order amount divided by the required quantity.

Output modes:

- Instant sell walks `buy_summary` from the highest price until the output quantity is filled.
- Sell offer uses the lowest `sell_summary` price minus 0.1 per unit, with a floor of 0.1.

Revenue is gross output value minus the bazaar tax. All bazaar sales carry a 1.25% tax, and the Bazaar Flipper community upgrade reduces it by 0.125% per level up to -0.25%, making the tax 1%. The settings select offers exactly the values that can occur in game: 1.25% (no perk), 1.125% (Bazaar Flipper 1), and 1% (Bazaar Flipper 2). The default is 1.25%.

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

The UI renders confidence as a plain percentage. A small info popover beside the column header explains the score and states that it is not a fill guarantee.

## Bazaar cache

The full bazaar response is about 4.7 MB. `src/lib/bazaar.ts` filters the response to the product IDs used by recipes before caching it.

`unstable_cache` uses the key `["bazaar-recipes", <sorted product IDs>]` and `revalidate: 3_600`. The fetch itself uses `cache: "no-store"` so the wrapper owns caching. `src/app/page.tsx` also sets `revalidate = 3_600`. The key includes the simple recipe product IDs, so changing the simple set invalidates old cached data.

The app has no offline fallback. A failed bazaar request fails the page.

## Verification

```sh
pnpm test:unit
pnpm lint
pnpm build
```

`pnpm lint` runs Prettier check, ESLint, and `tsc --noEmit`.

## Limitations

- Auction House outputs are not priced. This covers most tools, gear, drill parts, and pets.
- Non-bazaar ingredients block a recipe even when the rest is bazaar-tradeable.
- Direct coin costs are recorded but not priced.
- Pets and some pet items have no Hypixel item ID.
- Item icons are copied from SkyCrypt during manual updates. If SkyCrypt changes or drops an item ID, rerun `pnpm icons:update`; the recipe row still works if an icon file is missing.
- There is no historical price chart, no auction history, and no saved user settings.
- There is no theme toggle; only dark mode is supported.
