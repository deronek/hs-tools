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

export type RecipeIngredient = {
  name: string;
  qty: number;
  id: string | null;
};

export type Recipe = {
  section: string;
  name: string;
  outputId: string;
  outputQty: number;
  durationSeconds: number;
  hotm: string;
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

export type IngredientPrice = {
  id: string | null;
  name: string;
  qty: number;
  unit: number;
  cost: number;
  depth: number;
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

function volumeScore(products: BazaarProducts, recipe: Recipe) {
  const inputDaily = Math.min(
    ...recipe.ingredients.map((ingredient) => {
      const product = ingredient.id ? products[ingredient.id] : undefined;
      const daily = (product?.quick_status.sellMovingWeek ?? 0) / 7;
      return daily / Math.max(1, ingredient.qty);
    }),
  );
  const outputDaily =
    (products[recipe.outputId]?.quick_status.buyMovingWeek ?? 0) /
    7 /
    Math.max(1, recipe.outputQty);

  return clamp(Math.min(inputDaily, outputDaily) / 10, 0, 1);
}

function spreadScore(products: BazaarProducts, recipe: Recipe) {
  const ids = [
    ...recipe.ingredients.flatMap((ingredient) =>
      ingredient.id ? [ingredient.id] : [],
    ),
    recipe.outputId,
  ];
  const spreads = ids.map((id) => {
    const product = products[id];
    if (!product) return 1;
    const buy = bestBuy(product);
    const sell = bestSell(product);
    if (!Number.isFinite(sell) || sell <= 0 || buy <= 0) return 1;
    return clamp((sell - buy) / sell, 0, 1);
  });

  const average =
    spreads.reduce((sum, spread) => sum + spread, 0) / spreads.length;
  return 1 - clamp(average / 0.1, 0, 1);
}

export function priceRecipe(
  recipe: Recipe,
  products: BazaarProducts,
  settings: PricingSettings,
): PricedRecipe | null {
  const outputProduct = products[recipe.outputId];
  if (!outputProduct) return null;

  const ingredients = recipe.ingredients.map((ingredient) => {
    const product = ingredient.id ? products[ingredient.id] : undefined;
    if (!product)
      throw new Error(`Missing bazaar product for ${ingredient.name}`);
    return {
      ...priceIngredient(product, ingredient.qty, settings.inputMode),
      id: ingredient.id,
      name: ingredient.name,
    };
  });

  const cost = ingredients.reduce(
    (sum, ingredient) => sum + ingredient.cost,
    0,
  );
  const output = priceOutput(
    outputProduct,
    recipe.outputQty,
    settings.outputMode,
    settings.taxRate,
  );

  const depth = Math.min(
    ...ingredients.map((ingredient) => ingredient.depth),
    output.depth,
  );
  const volume = volumeScore(products, recipe);
  const spread = spreadScore(products, recipe);
  const modePenalty =
    settings.inputMode === "order" || settings.outputMode === "offer"
      ? 0.85
      : 1;
  const confidence = clamp(
    100 * (0.4 * depth + 0.35 * volume + 0.25 * spread) * modePenalty,
    0,
    100,
  );

  const hours =
    (recipe.durationSeconds *
      (1 - clamp(settings.timeReduction, 0, 60) / 100)) /
    3_600;
  const safeHours = hours > 0 ? hours : 1 / 3_600;
  const profit = output.revenue - cost;

  return {
    ...recipe,
    ingredients,
    cost,
    revenue: output.revenue,
    profit,
    profitPerHour: profit / safeHours,
    confidence,
    hours,
  };
}
