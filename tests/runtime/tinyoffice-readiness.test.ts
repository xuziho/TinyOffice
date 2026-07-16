import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadTinyOfficeReadiness } from "../../src/runtime/deployment/tinyoffice-readiness.js";

test("readiness reports current schema and required production roots", async () => {
  const databaseUrl = process.env.TINYOFFICE_DATABASE_URL;
  assert.ok(databaseUrl);
  const root = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-ready-"));
  const web = path.join(root, "public");
  await mkdir(path.join(root, "companies"));
  await mkdir(path.join(root, ".data"));
  await mkdir(web);
  await writeFile(path.join(web, "index.html"), "TinyOffice");
  try {
    const readiness = await loadTinyOfficeReadiness({
      databaseUrl,
      repoRoot: root,
      staticWebRoot: web,
      deploymentMode: "production",
      releaseVersion: "0.1.0-alpha.1",
    });
    assert.equal(readiness.ok, true);
    assert.equal(readiness.deploymentMode, "production");
    assert.equal(readiness.releaseVersion, "0.1.0-alpha.1");
    assert.ok(readiness.checks.every(({ ok }) => ok));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
