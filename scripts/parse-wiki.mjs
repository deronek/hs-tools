import fs from "node:fs";

const htmlPath = "data/raw/wiki-table.html";
if (!fs.existsSync(htmlPath)) {
  console.error(`Missing wiki HTML at ${htmlPath}.`);
  process.exit(1);
}
const html = fs.readFileSync(htmlPath, "utf8");

const recipeSections = [
  "Refining",
  "Forging",
  "Tools",
  "Gear",
  "Reforge_Stones",
  "Drill_Parts",
  "Perfect_Gemstones",
  "Pets",
  "Other",
];

const decodeEntities = (s) =>
  s
    .replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

const text = (s) =>
  decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

function findTableForSection(id) {
  const marker = `<h3 id="${id}">`;
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const tableStart = html.indexOf("<table", start);
  if (tableStart < 0) return null;
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableEnd < 0) return null;
  return html.slice(tableStart, tableEnd);
}

function parseRows(table) {
  const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const out = [];
  const spans = Array.from({ length: 6 }, () => ({ remaining: 0, value: "" }));
  for (const row of rows.slice(1)) {
    const cells = [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(
      (m) => ({
        attrs: m[1],
        body: m[2],
      }),
    );
    const values = spans.map((s) => (s.remaining > 0 ? s.value : ""));
    let cellIndex = 0;
    for (let col = 0; col < 6; col++) {
      if (spans[col].remaining > 0) {
        spans[col].remaining--;
        continue;
      }
      const cell = cells[cellIndex++];
      if (!cell) continue;
      const rowspan = Number(
        (cell.attrs.match(/rowspan="(\d+)"/) || [])[1] || 1,
      );
      values[col] = cell.body;
      spans[col] = { remaining: rowspan - 1, value: cell.body };
    }
    out.push(values);
  }
  return out;
}

function matchingClose(html, start, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === "/") {
      depth--;
      if (depth === 0) return m.index;
    } else depth++;
  }
  return -1;
}

function parseTopLevelItems(listHtml) {
  const items = [];
  const liRe = /<li\b[^>]*>/gi;
  let m;
  while ((m = liRe.exec(listHtml))) {
    const start = m.index;
    const end = matchingClose(listHtml, start, "li");
    if (end < 0) break;
    const body = listHtml.slice(start, end + 5);
    const beforeNested = body.split(/<ul\b/i)[0];
    const qtyHtml =
      (beforeNested.match(/color-(?:green|gold)[^>]*>([\s\S]*?)<\/span>/) ||
        [])[1] || "";
    const qty = Number(text(qtyHtml).replace(/[^\d.]/g, "")) || 1;
    const name = text(
      (beforeNested.match(/<a href="\/w\/[^"]+" title="([^"]+)"/) || [])[1] ||
        "",
    );
    if (name) items.push({ name, qty });
    liRe.lastIndex = end + 5;
  }
  return items;
}

function parseCost(treeHtml) {
  const ul = /<ul\b[^>]*>/i.exec(treeHtml);
  if (!ul) return { outputQty: 1, children: [] };
  const listStart = ul.index + ul[0].length;
  const listEnd = matchingClose(treeHtml, ul.index, "ul");
  if (listEnd < 0) return { outputQty: 1, children: [] };
  const listHtml = treeHtml.slice(listStart, listEnd);
  const li = /<li\b[^>]*>/i.exec(listHtml);
  if (!li) return { outputQty: 1, children: [] };
  const rootLiEnd = matchingClose(listHtml, li.index, "li");
  if (rootLiEnd < 0) return { outputQty: 1, children: [] };
  const rootBody = listHtml.slice(li.index, rootLiEnd + 5);
  const childUl = /<ul\b[^>]*>/i.exec(rootBody);
  if (!childUl) {
    return { outputQty: 1, children: parseTopLevelItems(listHtml) };
  }
  const childUlEnd = matchingClose(rootBody, childUl.index, "ul");
  if (childUlEnd < 0) return { outputQty: 1, children: [] };
  const head = rootBody.slice(0, childUl.index);
  const qtyHtml =
    (head.match(/color-green[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "";
  const outputQty = Number(text(qtyHtml).replace(/[^\d.]/g, "")) || 1;
  const list = rootBody.slice(childUl.index + childUl[0].length, childUlEnd);
  return { outputQty, children: parseTopLevelItems(list) };
}

const items = JSON.parse(
  fs.readFileSync("data/raw/items.json", "utf8").replace(/^\uFEFF/, ""),
).items;
const nameToId = new Map();
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
for (const item of items) nameToId.set(norm(item.name), item.id);

const recipes = [];
for (const section of recipeSections) {
  const table = findTableForSection(section);
  if (!table) {
    console.error("missing table", section);
    continue;
  }
  for (const [, name, tree, duration, hotm] of parseRows(table)) {
    const outputName = text(name);
    if (!outputName) continue;
    const { outputQty, children } = parseCost(tree);
    recipes.push({
      section,
      name: outputName,
      outputId: nameToId.get(norm(outputName)) || null,
      outputQty,
      durationText: text(duration),
      hotm: text(hotm),
      ingredients: children.map((c) => ({
        name: c.name,
        qty: c.qty,
        id: nameToId.get(norm(c.name)) || null,
      })),
    });
  }
}

fs.mkdirSync("data/raw", { recursive: true });
fs.writeFileSync("data/raw/recipes-raw.json", JSON.stringify(recipes, null, 2));
console.log("recipes", recipes.length);
const bySection = Object.groupBy(recipes, (r) => r.section);
for (const [s, rs] of Object.entries(bySection)) console.log(s, rs.length);
