import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const PNG_SIGNATURE = "89504e470d0a1a0a";

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

const icons = [];
for (const id of ids) {
  let image;
  let invalidResponse = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(
      `https://sky.shiiyu.moe/api/item/${encodeURIComponent(id)}`,
      {
        headers: { Accept: "image/webp" },
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok) {
      invalidResponse = `HTTP ${response.status}`;
    } else {
      const candidate = Buffer.from(await response.arrayBuffer());
      const isWebp =
        candidate.toString("ascii", 0, 4) === "RIFF" &&
        candidate.toString("ascii", 8, 12) === "WEBP";
      const isPng = candidate.subarray(0, 8).toString("hex") === PNG_SIGNATURE;

      // SkyCrypt's WebP path serves proper item textures; its PNG path has
      // served identical placeholder bytes for distinct items, so a PNG
      // response falls back to Coflnet's per-tag icon before being trusted.
      // Every icon is stored as WebP, so a PNG outcome is converted below.
      if (isWebp) {
        image = candidate;
        break;
      }
      if (isPng) {
        const coflnet = await fetch(
          `https://sky.coflnet.com/static/icon/${encodeURIComponent(id)}`,
          { signal: AbortSignal.timeout(60_000) },
        );
        const fallback = Buffer.from(await coflnet.arrayBuffer());
        if (
          coflnet.ok &&
          fallback.subarray(0, 8).toString("hex") === PNG_SIGNATURE
        ) {
          image = fallback;
          break;
        }
        image = candidate;
        break;
      }

      invalidResponse = `content-type ${response.headers.get("content-type") ?? "missing"}, signature ${candidate.subarray(0, 12).toString("hex") || "empty"}`;
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!image) {
    throw new Error(
      `Icon download for ${id} did not return an image after 3 attempts (${invalidResponse}).`,
    );
  }
  if (image.subarray(0, 8).toString("hex") === PNG_SIGNATURE) {
    // Lossless keeps Minecraft pixel art crisp.
    image = await sharp(image).webp({ lossless: true }).toBuffer();
  } else if ((await sharp(image).metadata()).pages > 1) {
    // SkyCrypt serves animated WebP for some items (gemstones, drill
    // engines). sharp reads one page by default, so re-encoding stores
    // only the first frame.
    image = await sharp(image).webp({ lossless: true }).toBuffer();
  }
  icons.push([id, image]);
}

// Distinct items sharing one image usually means an upstream placeholder.
{
  const byHash = new Map();
  for (const [id, image] of icons) {
    const hash = createHash("sha256").update(image).digest("hex");
    byHash.set(hash, [...(byHash.get(hash) ?? []), id]);
  }
  for (const [, idsSharing] of byHash)
    if (idsSharing.length > 1)
      console.warn(
        `warning: identical icon bytes for ${idsSharing.join(", ")}; check for upstream placeholder icons`,
      );
}

const outputDirectory = "public/item-icons";
await fs.mkdir(outputDirectory, { recursive: true });
const itemIcons = {};
for (const [id, image] of icons) {
  const hash = createHash("sha256").update(image).digest("hex").slice(0, 16);
  const filename = `${id}.${hash}.webp`;
  await fs.writeFile(path.join(outputDirectory, filename), image);
  itemIcons[id] = filename;
}
await fs.writeFile(
  "src/data/item-icons.json",
  `${JSON.stringify(itemIcons, null, 2)}\n`,
);

const currentFiles = new Set(Object.values(itemIcons));
for (const filename of await fs.readdir(outputDirectory)) {
  if (
    /^[A-Z0-9_]+\.[a-f0-9]{16}\.webp$/.test(filename) &&
    !currentFiles.has(filename)
  ) {
    await fs.rm(path.join(outputDirectory, filename));
  }
}

console.log(`Updated ${icons.length} item icons in ${outputDirectory}.`);
