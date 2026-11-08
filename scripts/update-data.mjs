import { spawnSync } from "node:child_process";
import fs from "node:fs";

const sources = [
  {
    path: "data/raw/wiki-table.html",
    url: "https://hypixelskyblock.minecraft.wiki/api.php?action=parse&page=The_Forge%2FTable&prop=text&format=json",
    transform: (content) => JSON.parse(content).parse.text["*"],
    validate: (content) =>
      [
        "Refining",
        "Forging",
        "Tools",
        "Gear",
        "Reforge_Stones",
        "Drill_Parts",
        "Perfect_Gemstones",
        "Pets",
        "Other",
      ].every((section) => content.includes(`<h3 id="${section}">`)),
  },
  {
    path: "data/raw/items.json",
    url: "https://api.hypixel.net/v2/resources/skyblock/items",
    validate: (content) => Array.isArray(JSON.parse(content).items),
  },
  {
    path: "data/raw/bazaar-sample.json",
    url: "https://api.hypixel.net/v2/skyblock/bazaar",
    validate: (content) => {
      const { products } = JSON.parse(content);
      return products && typeof products === "object";
    },
  },
  {
    path: "data/raw/coflnet-items.json",
    url: "https://sky.coflnet.com/api/items",
    validate: (content) => {
      const items = JSON.parse(content);
      return (
        Array.isArray(items) &&
        items.every((item) => typeof item.tag === "string")
      );
    },
  },
];

// The change payload covers every tag in the reviewed AH mapping, so the
// classification report can check live markets, not just catalog flags.
const ahNames = JSON.parse(fs.readFileSync("src/data/ah-names.json", "utf8"));
const ahTags = [...new Set(Object.values(ahNames))].sort();
sources.push({
  path: "data/raw/coflnet-change.json",
  url: `https://sky.coflnet.com/api/prices/change?itemTags=${ahTags.join(",")}`,
  validate: (content) => {
    const change = JSON.parse(content);
    return change && typeof change === "object" && !Array.isArray(change);
  },
});

fs.mkdirSync("data/raw", { recursive: true });

for (const source of sources) {
  if (fs.existsSync(source.path)) {
    console.log(`Using ${source.path}`);
    continue;
  }

  console.log(`Downloading ${source.url} to ${source.path}`);
  const response = await fetch(source.url, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `Download failed for ${source.url}: HTTP ${response.status}`,
    );
  }

  const responseContent = await response.text();
  const content = source.transform
    ? source.transform(responseContent)
    : responseContent;
  if (!source.validate(content)) {
    throw new Error(`Unexpected response from ${source.url}`);
  }
  fs.writeFileSync(source.path, content);
}

for (const script of ["parse-wiki.mjs", "build-data.mjs"]) {
  const result = spawnSync(process.execPath, [`scripts/${script}`], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
