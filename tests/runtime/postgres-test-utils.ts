import { createHash } from "node:crypto";
import { Pool } from "pg";
import {
  waitForTrackedPostgresPoolEnds,
} from "../../src/runtime/company-config/postgres-runtime-connection.js";
import { buildCompanyConfigSeedSql, DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { runPostgresSchemaMigrations } from "../../src/runtime/company-config/postgres-company-database.js";
import { defaultToolGuardPolicy } from "../../src/runtime/company-config/tool-guard-admin.js";
import {
  DEFAULT_PROMPT_BLOCKS_BY_SCENE,
  DEFAULT_PROMPT_POLICY_BLOCKS,
  DEFAULT_PROMPT_POLICY_TEMPLATES,
  SCENES,
} from "../../src/runtime/company-config/prompt-policy-model.js";

export const defaultRuntimePostgresTestDatabaseUrl =
  "postgresql://tinyoffice:tinyoffice_dev@127.0.0.1:55432/tinyoffice_test?sslmode=disable";

const localDogfoodRuntimePostgresDatabaseUrl =
  "postgresql://tinyoffice:tinyoffice_dev@127.0.0.1:55432/tinyoffice?sslmode=disable";

const runtimeTables = [
  "companies",
  "company_members",
  "member_runtime_profiles",
  "conversations",
  "conversation_participants",
  "conversation_messages",
  "prompt_policy_bindings",
  "prompt_policy_blocks",
  "prompt_policy_templates",
  "tool_safety_policies",
  "intake_events",
  "work_task_revisions",
  "work_schedules",
  "work_tasks",
  "work_runs",
  "work_run_events",
  "work_dispatch_leases",
  "work_blocked_recovery_requests",
  "channel_topics",
  "channel_topic_handoffs",
  "session_events",
  "session_records",
  "process_trace_events",
  "collaboration_action_events",
  "memory_summaries",
  "runtime_storage_retention_state",
  "governance_approvals",
  "office_tool_audit_logs",
  "operating_events",
  "handoff_replay_ledger",
];

let inProcessLockTail = Promise.resolve();
let activeTestCasePool: Pool | undefined;
let activeTestCaseRelease: (() => void) | undefined;

function parsePostgresUrl(databaseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw new Error(`Invalid TINYOFFICE_DATABASE_URL for runtime tests: ${(error as Error).message}`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Runtime PostgreSQL tests require a postgres:// or postgresql:// database URL.");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName) {
    throw new Error("Runtime PostgreSQL tests require a database name in TINYOFFICE_DATABASE_URL.");
  }
  return { parsed, databaseName };
}

function isCanonicalLocalDogfoodDatabase(parsed: URL, databaseName: string) {
  const dogfood = new URL(localDogfoodRuntimePostgresDatabaseUrl);
  return (
    (parsed.hostname === dogfood.hostname || parsed.hostname === "localhost") &&
    parsed.port === dogfood.port &&
    parsed.username === dogfood.username &&
    parsed.password === dogfood.password &&
    databaseName === dogfood.pathname.replace(/^\//, "")
  );
}

function isClearlyNamedTestDatabase(databaseName: string) {
  return databaseName.toLowerCase().split(/[^a-z0-9]+/).includes("test");
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

export function assertRuntimePostgresTestDatabaseUrl(databaseUrl: string) {
  const { parsed, databaseName } = parsePostgresUrl(databaseUrl);
  if (isCanonicalLocalDogfoodDatabase(parsed, databaseName)) {
    throw new Error(
      "Refusing to reset the local dogfood TinyOffice PostgreSQL database. " +
        `Use an isolated test database such as ${defaultRuntimePostgresTestDatabaseUrl} via TINYOFFICE_TEST_DATABASE_URL.`,
    );
  }
  if (!isClearlyNamedTestDatabase(databaseName)) {
    throw new Error(
      `Refusing to reset PostgreSQL database '${databaseName}' because its name is not clearly test-only.`,
    );
  }
}

async function ensureRuntimePostgresTestDatabase(databaseUrl: string) {
  const { parsed, databaseName } = parsePostgresUrl(databaseUrl);
  const adminUrl = new URL(parsed);
  adminUrl.pathname = "/postgres";
  const pool = new Pool({ connectionString: adminUrl.toString() });
  try {
    const existing = await pool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );
    if (existing.rowCount === 0) {
      await pool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    }
  } finally {
    await pool.end();
  }
}

async function acquireInProcessRuntimePostgresTestLock() {
  const previous = inProcessLockTail;
  let releaseCurrent!: () => void;
  inProcessLockTail = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  await previous;
  return releaseCurrent;
}

async function resetRuntimePostgresTablesWithPool(pool: Pool) {
  await runPostgresSchemaMigrations(pool);
  await pool.query(`TRUNCATE TABLE ${runtimeTables.join(", ")} RESTART IDENTITY CASCADE`);
  await pool.query(buildCompanyConfigSeedSql());
  await seedRuntimePostgresTestCompany(pool);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function seedRuntimePostgresTestCompany(pool: Pool) {
  await pool.query(
    `INSERT INTO companies (company_id, display_name, created_at, updated_at)
VALUES ($1, $2, NOW(), NOW())`,
    [DEFAULT_COMPANY_ID, "TinyOffice Test"],
  );

  for (const [blockId, block] of Object.entries(DEFAULT_PROMPT_POLICY_BLOCKS)) {
    await pool.query(
      `INSERT INTO prompt_policy_blocks (company_id, block_id, title, content, content_sha256, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [DEFAULT_COMPANY_ID, blockId, block.title, block.content, sha256(block.content)],
    );
  }

  for (const template of Object.values(DEFAULT_PROMPT_POLICY_TEMPLATES)) {
    await pool.query(
      `INSERT INTO prompt_policy_templates (company_id, template_id, title, content, content_sha256, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [DEFAULT_COMPANY_ID, template.id, template.label, template.content, sha256(template.content)],
    );
  }

  for (const scene of SCENES) {
    await pool.query(
      `INSERT INTO prompt_policy_bindings (company_id, mount_kind, scene_type, block_id, position, created_at, updated_at)
VALUES ($1, 'scene', $2, $3, 0, NOW(), NOW())`,
      [DEFAULT_COMPANY_ID, scene, DEFAULT_PROMPT_BLOCKS_BY_SCENE[scene]],
    );
  }

  await pool.query(
    `INSERT INTO tool_safety_policies (company_id, id, policy_json, created_at, updated_at)
VALUES ($1, 'default', $2, NOW(), NOW())`,
    [DEFAULT_COMPANY_ID, defaultToolGuardPolicy],
  );
}

export async function beginRuntimePostgresTestCase() {
  const databaseUrl = process.env.TINYOFFICE_DATABASE_URL?.trim();
  if (!databaseUrl) {
    return;
  }
  let release: (() => void) | undefined = await acquireInProcessRuntimePostgresTestLock();
  let pool: Pool | undefined;
  try {
    assertRuntimePostgresTestDatabaseUrl(databaseUrl);
    await ensureRuntimePostgresTestDatabase(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("SELECT pg_advisory_lock(892358)");
    activeTestCasePool = pool;
    activeTestCaseRelease = release;
    release = undefined;
    await resetRuntimePostgresTablesWithPool(pool);
  } catch (error) {
    const activeRelease = activeTestCaseRelease;
    if (activeTestCasePool === pool) {
      activeTestCasePool = undefined;
      activeTestCaseRelease = undefined;
    }
    activeRelease?.();
    release?.();
    await pool?.end();
    throw error;
  }
}

export async function endRuntimePostgresTestCase() {
  const pool = activeTestCasePool;
  const release = activeTestCaseRelease;
  activeTestCasePool = undefined;
  activeTestCaseRelease = undefined;
  if (!pool) {
    release?.();
    return;
  }
  try {
    try {
      await pool.query("SELECT pg_advisory_unlock(892358)");
    } catch {
      // The pool may already be unusable after a connection-level failure.
    }
    await pool.end();
  } finally {
    release?.();
  }
}

export async function resetRuntimePostgresTables() {
  const databaseUrl = process.env.TINYOFFICE_DATABASE_URL?.trim();
  if (!databaseUrl) {
    return;
  }
  assertRuntimePostgresTestDatabaseUrl(databaseUrl);
  await ensureRuntimePostgresTestDatabase(databaseUrl);
  if (activeTestCasePool) {
    await resetRuntimePostgresTablesWithPool(activeTestCasePool);
    return;
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("SELECT pg_advisory_lock(892358)");
    await resetRuntimePostgresTablesWithPool(pool);
  } finally {
    try {
      await pool.query("SELECT pg_advisory_unlock(892358)");
    } catch {
      // The pool may already be unusable after a connection-level failure.
    }
    await pool.end();
  }
}

export async function waitForRuntimePostgresCleanup() {
  await waitForTrackedPostgresPoolEnds();
}
