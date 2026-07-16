import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { create } from "tar";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = String(packageJson.version || "").trim();
if (!version) throw new Error("package.json version is required.");

const gitCommitResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (gitCommitResult.status !== 0) throw new Error("A Git commit is required to build a production Release.");
const gitCommit = gitCommitResult.stdout.trim();
const dirtyResult = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" });
if (dirtyResult.status !== 0) throw new Error("Unable to inspect the Git worktree.");
if (dirtyResult.stdout.trim() && process.env.TINYOFFICE_ALLOW_DIRTY_RELEASE !== "1") {
  throw new Error("Refusing to build a production Release from uncommitted tracked changes.");
}
const releaseId = `${version}-${gitCommit.slice(0, 12)}`;

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawnSync(npm, ["run", "build:tinyoffice-web-shadcn"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);

const releaseRoot = path.join(root, ".release");
const stagingName = `tinyoffice-${releaseId}`;
const staging = path.join(releaseRoot, stagingName);
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

for (const entry of ["src", "scripts/runtime", "scripts/release", "packages", "updates", "deploy"]) {
  await cp(path.join(root, entry), path.join(staging, entry), {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("tests") && !source.split(path.sep).includes("node_modules"),
  });
}
for (const file of ["package.json", "package-lock.json", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  await cp(path.join(root, file), path.join(staging, file));
}
await cp(path.join(root, "apps/tinyoffice-web-shadcn/dist"), path.join(staging, "public"), { recursive: true });
await writeFile(path.join(staging, "RELEASE.json"), `${JSON.stringify({
  schema: "tinyoffice-production-release",
  version: 1,
  releaseId,
  tinyOfficeVersion: version,
  gitCommit,
  builtAt: new Date().toISOString(),
  node: packageJson.engines?.node,
  piVersion: packageJson.dependencies?.["@earendil-works/pi-coding-agent"],
}, null, 2)}\n`);

const archive = path.join(releaseRoot, `${stagingName}.tgz`);
await rm(archive, { force: true });
await create({ cwd: releaseRoot, file: archive, gzip: true, portable: true }, [stagingName]);
const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`);
console.log(archive);
