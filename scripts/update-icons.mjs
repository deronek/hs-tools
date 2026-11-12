import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { isProperRender, reduceUpscale } from "./lib/icon-cache.mjs";

const PNG_SIGNATURE = "89504e470d0a1a0a";
const ICONS_DIRECTORY = "public/item-icons";
const ICON_MAP_FILE = "src/data/item-icons.json";
const WIKI_USER_AGENT = "hs-tools (https://github.com/deronek/hs-tools)";
const WIKI_ICON_SIZE = 16;

// SkyCrypt serves a placeholder and Coflnet corrupted art for these items,
// so their texture comes from the wiki instead. Direct file URLs on the
// wiki mirror, verified by hand; the wiki serves 160x160 renders of 16x16
// game textures.
const WIKI_OVERRIDES = {
  GEMSTONE_DRILL_3:
    "https://hypixelskyblock.minecraft.wiki/images/Topaz_Drill_KGR-12.gif",
  GEMSTONE_DRILL_4:
    "https://hypixelskyblock.minecraft.wiki/images/Jasper_Drill_X.gif",
  TITANIUM_DRILL_4:
    "https://hypixelskyblock.minecraft.wiki/images/Titanium_Drill_DR-X655.gif",
};

const recipes = JSON.parse(
  await fs
    .readFile("src/data/recipes.json", "utf8")
    .then((value) => value.replace(/^\uFEFF/, "")),
);
const ids = [
  ...new Set(
    recipes.flatMap((recipe) => [
      recipe.outputId,
      ...recipe.ingredients.map((ingredient) => ingredient.id),
    ]),
  ),
].filter((id) => id !== null);

if (ids.some((id) => typeof id !== "string" || !/^[A-Z0-9_]+$/.test(id))) {
  throw new Error("Recipe data contains an invalid item ID.");
}

const icons = JSON.parse(await fs.readFile(ICON_MAP_FILE, "utf8"));

const fetchSkyCryptIcon = async (id) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(
      `https://sky.shiiyu.moe/api/item/${encodeURIComponent(id)}`,
      {
        headers: { Accept: "image/webp" },
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (response.ok) {
      const candidate = Buffer.from(await response.arrayBuffer());
      const isWebp =
        candidate.toString("ascii", 0, 4) === "RIFF" &&
        candidate.toString("ascii", 8, 12) === "WEBP";
      const isPng = candidate.subarray(0, 8).toString("hex") === PNG_SIGNATURE;
      if (isWebp || isPng) return candidate;
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return null;
};

const fetchCoflnetIcon = async (id) => {
  const response = await fetch(
    `https://sky.coflnet.com/static/icon/${encodeURIComponent(id)}`,
    { signal: AbortSignal.timeout(60_000) },
  );
  if (!response.ok) return null;
  const fallback = Buffer.from(await response.arrayBuffer());
  const isWebp =
    fallback.toString("ascii", 0, 4) === "RIFF" &&
    fallback.toString("ascii", 8, 12) === "WEBP";
  const isPng = fallback.subarray(0, 8).toString("hex") === PNG_SIGNATURE;
  return isWebp || isPng ? fallback : null;
};

const fetchWikiIcon = async (url) => {
  const response = await fetch(url, {
    headers: { "User-Agent": WIKI_USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) return null;
  const image = Buffer.from(await response.arrayBuffer());
  const isGif = image.toString("ascii", 0, 3) === "GIF";
  const isWebp =
    image.toString("ascii", 0, 4) === "RIFF" &&
    image.toString("ascii", 8, 12) === "WEBP";
  const isPng = image.subarray(0, 8).toString("hex") === PNG_SIGNATURE;
  return isGif || isWebp || isPng ? image : null;
};

// Decodes the first frame (animated inputs read page 1 by default) as RGBA.
const decodeFirstFrame = (image) =>
  sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

// Lossless keeps Minecraft pixel art crisp; content hashes are taken over
// these final bytes.
const encodeIconWebp = ({ data, width, height }) =>
  sharp(data, { raw: { width, height, channels: 4 } })
    .webp({ lossless: true })
    .toBuffer();

// Normalizes any upstream image (PNG, WebP, animated) to a single-frame
// lossless WebP at its base texture size.
const normalizeIcon = async (image) => {
  const { data, info } = await decodeFirstFrame(image);
  const reduced = reduceUpscale({
    data,
    width: info.width,
    height: info.height,
  });
  return encodeIconWebp(
    reduced ?? { data, width: info.width, height: info.height },
  );
};

const counts = { skycrypt: 0, coflnet: 0, wiki: 0, downscale: 0, keep: 0 };
const changedIds = [];
const failures = [];
const processedIcons = [];

for (const id of ids) {
  const previous = icons[id];
  const previousPath = previous && path.join(ICONS_DIRECTORY, previous);
  const previousBuf = previousPath
    ? await fs.readFile(previousPath).catch(() => undefined)
    : undefined;

  let normalized;
  let source;
  if (WIKI_OVERRIDES[id]) {
    const wiki = await fetchWikiIcon(WIKI_OVERRIDES[id]);
    if (wiki && isProperRender(await sharp(wiki).metadata())) {
      // The wiki serves large renders of the 16x16 game textures.
      normalized = await sharp(wiki)
        .resize(WIKI_ICON_SIZE, WIKI_ICON_SIZE, { kernel: "nearest" })
        .webp({ lossless: true })
        .toBuffer();
      source = "wiki";
    } else {
      console.warn(
        `warning: wiki override for ${id} did not return proper art`,
      );
    }
  }
  if (!normalized && !previousBuf) {
    const sky = await fetchSkyCryptIcon(id);
    if (sky && isProperRender(await sharp(sky).metadata())) {
      normalized = await normalizeIcon(sky);
      source = "skycrypt";
    } else {
      const coflnet = await fetchCoflnetIcon(id);
      if (coflnet) {
        normalized = await normalizeIcon(coflnet);
        source = "coflnet";
      }
    }
  }
  if (!normalized && previousBuf) {
    // The committed icon is the art source of truth: keep its pixels and
    // only rewrite it when it is stored larger than its base texture size.
    const { data, info } = await decodeFirstFrame(previousBuf);
    const reduced = reduceUpscale({
      data,
      width: info.width,
      height: info.height,
    });
    if (reduced) {
      normalized = await encodeIconWebp(reduced);
      source = "downscale";
    }
  }

  if (!normalized) {
    if (previousBuf) {
      counts.keep++;
      continue;
    }
    failures.push(id);
    continue;
  }

  const hash = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 16);
  const filename = `${id}.${hash}.webp`;
  processedIcons.push({ id, normalized });
  if (previousBuf && previous === filename) {
    counts.keep++;
    continue;
  }
  await fs.writeFile(path.join(ICONS_DIRECTORY, filename), normalized);
  icons[id] = filename;
  changedIds.push(id);
  if (previousBuf) await fs.rm(previousPath, { force: true });
  counts[source]++;
}

// Distinct items sharing one image usually means an upstream placeholder.
{
  const byHash = new Map();
  for (const { id, normalized } of processedIcons) {
    const hash = createHash("sha256").update(normalized).digest("hex");
    byHash.set(hash, [...(byHash.get(hash) ?? []), id]);
  }
  for (const [, sharedIds] of byHash) {
    if (sharedIds.length > 1) {
      console.warn(
        `warning: identical icon bytes for ${sharedIds.join(", ")}; check for upstream placeholder icons`,
      );
    }
  }
}

if (changedIds.length > 0) {
  await fs.writeFile(ICON_MAP_FILE, `${JSON.stringify(icons, null, 2)}\n`);
}

const referenced = new Set(Object.values(icons));
for (const filename of await fs.readdir(ICONS_DIRECTORY)) {
  if (
    /^[A-Z0-9_]+\.[a-f0-9]{16}\.webp$/.test(filename) &&
    !referenced.has(filename)
  ) {
    await fs.rm(path.join(ICONS_DIRECTORY, filename));
  }
}

if (failures.length > 0) {
  throw new Error(`No icon could be resolved for: ${failures.join(", ")}`);
}

console.log(
  `Item icons: ${counts.keep} kept, ${counts.downscale} downscaled, ${counts.wiki} from wiki overrides, ${counts.skycrypt} from SkyCrypt, ${counts.coflnet} from Coflnet (${changedIds.length} files changed in ${ICONS_DIRECTORY}).`,
);
