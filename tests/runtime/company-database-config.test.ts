import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import {
  resolveRuntimeDatabaseConfig,
} from "../../src/runtime/company-config/company-database-config.js";

const execFileAsync = promisify(execFile);

test("runtime database config defaults to postgres backend with url", () => {
  const config = resolveRuntimeDatabaseConfig({
    TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
  }, "C:\\repo\\TinyOffice");

  assert.equal(config.backend, "postgres");
  assert.equal(config.postgresUrl, "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice");
});

test("runtime database config accepts explicit postgres backend with url", () => {
  const config = resolveRuntimeDatabaseConfig({
    TINYOFFICE_DB_BACKEND: "postgres",
    TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
  }, "C:\\repo\\TinyOffice");

  assert.equal(config.backend, "postgres");
  assert.equal(config.postgresUrl, "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice");
});

test("runtime database config accepts COMPANY_DATABASE_BACKEND for existing env compatibility", () => {
  const config = resolveRuntimeDatabaseConfig({
    COMPANY_DATABASE_BACKEND: "postgres",
    TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
  }, "C:\\repo\\TinyOffice");

  assert.equal(config.backend, "postgres");
  assert.equal(config.postgresUrl, "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice");
});

test("runtime database config fails fast without postgres url by default", () => {
  assert.throws(
    () => resolveRuntimeDatabaseConfig({}, "C:\\repo\\TinyOffice"),
    /TINYOFFICE_DATABASE_URL is required for the default PostgreSQL runtime backend/,
  );
});

test("runtime test setup uses the local postgres test database instead of live env", async () => {
  const script = `
    import assert from "node:assert/strict";
    import { resolveRuntimeDatabaseConfig } from "./src/runtime/company-config/company-database-config.js";
    assert.equal(process.env.COMPANY_DATABASE_BACKEND, undefined);
    assert.equal(
      process.env.TINYOFFICE_DATABASE_URL,
      process.env.TINYOFFICE_TEST_DATABASE_URL ||
        "postgresql://tinyoffice:tinyoffice_dev@127.0.0.1:55432/tinyoffice_test?sslmode=disable",
    );
    const config = resolveRuntimeDatabaseConfig(process.env, process.cwd());
    assert.equal(config.backend, "postgres");
    console.log("local-test-db");
  `;

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./tests/setup-runtime-test-env.ts",
      "--input-type=module",
      "--eval",
      script,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        COMPANY_DATABASE_BACKEND: "postgres",
        TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
      },
    },
  );

  assert.match(stdout, /local-test-db/);
});

test("runtime database config rejects retired runtime backend names", () => {
  assert.throws(
    () => resolveRuntimeDatabaseConfig({
      COMPANY_DATABASE_BACKEND: "legacy",
    }, "C:\\repo\\TinyOffice"),
    /COMPANY_DATABASE_BACKEND must be postgres/,
  );
});

test("runtime database config requires postgres url for explicit postgres backend", () => {
  assert.throws(
    () => resolveRuntimeDatabaseConfig({
      COMPANY_DATABASE_BACKEND: "postgres",
    }, "C:\\repo\\TinyOffice"),
    /TINYOFFICE_DATABASE_URL is required when COMPANY_DATABASE_BACKEND=postgres/,
  );
});
