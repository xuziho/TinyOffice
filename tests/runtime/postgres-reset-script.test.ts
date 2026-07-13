import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local runtime postgres reset is an explicit destructive hard-migration command", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  const resetScript = await readFile(
    "scripts/runtime/reset-tinyoffice-postgres.ps1",
    "utf8",
  );

  assert.equal(
    packageJson.scripts?.["runtime:postgres:reset"],
    "powershell -ExecutionPolicy Bypass -File scripts/runtime/reset-tinyoffice-postgres.ps1",
  );
  assert.equal(
    packageJson.scripts?.["runtime:postgres:init-schema"],
    "node --import tsx scripts/runtime/init-tinyoffice-postgres-schema.ts",
  );
  assert.match(resetScript, /docker\s+rm\s+-f/i);
  assert.match(resetScript, /docker\s+volume\s+rm/i);
  assert.match(resetScript, /ensure-tinyoffice-postgres\.ps1/);
  assert.match(resetScript, /init-tinyoffice-postgres-schema\.ts/);
  assert.match(resetScript, /tinyoffice-postgres/);
  assert.match(resetScript, /tinyoffice-postgres-data/);
});
