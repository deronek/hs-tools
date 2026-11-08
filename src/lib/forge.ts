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
 * Listing a BIN costs a creation fee of about 2%; collecting a sale of
 * 1,000,000 coins or more adds a 1% tax. Derpy's doubled-tax window is
 * not modeled.
 */
export const AH_CREATION_FEE_RATE = 0.02;
export const AH_COLLECTION_TAX_RATE = 0.01;
export const AH_COLLECTION_TAX_MIN = 1_000_000;

/** One Auction House price from Coflnet, keyed by Coflnet tag. */
export type AhPrice = {
  /** Current market sale price; `recent` or NEU average when `now` is missing. */
  price: number;
  /** Recent-window typical price, used for the stability score. */
  avg: number | null;
  monthly: number | null;
  /** Average units sold per day. */
  volumePerDay: number | null;
  /** Age of the price data in minutes; null when unknown. */
  priceAgeMinutes: number | null;
  source: "now" | "recent" | "neu";
};

export type AhPrices = Record<string, AhPrice>;

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
  revenue: number;
  profit: number;
  profitPerHour: number;
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
): IngredientPrice {
  if (mode === "instant") {
    const fill = fillFromOrders(product.sell_summary, qty, "asc");
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
  const unit = buy > 0 ? buy + 0.1 : 0;
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
) {
  let gross = 0;
  let depth = 1;

  if (mode === "instant") {
    const fill = fillFromOrders(product.buy_summary, qty, "desc");
    gross = fill.cost;
    depth = fill.depth;
  } else {
    const sell = bestSell(product);
    const unit =
      Number.isFinite(sell) && sell > 0 ? Math.max(0.1, sell - 0.1) : 0;
    gross = unit * qty;
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

/** AH fees applied to a sale payout. */
function ahFeeRate(payout: number) {
  return (
    AH_CREATION_FEE_RATE +
    (payout >= AH_COLLECTION_TAX_MIN ? AH_COLLECTION_TAX_RATE : 0)
  );
}

export function priceRecipe(
  recipe: Recipe,
  products: BazaarProducts,
  settings: PricingSettings,
  ahPrices: AhPrices = {},
): PricedRecipe | null {
  // A missing output product drops the row before ingredient pricing can
  // throw, so an unlisted output never becomes an error.
  if (recipe.outputMarket === "bazaar" && !products[recipe.outputId])
    return null;

  const depths: number[] = [];
  const dailies: number[] = [];
  const bazaarSpreads: number[] = [];
  const freshnesses: number[] = [];

  const ingredients: IngredientPrice[] = [];
  let cost = 0;

  for (const ingredient of recipe.ingredients) {
    if (ingredient.market === "auction") {
      const entry = ingredient.tag ? ahPrices[ingredient.tag] : undefined;
      // An Auction House ingredient with no price data can't be priced
      // honestly, so the recipe is dropped rather than treating it as free.
      if (!entry) return null;
      const daily = (entry.volumePerDay ?? 0) / Math.max(1, ingredient.qty);
      depths.push(ahStability(entry));
      dailies.push(daily);
      freshnesses.push(priceAgeScore(entry));
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
      continue;
    }

    const product = ingredient.id ? products[ingredient.id] : undefined;
    if (!product)
      throw new Error(`Missing bazaar product for ${ingredient.name}`);
    const priced = priceIngredient(product, ingredient.qty, settings.inputMode);
    ingredients.push({
      ...priced,
      id: ingredient.id,
      name: ingredient.name,
    });
    cost += priced.cost;
    depths.push(priced.depth);
    dailies.push(
      product.quick_status.sellMovingWeek / 7 / Math.max(1, ingredient.qty),
    );
    bazaarSpreads.push(bazaarSpread(product));
  }

  let revenue: number;
  let unlistedOutput = false;
  if (recipe.outputMarket === "auction") {
    const entry = recipe.outputTag ? ahPrices[recipe.outputTag] : undefined;
    if (entry) {
      const payout = entry.price * recipe.outputQty;
      revenue = payout * (1 - ahFeeRate(payout));
      depths.push(ahStability(entry));
      dailies.push((entry.volumePerDay ?? 0) / Math.max(1, recipe.outputQty));
      freshnesses.push(priceAgeScore(entry));
    } else {
      // Unlisted AH output: it cannot be sold, so the row stays with zero
      // revenue and zero confidence instead of disappearing silently.
      revenue = 0;
      unlistedOutput = true;
      depths.push(0);
      dailies.push(0);
      freshnesses.push(0);
    }
  } else {
    const outputProduct = products[recipe.outputId];
    if (!outputProduct) return null;
    const output = priceOutput(
      outputProduct,
      recipe.outputQty,
      settings.outputMode,
      settings.taxRate,
    );
    revenue = output.revenue;
    depths.push(output.depth);
    dailies.push(
      outputProduct.quick_status.buyMovingWeek /
        7 /
        Math.max(1, recipe.outputQty),
    );
    bazaarSpreads.push(bazaarSpread(outputProduct));
  }

  const depth = Math.min(...depths);
  const volume = clamp(Math.min(...dailies) / 10, 0, 1);

  // Bazaar items score on bid/ask spread, Auction House items on the age of
  // their price data. Both become 0..1 scores and this slot averages them.
  const spreadParts: number[] = [];
  if (bazaarSpreads.length > 0) {
    const average =
      bazaarSpreads.reduce((sum, spread) => sum + spread, 0) /
      bazaarSpreads.length;
    spreadParts.push(1 - clamp(average / 0.1, 0, 1));
  }
  spreadParts.push(...freshnesses);
  const spread =
    spreadParts.reduce((sum, part) => sum + part, 0) / spreadParts.length;

  const modePenalty =
    settings.inputMode === "order" || settings.outputMode === "offer"
      ? 0.85
      : 1;
  const confidence = unlistedOutput
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
  const profit = revenue - cost;

  return {
    ...recipe,
    ingredients,
    cost,
    revenue,
    profit,
    profitPerHour: profit / safeHours,
    confidence,
    hours,
  };
}
