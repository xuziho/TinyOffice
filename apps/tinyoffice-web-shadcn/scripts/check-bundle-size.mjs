import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(appRoot, "dist");
const manifest = JSON.parse(await readFile(path.join(distRoot, ".vite", "manifest.json"), "utf8"));
const maxEntryBytes = 450 * 1024;
const maxAsyncChunkBytes = 400 * 1024;
const violations = [];

for (const item of Object.values(manifest)) {
  if (!item.file?.endsWith(".js")) {
    continue;
  }
  const bytes = (await stat(path.join(distRoot, item.file))).size;
  const limit = item.isEntry ? maxEntryBytes : maxAsyncChunkBytes;
  if (bytes > limit) {
    violations.push(`${item.file}: ${(bytes / 1024).toFixed(1)} KiB exceeds ${limit / 1024} KiB`);
  }
}

if (violations.length > 0) {
  throw new Error(`Frontend bundle budget exceeded:\n${violations.join("\n")}`);
}

const entry = Object.values(manifest).find((item) => item.isEntry && item.file?.endsWith(".js"));
const entryBytes = entry ? (await stat(path.join(distRoot, entry.file))).size : 0;
console.log(`Frontend bundle budget passed: entry ${(entryBytes / 1024).toFixed(1)} KiB, limit ${maxEntryBytes / 1024} KiB.`);
