import { readFileSync } from "node:fs";
import path from "node:path";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const allowed = new Set(["0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BlueOak-1.0.0", "ISC", "MIT"]);
const errors = [];
const counts = new Map();

for (const [packagePath, entry] of Object.entries(lock.packages || {})) {
  if (!packagePath) continue;
  let license = entry.license;
  if (!license) {
    try {
      const metadata = JSON.parse(readFileSync(path.join(packagePath, "package.json"), "utf8"));
      license = typeof metadata.license === "string" ? metadata.license : undefined;
    } catch {
      // A clean release check runs after npm ci, so missing metadata is actionable.
    }
  }
  if (!license && packagePath.startsWith("node_modules/@esbuild/")) {
    license = "MIT";
  }
  const label = license || "UNKNOWN";
  counts.set(label, (counts.get(label) || 0) + 1);
  if (!allowed.has(label)) errors.push(`${packagePath}@${entry.version || "unknown"}: ${label}`);
}

console.log([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([license, count]) => `${license}: ${count}`).join("\n"));
if (errors.length) {
  for (const error of errors) console.error(`ERROR: unreviewed dependency license ${error}`);
  process.exitCode = 1;
} else {
  console.log("Dependency license check passed.");
}
