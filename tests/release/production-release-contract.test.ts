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
  assert.match(source, /init-tinyoffice-postgres-schema/);
  assert.match(source, /\/ready/);
  assert.match(source, /Restoring previous code Release/);
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
