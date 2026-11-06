const WIKI_ITEM_URL = "https://hypixelskyblock.minecraft.wiki/w";

export function getWikiItemUrl(name: string) {
  return `${WIKI_ITEM_URL}/${encodeURIComponent(name.replaceAll(" ", "_"))}`;
}
