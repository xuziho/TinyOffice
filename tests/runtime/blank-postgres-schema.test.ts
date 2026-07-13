import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";

import { loadCompaniesAdminViewModel } from "../../src/runtime/company-config/companies-admin.js";
import { runPostgresSchemaMigrations } from "../../src/runtime/company-config/postgres-company-database.js";

const defaultBlankDatabaseUrl =
  "postgresql://tinyoffice:tinyoffice_dev@127.0.0.1:55432/tinyoffice_blank_test?sslmode=disable";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function blankDatabaseUrl(): string | undefined {
  const configured = process.env.TINYOFFICE_BLANK_TEST_DATABASE_URL?.trim() ||
    process.env.TINYOFFICE_TEST_DATABASE_URL?.trim() ||
    defaultBlankDatabaseUrl;
  const parsed = new URL(configured);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName.toLowerCase().split(/[^a-z0-9]+/).includes("test")) {
    throw new Error(`Refusing to reset PostgreSQL database '${databaseName}' because its name is not clearly test-only.`);
  }
  parsed.pathname = `/${databaseName.replace(/_?test$/i, "")}_blank_test`;
  return parsed.toString();
}

async function ensureDatabase(databaseUrl: string): Promise<void> {
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const adminUrl = new URL(parsed);
  adminUrl.pathname = "/postgres";
  const pool = new Pool({ connectionString: adminUrl.toString() });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (existing.rowCount === 0) {
      await pool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    }
  } finally {
    await pool.end();
  }
}

test("blank PostgreSQL schema migration creates no default Company or prompt policy rows", async (t) => {
  const databaseUrl = blankDatabaseUrl();
  if (!databaseUrl) {
    t.skip("No TinyOffice PostgreSQL test database URL is configured.");
    return;
  }
  await ensureDatabase(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-blank-postgres-"));
  const previousDatabaseUrl = process.env.TINYOFFICE_DATABASE_URL;
  process.env.TINYOFFICE_DATABASE_URL = databaseUrl;
  try {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await runPostgresSchemaMigrations(pool);

    const viewModel = await loadCompaniesAdminViewModel({ repoRoot });
    assert.deepEqual(viewModel.companies, []);
    assert.equal(viewModel.routes.companiesJsonPath, "/api/companies");

    for (const tableName of [
      "companies",
      "company_members",
      "conversations",
      "conversation_messages",
      "prompt_policy_blocks",
      "prompt_policy_templates",
      "prompt_policy_bindings",
    ]) {
      assert.equal(
        Number((await pool.query(`SELECT COUNT(*) AS count FROM ${tableName}`)).rows[0].count),
        0,
        `${tableName} should stay empty before explicit Company initialization`,
      );
    }
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.TINYOFFICE_DATABASE_URL;
    } else {
      process.env.TINYOFFICE_DATABASE_URL = previousDatabaseUrl;
    }
    await pool.end();
    await rm(repoRoot, { recursive: true, force: true });
  }
});
