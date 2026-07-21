import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production installer verifies, backs up, migrates, checks readiness, and guards rollback", async () => {
  const source = await readFile("scripts/release/install-production-release.sh", "utf8");
  assert.match(source, /sha256sum/);
  assert.match(source, /TINYOFFICE_DEPLOYMENT_MODE/);
  assert.match(source, /backup create/);
  assert.match(source, /systemctl --user stop/);
  assert.match(source, /active Release was not changed/);
  assert.match(source, /inactive target Release was removed/);
  assert.match(source, /Release id is unsafe/);
  assert.match(source, /init-tinyoffice-postgres-schema/);
  assert.match(source, /\/ready/);
  assert.match(source, /Restoring previous code Release/);
  assert.match(source, /service restart was rejected; evaluating the guarded rollback boundary/);
  assert.match(source, /automatic code rollback is unsafe/);
  assert.doesNotMatch(source, /git pull|git reset|runtime:postgres:reset/);
});

test("production Release build binds the artifact to a clean Git commit and writes a checksum", async () => {
  const source = await readFile("scripts/release/build-production-release.mjs", "utf8");
  assert.match(source, /gitCommit/);
  assert.match(source, /releaseId/);
  assert.match(source, /uncommitted tracked changes/);
  assert.match(source, /sha256/);
  assert.doesNotMatch(source, /companies|shared\/\.data/);
});

test("release publication emits a stable manifest and the host updater re-verifies it", async () => {
  const manifestBuilder = await readFile("scripts/release/build-release-channel-manifest.mjs", "utf8");
  const updater = await readFile("scripts/release/run-approved-production-update.ts", "utf8");
  const updateSource = await readFile("src/runtime/update/tinyoffice-update-source.ts", "utf8");
  const workflow = await readFile(".github/workflows/release.yml", "utf8");
  assert.match(manifestBuilder, /tinyoffice-release-channel/);
  assert.match(manifestBuilder, /GITHUB_SHA/);
  assert.match(manifestBuilder, /sha256/);
  assert.match(updater, /targetReleaseId/);
  assert.match(updater, /Release checksum mismatch/);
  assert.match(updater, /install-production-release\.sh/);
  assert.match(updater, /loadReleaseManifestFromSource/);
  assert.match(updateSource, /api\.github\.com\/repos\/xuziho\/TinyOffice\/releases\/latest/);
  assert.match(updateSource, /application\/octet-stream/);
  assert.doesNotMatch(updater, /releases\/latest\/download/);
  assert.doesNotMatch(updateSource, /releases\/latest\/download/);
  assert.match(workflow, /push:\s*[\s\S]*tags:/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /tinyoffice-stable\.json/);
  const smokeIndex = workflow.indexOf("Smoke packaged production artifact");
  const manifestIndex = workflow.indexOf("Build stable channel manifest from the verified artifact");
  assert.ok(smokeIndex >= 0 && manifestIndex > smokeIndex, "The stable manifest must describe the final smoke-tested archive.");
});
