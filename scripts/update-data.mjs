import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { neededChangeTags } from "./lib/recipe-parts.mjs";

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

const CHANGE_PATH = "data/raw/coflnet-change.json";
const CHANGE_TAGS_PATH = "data/raw/coflnet-change.tags.json";

fs.mkdirSync("data/raw", { recursive: true });

async function download(source) {
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

function runScript(script) {
  const result = spawnSync(process.execPath, [`scripts/${script}`], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function collectChangeTags() {
  const recipes = JSON.parse(
    fs.readFileSync("data/raw/recipes-raw.json", "utf8"),
  );
  const ahNames = JSON.parse(fs.readFileSync("src/data/ah-names.json", "utf8"));
  const catalog = JSON.parse(
    fs
      .readFileSync("data/raw/coflnet-items.json", "utf8")
      .replace(/^\uFEFF/, ""),
  );
  const auctionFlags = new Set(
    catalog
      .filter((item) =>
        String(item.flags ?? "")
          .split(",")
          .map((flag) => flag.trim())
          .includes("AUCTION"),
      )
      .map((item) => item.tag),
  );
  return neededChangeTags(recipes, ahNames, auctionFlags);
}

for (const source of sources) {
  if (fs.existsSync(source.path)) {
    console.log(`Using ${source.path}`);
    continue;
  }
  await download(source);
}

// Parse before fetching change data so the payload covers every
// AUCTION-flagged recipe part, mapped or not. Scoped to the reviewed
// mappings alone, build-data's unmapped-item guard can never fire, and a
// newly added mapping stays unpriced until the raw file is deleted.
runScript("parse-wiki.mjs");

const neededTags = collectChangeTags();
// The payload can't prove coverage: Coflnet omits tags it has no data for.
// The tags file records what the cached download requested.
const covered = () => {
  try {
    JSON.parse(fs.readFileSync(CHANGE_PATH, "utf8"));
    const requested = JSON.parse(fs.readFileSync(CHANGE_TAGS_PATH, "utf8"));
    return (
      Array.isArray(requested) &&
      neededTags.every((tag) => requested.includes(tag))
    );
  } catch {
    return false;
  }
};

if (!covered()) {
  await download({
    path: CHANGE_PATH,
    url: `https://sky.coflnet.com/api/prices/change?itemTags=${neededTags.join(",")}`,
    // Coflnet omits tags it has no data for, so an incomplete payload is
    // expected; classification treats absent tags as unpriced. An entirely
    // empty object is different: it would drop every AH row from the
    // snapshot until the next update, so treat it as a failed download.
    validate: (content) => {
      const change = JSON.parse(content);
      return (
        change &&
        typeof change === "object" &&
        !Array.isArray(change) &&
        Object.keys(change).length > 0
      );
    },
  });
  // Written after the download: a crash in between must not mark stale data covered.
  fs.writeFileSync(CHANGE_TAGS_PATH, JSON.stringify(neededTags));
}

runScript("build-data.mjs");
