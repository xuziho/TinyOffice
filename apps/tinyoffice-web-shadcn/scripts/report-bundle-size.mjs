import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(appRoot, "dist");
const manifest = JSON.parse(await readFile(path.join(distRoot, ".vite", "manifest.json"), "utf8"));
const rows = [];

for (const [source, item] of Object.entries(manifest)) {
  if (!item.file?.endsWith(".js")) continue;
  const bytes = (await stat(path.join(distRoot, item.file))).size;
  rows.push({
    chunk: item.file.replace(/^assets\//, ""),
    source,
    type: item.isEntry ? "entry" : item.isDynamicEntry ? "route" : "shared",
    kib: Number((bytes / 1024).toFixed(1)),
  });
}

rows.sort((left, right) => right.kib - left.kib);
console.table(rows.slice(0, 12));
console.log(`Reported ${rows.length} JavaScript chunks from the production manifest.`);
