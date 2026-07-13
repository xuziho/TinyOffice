import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname } from "node:path";

const allowMissingLicense = process.argv.includes("--allow-missing-license");
const errors = [];
const warnings = [];

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function listSnapshotFiles(directory = ".", prefix = "") {
  const files = [];
  const ignoredDirectories = new Set([".git", ".scratch", "build", "dist", "node_modules"]);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listSnapshotFiles(relative, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

let tracked;
try {
  const repositoryRoot = git(["rev-parse", "--show-toplevel"]).trim().replaceAll("\\", "/");
  const currentRoot = process.cwd().replaceAll("\\", "/");
  tracked = repositoryRoot.toLowerCase() === currentRoot.toLowerCase()
    ? git(["ls-files", "-z"]).split("\0").filter(Boolean)
    : listSnapshotFiles();
} catch {
  tracked = listSnapshotFiles();
}
const forbiddenTrackedRoots = [
  "companies/",
  ".data/",
  ".logs/",
  ".runtime/",
  ".scratch/",
  "node_modules/",
  "dist/",
  "build/",
];

for (const file of tracked) {
  if (forbiddenTrackedRoots.some((root) => file.startsWith(root))) {
    errors.push(`runtime or generated data is tracked: ${file}`);
  }
}

const requiredFiles = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "THIRD_PARTY_NOTICES.md",
  ".env.example",
  ".gitattributes",
];

for (const file of requiredFiles) {
  if (!existsSync(file)) errors.push(`required public file is missing: ${file}`);
}

if (!existsSync("LICENSE")) {
  const message = "root LICENSE is missing; the snapshot is not open source yet";
  if (allowMissingLicense) warnings.push(message);
  else errors.push(message);
}

const exportIgnoredRoots = [
  ".agents/",
  ".codex/",
  "apps/tinyoffice-web-shadcn/.agents/",
  "artifacts/",
  "docs/archive/",
  "docs/superpowers/",
  "prototypes/",
  "qa/",
  "visual-prototypes/",
];
const exportIgnoredFiles = new Set(["AGENTS.md", "design-qa.md"]);
const publicFiles = tracked.filter(
  (file) => !exportIgnoredFiles.has(file) && !exportIgnoredRoots.some((root) => file.startsWith(root)),
);

const textExtensions = new Set([
  "",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ps1",
  ".sh",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const publicDocs = publicFiles.filter(
  (file) => file === "README.md" || file.startsWith("docs/") || file.endsWith(".yml") || file.endsWith(".yaml"),
);
const localPathPatterns = [
  /[A-Z]:\\Users\\[^\\\s]+/i,
  /[A-Z]:\\AI\\Codex\\/i,
  /\/Users\/[^/\s]+\//,
  /\/home\/[^/\s]+\//,
];

for (const file of publicDocs) {
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  const content = readFileSync(file, "utf8");
  for (const pattern of localPathPatterns) {
    if (pattern.test(content)) errors.push(`machine-specific path in public documentation: ${file}`);
  }
}

const riskyNames = publicFiles.filter(
  (file) => file !== ".env.example" && /(^|\/)(\.env(?:\..+)?|.*\.(pem|key|p12|pfx|sqlite|db|bak))$/i.test(file),
);
for (const file of riskyNames) errors.push(`risky file type is tracked in public snapshot: ${file}`);

const reviewedBinaryAssets = new Set(["docs/assets/soft-neo-retro-chat-reference.png"]);
const exportedQA = publicFiles.filter(
  (file) => /\.(png|jpe?g|webp|gif)$/i.test(file) && !reviewedBinaryAssets.has(file),
);
for (const file of exportedQA) warnings.push(`review public binary asset: ${file}`);

console.log(`Checked ${tracked.length} tracked files; ${publicFiles.length} are in the public snapshot boundary.`);
for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log("Open-source boundary check passed.");
}
