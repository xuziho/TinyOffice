import assert from "node:assert/strict";
import test from "node:test";

import { errorStatus } from "../../src/api/http.js";
import {
  openConfiguredPostgresConnection,
  PostgresConnectionUnavailableError,
} from "../../src/runtime/company-config/postgres-runtime-connection.js";

test("postgres connection acquisition failures surface as a finite 503 product error", async () => {
  const failure = new Error("pool is exhausted");
  let endCount = 0;
  await assert.rejects(
    openConfiguredPostgresConnection(process.cwd(), {
      env: {
        TINYOFFICE_DB_BACKEND: "postgres",
        TINYOFFICE_DATABASE_URL: "postgresql://tinyoffice.invalid/tinyoffice",
      },
      createPostgresPool: () => ({
        async connect() {
          throw failure;
        },
        async end() {
          endCount += 1;
        },
      }),
    }),
    (error: unknown) => {
      assert.equal(error instanceof PostgresConnectionUnavailableError, true);
      assert.equal((error as PostgresConnectionUnavailableError).cause, failure);
      assert.equal(errorStatus(error), 503);
      return true;
    },
  );
  assert.equal(endCount, 1);
});
