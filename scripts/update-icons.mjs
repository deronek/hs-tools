import fs from "node:fs/promises";
import path from "node:path";

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
  const response = await fetch(
    `https://sky.shiiyu.moe/api/item/${encodeURIComponent(id)}`,
    { signal: AbortSignal.timeout(60_000) },
  );
  if (!response.ok) {
    throw new Error(`Icon download failed for ${id}: HTTP ${response.status}`);
  }

  const image = Buffer.from(await response.arrayBuffer());
  if (
    response.headers.get("content-type")?.split(";")[0] !== "image/webp" ||
    image.toString("ascii", 0, 4) !== "RIFF" ||
    image.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error(`Icon download for ${id} is not a WebP image.`);
  }
  icons.push([id, image]);
}

const outputDirectory = "public/item-icons";
await fs.mkdir(outputDirectory, { recursive: true });
for (const [id, image] of icons) {
  await fs.writeFile(path.join(outputDirectory, `${id}.webp`), image);
}

console.log(`Updated ${icons.length} item icons in ${outputDirectory}.`);
