import { describe, expect, it } from "vitest";

import type { Recipe } from "../lib/forge";
import recipes from "./recipes.json";

const appRecipes = recipes as Recipe[];
const byName = new Map(appRecipes.map((recipe) => [recipe.name, recipe]));
const ingredients = (name: string) =>
  byName.get(name)?.ingredients.map(({ name, qty }) => [name, qty]);

describe("recipe data", () => {
  it("contains only the supported recipes", () => {
    expect(appRecipes).toHaveLength(92);
    expect(
      appRecipes.every(
        ({ outputId, ingredients }) =>
          outputId &&
          ingredients.every(({ id, name }) => id && name !== "Coins"),
      ),
    ).toBe(true);
    expect(appRecipes.every((recipe) => !("isSimple" in recipe))).toBe(true);
  });

  it("labels every recipe and leg with its market", () => {
    expect(
      appRecipes.every(
        (recipe) =>
          (recipe.outputMarket === "bazaar" ||
            recipe.outputMarket === "auction") &&
          recipe.ingredients.every(({ market, tag }) =>
            market === "bazaar"
              ? tag === undefined
              : market === "auction" && typeof tag === "string",
          ),
      ),
    ).toBe(true);
    expect(appRecipes.some((recipe) => recipe.outputMarket === "auction")).toBe(
      true,
    );
  });

  it("includes every ingredient from flat Cost lists", () => {
    expect(ingredients("Divan's Powder Coating")).toEqual([
      ["Glossy Gemstone", 32],
      ["Refined Mineral", 32],
      ["Divan Fragment", 5],
      ["Enchanted Gold Block", 16],
    ]);
    expect(ingredients("Skeleton Key")).toEqual([
      ["Bejeweled Handle", 1],
      ["Perfect Plate", 1],
    ]);
  });

  it("has ingredients for every recipe", () => {
    expect(appRecipes.filter((recipe) => recipe.ingredients.length === 0)).toEqual(
      [],
    );
  });
});
