import { after, afterEach, beforeEach } from "node:test";

import {
  beginRuntimePostgresTestCase,
  defaultRuntimePostgresTestDatabaseUrl,
  endRuntimePostgresTestCase,
  waitForRuntimePostgresCleanup,
} from "./runtime/postgres-test-utils.js";

process.env.NODE_ENV = "test";
delete process.env.COMPANY_DATABASE_BACKEND;
delete process.env.TINYOFFICE_DB_BACKEND;
process.env.TINYOFFICE_DATABASE_URL =
  process.env.TINYOFFICE_TEST_DATABASE_URL?.trim() ||
  defaultRuntimePostgresTestDatabaseUrl;

beforeEach(beginRuntimePostgresTestCase);
afterEach(endRuntimePostgresTestCase);
after(waitForRuntimePostgresCleanup);
