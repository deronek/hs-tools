import { describe, expect, it } from "vitest";

import { getWikiItemUrl } from "./wiki";

describe("getWikiItemUrl", () => {
  it("uses the wiki page title for an item name", () => {
    expect(getWikiItemUrl("Divan's Powder Coating")).toBe(
      "https://hypixelskyblock.minecraft.wiki/w/Divan's_Powder_Coating",
    );
  });
});
