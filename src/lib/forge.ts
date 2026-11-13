export type BazaarOrder = {
  amount: number;
  pricePerUnit: number;
  orders: number;
};

export type BazaarProduct = {
  quick_status: {
    productId: string;
    sellPrice: number;
    sellVolume: number;
    sellMovingWeek: number;
    sellOrders: number;
    buyPrice: number;
    buyVolume: number;
    buyMovingWeek: number;
    buyOrders: number;
  };
  sell_summary: BazaarOrder[];
  buy_summary: BazaarOrder[];
};

export type BazaarProducts = Record<string, BazaarProduct>;

export type Market = "bazaar" | "auction";

export type RecipeIngredient = {
  name: string;
  qty: number;
  id: string | null;
  market: Market;
  /** Coflnet tag, present on auction ingredients. */
  tag?: string;
};

export type Recipe = {
  section: string;
  name: string;
  outputId: string;
  outputQty: number;
  durationSeconds: number;
  hotm: string;
  outputMarket: Market;
  /** Coflnet tag for auction outputs. */
  outputTag?: string;
  ingredients: RecipeIngredient[];
};

export type PricingSettings = {
  inputMode: "instant" | "order";
  outputMode: "instant" | "offer";
  taxRate: number;
  timeReduction: number;
  minConfidence: number;
};

export const DEFAULT_SETTINGS: PricingSettings = {
  inputMode: "instant",
  outputMode: "instant",
  taxRate: 1.25,
  timeReduction: 0,
  minConfidence: 0,
};

/**
 * Auction House fees, from the wiki (Auction House → Fees and Taxes).
 * A BIN listing pays a creation fee that scales with the item price (1%
 * below 10,000,000 coins, 2% up to 100,000,000, 2.5% above), and collecting
 * a sale above 1,000,000 coins adds a 1% tax capped so the proceeds never
 * fall below 1,000,000 coins. Derpy's doubled-tax window is not modeled.
 */
export const AH_COLLECTION_TAX_RATE = 0.01;
export const AH_COLLECTION_TAX_MIN = 1_000_000;

/** One Auction House price from Coflnet, keyed by Coflnet tag. */
export type AhPrice = {
  /** Current market sale price; `recent` or NEU average when `now` is missing. */
  price: number;
  /** Recent-window typical price, used for the stability score. */
  avg: number | null;
  /** Average units sold per day. */
  volumePerDay: number | null;
  /** Age of the price data in minutes; null when unknown. */
  priceAgeMinutes: number | null;
};

export type AhPrices = Record<string, AhPrice>;

export type AhSnapshot = {
  fetchedAt: number;
  items: AhPrices;
};

export type IngredientPrice = {
  id: string | null;
  name: string;
  qty: number;
  unit: number;
  cost: number;
  depth: number;
  market: Market;
  tag?: string;
};

export type PricedRecipe = Omit<Recipe, "ingredients"> & {
  cost: number;
  /** Null when the output has no price data and cannot be sold. */
  revenue: number | null;
  profit: number | null;
  profitPerHour: number | null;
  confidence: number;
  hours: number;
  ingredients: IngredientPrice[];
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function bestBuy(product: BazaarProduct) {
  return product.buy_summary.reduce(
    (best, order) => Math.max(best, order.pricePerUnit),
    0,
  );
}

function bestSell(product: BazaarProduct) {
  return product.sell_summary.reduce(
    (best, order) => Math.min(best, order.pricePerUnit),
    Number.POSITIVE_INFINITY,
  );
}

function fillFromOrders(
  orders: BazaarOrder[],
  qty: number,
  direction: "asc" | "desc",
) {
  const sorted = orders
    .filter((order) => order.amount > 0 && order.pricePerUnit > 0)
    .sort((a, b) =>
      direction === "asc"
        ? a.pricePerUnit - b.pricePerUnit
        : b.pricePerUnit - a.pricePerUnit,
    );

  // An empty order book has no price anchor; callers drop the row.
  if (sorted.length === 0) return null;

  let remaining = qty;
  let filled = 0;
  let cost = 0;

  for (const order of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, order.amount);
    cost += take * order.pricePerUnit;
    filled += take;
    remaining -= take;
  }

  if (remaining > 0) {
    const lastPrice = sorted.at(-1)?.pricePerUnit ?? 0;
    cost += remaining * lastPrice;
  }

  return {
    cost,
    depth: qty > 0 ? clamp(filled / qty, 0, 1) : 1,
  };
}

function priceIngredient(
  product: BazaarProduct,
  qty: number,
  mode: PricingSettings["inputMode"],
): IngredientPrice | null {
  if (mode === "instant") {
    const fill = fillFromOrders(product.sell_summary, qty, "asc");
    if (!fill) return null;
    return {
      id: product.quick_status.productId,
      name: product.quick_status.productId,
      qty,
      unit: qty > 0 ? fill.cost / qty : 0,
      cost: fill.cost,
      depth: fill.depth,
      market: "bazaar",
    };
  }

  const buy = bestBuy(product);
  if (buy <= 0) return null;
  const unit = buy + 0.1;
  const available = product.buy_summary.reduce(
    (sum, order) => sum + order.amount,
    0,
  );

  return {
    id: product.quick_status.productId,
    name: product.quick_status.productId,
    qty,
    unit,
    cost: unit * qty,
    depth: qty > 0 ? clamp(available / qty, 0, 1) : 1,
    market: "bazaar",
  };
}

function priceOutput(
  product: BazaarProduct,
  qty: number,
  mode: PricingSettings["outputMode"],
  taxRate: number,
): { revenue: number; depth: number } | null {
  let gross = 0;
  let depth = 1;

  if (mode === "instant") {
    const fill = fillFromOrders(product.buy_summary, qty, "desc");
    if (!fill) return null;
    gross = fill.cost;
    depth = fill.depth;
  } else {
    const sell = bestSell(product);
    if (!Number.isFinite(sell) || sell <= 0) return null;
    gross = Math.max(0.1, sell - 0.1) * qty;
    const available = product.sell_summary.reduce(
      (sum, order) => sum + order.amount,
      0,
    );
    depth = qty > 0 ? clamp(available / qty, 0, 1) : 1;
  }

  const tax = clamp(taxRate, 0, 100) / 100;
  return { revenue: gross * (1 - tax), depth };
}

/** Bazaar bid/ask spread as a raw 0..1 ratio. */
function bazaarSpread(product: BazaarProduct) {
  const buy = bestBuy(product);
  const sell = bestSell(product);
  if (!Number.isFinite(sell) || sell <= 0 || buy <= 0) return 1;
  return clamp((sell - buy) / sell, 0, 1);
}

/**
 * Price stability: how far the current price sits from the recent-window
 * typical price, saturating like the Bazaar spread curve (10% relative drift
 * scores 0).
 */
function ahStability(price: AhPrice) {
  if (price.avg == null || price.avg <= 0) return 0;
  const drift = Math.abs(price.price - price.avg) / price.avg;
  return 1 - clamp(drift / 0.1, 0, 1);
}

/** Score from the age of the price data; six hours old scores about 37%. */
function priceAgeScore(price: AhPrice) {
  if (price.priceAgeMinutes == null) return 0;
  return Math.exp(-price.priceAgeMinutes / 60 / 6);
}

/** BIN creation fee bracket for a payout, from the wiki (Fees and Taxes). */
export function ahCreationFeeRate(payout: number) {
  if (payout < 10_000_000) return 0.01;
  if (payout <= 100_000_000) return 0.02;
  return 0.025;
}

/**
 * Collection tax on a payout: 1% only above 1,000,000 coins, capped so the
 * proceeds never fall below 1,000,000.
 */
export function ahCollectionTax(payout: number) {
  if (payout <= AH_COLLECTION_TAX_MIN) return 0;
  return Math.min(
    payout * AH_COLLECTION_TAX_RATE,
    payout - AH_COLLECTION_TAX_MIN,
  );
}

/** Shared with scripts/cross-check-flips.mjs, which validates against this exact model. */
export function ahFees(payout: number) {
  return payout * ahCreationFeeRate(payout) + ahCollectionTax(payout);
}

type PartScore = {
  depth: number;
  daily: number;
  bazaarSpread?: number;
  freshness?: number;
};

function bazaarScore(
  product: BazaarProduct,
  qty: number,
  movingWeek: number,
  depth: number,
): PartScore {
  return {
    depth,
    daily: movingWeek / 7 / Math.max(1, qty),
    bazaarSpread: bazaarSpread(product),
  };
}

function auctionScore(entry: AhPrice, qty: number): PartScore {
  return {
    depth: ahStability(entry),
    daily: (entry.volumePerDay ?? 0) / Math.max(1, qty),
    freshness: priceAgeScore(entry),
  };
}

/**
 * Prices the recipe output; null drops the row. An unlisted AH output keeps
 * the row with a null revenue instead.
 */
function priceOutputPart(
  recipe: Recipe,
  products: BazaarProducts,
  settings: PricingSettings,
  ahPrices: AhPrices,
): { revenue: number | null; score: PartScore } | null {
  if (recipe.outputMarket === "auction") {
    const entry = recipe.outputTag ? ahPrices[recipe.outputTag] : undefined;
    if (!entry) {
      // Unlisted AH output: it cannot be sold, so the row stays without a
      // revenue value and with zero confidence instead of disappearing
      // silently.
      return { revenue: null, score: { depth: 0, daily: 0, freshness: 0 } };
    }
    const payout = entry.price * recipe.outputQty;
    return {
      revenue: payout - ahFees(payout),
      score: auctionScore(entry, recipe.outputQty),
    };
  }

  const product = products[recipe.outputId];
  if (!product) return null;
  const priced = priceOutput(
    product,
    recipe.outputQty,
    settings.outputMode,
    settings.taxRate,
  );
  if (!priced) return null;
  return {
    revenue: priced.revenue,
    score: bazaarScore(
      product,
      recipe.outputQty,
      product.quick_status.buyMovingWeek,
      priced.depth,
    ),
  };
}

export function priceRecipe(
  recipe: Recipe,
  products: BazaarProducts,
  settings: PricingSettings,
  ahPrices: AhPrices,
): PricedRecipe | null {
  const output = priceOutputPart(recipe, products, settings, ahPrices);
  if (!output) return null;

  const scores: PartScore[] = [output.score];
  const ingredients: IngredientPrice[] = [];
  let cost = 0;

  for (const ingredient of recipe.ingredients) {
    if (ingredient.market === "auction") {
      const entry = ingredient.tag ? ahPrices[ingredient.tag] : undefined;
      // An Auction House ingredient with no price data can't be priced
      // honestly, so the recipe is dropped rather than treating it as free.
      if (!entry) return null;
      const ingredientPrice: IngredientPrice = {
        id: ingredient.id,
        name: ingredient.name,
        qty: ingredient.qty,
        unit: entry.price,
        cost: entry.price * ingredient.qty,
        depth: ahStability(entry),
        market: "auction",
        tag: ingredient.tag,
      };
      ingredients.push(ingredientPrice);
      cost += ingredientPrice.cost;
      scores.push(auctionScore(entry, ingredient.qty));
      continue;
    }

    const product = ingredient.id ? products[ingredient.id] : undefined;
    if (!product)
      throw new Error(`Missing bazaar product for ${ingredient.name}`);
    const priced = priceIngredient(product, ingredient.qty, settings.inputMode);
    if (!priced) return null;
    ingredients.push({
      ...priced,
      id: ingredient.id,
      name: ingredient.name,
    });
    cost += priced.cost;
    scores.push(
      bazaarScore(
        product,
        ingredient.qty,
        product.quick_status.sellMovingWeek,
        priced.depth,
      ),
    );
  }

  const depth = Math.min(...scores.map((score) => score.depth));
  const volume = clamp(
    Math.min(...scores.map((score) => score.daily)) / 10,
    0,
    1,
  );

  // Bazaar items score on bid/ask spread, Auction House items on the age of
  // their price data. Both become 0..1 scores and this slot averages them.
  const spreads = scores.flatMap((score) =>
    score.bazaarSpread === undefined ? [] : [score.bazaarSpread],
  );
  const spreadParts: number[] = [];
  if (spreads.length > 0) {
    const average =
      spreads.reduce((sum, spread) => sum + spread, 0) / spreads.length;
    spreadParts.push(1 - clamp(average / 0.1, 0, 1));
  }
  spreadParts.push(
    ...scores.flatMap((score) =>
      score.freshness === undefined ? [] : [score.freshness],
    ),
  );
  const spread =
    spreadParts.reduce((sum, part) => sum + part, 0) / spreadParts.length;

  const modePenalty =
    settings.inputMode === "order" || settings.outputMode === "offer"
      ? 0.85
      : 1;
  const confidence =
    output.revenue === null
      ? 0
      : clamp(
          100 * (0.4 * depth + 0.35 * volume + 0.25 * spread) * modePenalty,
          0,
          100,
        );

  const hours =
    (recipe.durationSeconds *
      (1 - clamp(settings.timeReduction, 0, 60) / 100)) /
    3_600;
  const safeHours = hours > 0 ? hours : 1 / 3_600;
  const profit = output.revenue === null ? null : output.revenue - cost;

  return {
    ...recipe,
    ingredients,
    cost,
    revenue: output.revenue,
    profit,
    profitPerHour: profit === null ? null : profit / safeHours,
    confidence,
    hours,
  };
}

/**
 * Market identifiers the recipes need: Bazaar product IDs and Coflnet tags.
 * AH tags never enter the Bazaar cache key and vice versa; this is the one
 * place that walks the recipes for both.
 */
export function collectMarketNeeds(recipes: Recipe[]): {
  bazaarIds: string[];
  auctionTags: string[];
} {
  const bazaarIds = new Set<string>();
  const auctionTags = new Set<string>();
  for (const recipe of recipes) {
    if (recipe.outputMarket === "bazaar" && recipe.outputId)
      bazaarIds.add(recipe.outputId);
    if (recipe.outputMarket === "auction" && recipe.outputTag)
      auctionTags.add(recipe.outputTag);
    for (const ingredient of recipe.ingredients) {
      if (ingredient.market === "bazaar" && ingredient.id)
        bazaarIds.add(ingredient.id);
      if (ingredient.market === "auction" && ingredient.tag)
        auctionTags.add(ingredient.tag);
    }
  }
  return {
    bazaarIds: [...bazaarIds].sort(),
    auctionTags: [...auctionTags].sort(),
  };
}
