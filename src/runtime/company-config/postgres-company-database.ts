import { postgresSchemaMigrations } from "./postgres-schema.js";

export interface PostgresQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
}

export interface PostgresMigrationClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
}

export interface PostgresPoolLike {
  connect(): Promise<PostgresMigrationClient & { release(): void }>;
}

export interface PostgresMigrationResult {
  appliedMigrationIds: string[];
}

export interface PostgresSchemaMigrationOptions {
  transactionPerMigration?: boolean;
}

export async function runPostgresSchemaMigrations(
  client: PostgresMigrationClient,
  options: PostgresSchemaMigrationOptions = {},
): Promise<PostgresMigrationResult> {
  const transactionPerMigration = options.transactionPerMigration ?? true;
  await client.query(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL
)
`);
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM schema_migrations ORDER BY id ASC",
  );
  const applied = new Set(existing.rows.map((row) => row.id));
  const currentMigrationIds = new Set(postgresSchemaMigrations.map((migration) => migration.id));
  const retiredMigrationIds = existing.rows
    .map((row) => row.id)
    .filter((id) => !currentMigrationIds.has(id));
  if (retiredMigrationIds.length > 0) {
    throw new Error(
      `PostgreSQL schema contains retired pre-release migrations: ${retiredMigrationIds.join(", ")}. Reset the TinyOffice test database before starting this version.`,
    );
  }
  const appliedMigrationIds: string[] = [];

  for (const migration of postgresSchemaMigrations) {
    if (applied.has(migration.id)) {
      continue;
    }
    if (transactionPerMigration) {
      await client.query("BEGIN");
    }
    try {
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, NOW())",
        [migration.id],
      );
      if (transactionPerMigration) {
        await client.query("COMMIT");
      }
      appliedMigrationIds.push(migration.id);
    } catch (error) {
      if (transactionPerMigration) {
        await client.query("ROLLBACK");
      }
      throw error;
    }
  }

  return { appliedMigrationIds };
}

export async function migratePostgresPool(pool: PostgresPoolLike): Promise<PostgresMigrationResult> {
  const client = await pool.connect();
  try {
    return await runPostgresSchemaMigrations(client);
  } finally {
    client.release();
  }
}
