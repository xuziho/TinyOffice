import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const releaseRoot = path.join(root, ".release");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const commit = process.env.GITHUB_SHA?.trim() || "";
if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error("GITHUB_SHA must identify the exact published commit.");
const releaseId = `${packageJson.version}-${commit.slice(0, 12)}`;
const releaseJson = JSON.parse(await readFile(path.join(releaseRoot, `tinyoffice-${releaseId}`, "RELEASE.json"), "utf8"));
if (releaseJson.releaseId !== releaseId || releaseJson.gitCommit !== commit) throw new Error("Production artifact does not match the published commit.");

const archiveName = `tinyoffice-${releaseId}.tgz`;
const digestLine = await readFile(path.join(releaseRoot, `${archiveName}.sha256`), "utf8");
const sha256 = digestLine.trim().split(/\s+/)[0];
if (!/^[0-9a-f]{64}$/i.test(sha256)) throw new Error("Production artifact checksum is invalid.");
const baseUrl = process.env.TINYOFFICE_RELEASE_DOWNLOAD_BASE_URL?.trim()?.replace(/\/$/, "");
if (!baseUrl?.startsWith("https://")) throw new Error("TINYOFFICE_RELEASE_DOWNLOAD_BASE_URL must be an HTTPS URL.");
const minimumNodeVersion = String(packageJson.engines?.node ?? "").match(/\d+\.\d+\.\d+/)?.[0];
if (!minimumNodeVersion) throw new Error("package.json must declare an exact minimum Node.js version.");
const notes = process.env.TINYOFFICE_RELEASE_NOTES?.trim()
  ? process.env.TINYOFFICE_RELEASE_NOTES.split("|").map((note) => note.trim()).filter(Boolean)
  : [];

const manifest = {
  schema: "tinyoffice-release-channel",
  version: 1,
  channel: "stable",
  publishedAt: new Date().toISOString(),
  release: {
    releaseId,
    tinyOfficeVersion: releaseJson.tinyOfficeVersion,
    gitCommit: commit,
    minimumNodeVersion,
    artifact: {
      fileName: archiveName,
      url: `${baseUrl}/${archiveName}`,
      sha256,
    },
    notes,
  },
};
const output = path.join(releaseRoot, "tinyoffice-stable.json");
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(output);
