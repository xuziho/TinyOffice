import assert from "node:assert/strict";
import test from "node:test";

import * as postgresTestUtils from "./postgres-test-utils.js";

test("runtime postgres reset guard rejects the canonical local dogfood database", () => {
  assert.equal(
    typeof postgresTestUtils.assertRuntimePostgresTestDatabaseUrl,
    "function",
  );

  assert.throws(
    () => postgresTestUtils.assertRuntimePostgresTestDatabaseUrl(
      "postgresql://tinyoffice:tinyoffice_dev@127.0.0.1:55432/tinyoffice?sslmode=disable",
    ),
    /Refusing to reset the local dogfood TinyOffice PostgreSQL database/,
  );
});

test("runtime postgres reset guard accepts the isolated default test database", () => {
  postgresTestUtils.assertRuntimePostgresTestDatabaseUrl(
    postgresTestUtils.defaultRuntimePostgresTestDatabaseUrl,
  );
});
