import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const ignoredHistoricalPaths = [
  /^docs[\/\\]archive[\/\\]/,
  /^docs[\/\\]superpowers[\/\\]/,
  /^tests[\/\\]frontend[\/\\]retired-frontend-boundary\.test\.ts$/,
];

function trackedTextFiles(): string[] {
  let files: string[];
  try {
    files = execFileSync("git", ["ls-files"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    files = snapshotFiles();
  }
  return files
    .filter(Boolean)
    .filter((filePath) => existsSync(filePath))
    .filter((filePath) => textExtensions.has(extname(filePath)))
    .filter((filePath) => !ignoredHistoricalPaths.some((pattern) => pattern.test(filePath)));
}

function snapshotFiles(directory = ".", prefix = ""): string[] {
  const ignoredDirectories = new Set([".git", ".scratch", "build", "dist", "node_modules"]);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return snapshotFiles(relative, relative);
    return entry.isFile() ? [relative] : [];
  });
}

test("retired pre-shadcn frontend is deleted and cannot remain an active dependency", () => {
  assert.equal(existsSync("apps/tinyoffice-web"), false, "retired apps/tinyoffice-web directory must not exist");

  const forbiddenPatterns = [
    /apps[\/\\]tinyoffice-web(?!-shadcn)/,
    /"dev:tinyoffice-web"\s*:/,
    /"build:tinyoffice-web"\s*:/,
    /"check:tinyoffice-web"\s*:/,
    /npm run (?:dev|build|check) --prefix apps[\/\\]tinyoffice-web(?!-shadcn)/,
    /npm run test --prefix apps[\/\\]tinyoffice-web(?!-shadcn)/,
  ];

  const offenders = trackedTextFiles().flatMap((filePath) => {
    const text = readFileSync(filePath, "utf8");
    return forbiddenPatterns
      .filter((pattern) => pattern.test(text))
      .map((pattern) => `${filePath}: ${pattern}`);
  });

  assert.deepEqual(offenders, []);
});
