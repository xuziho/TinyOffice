import { Pool } from "pg";

import {
  migratePostgresPool,
} from "../../src/runtime/company-config/postgres-company-database.js";

const defaultDatabaseUrl =
  "postgresql://tinyoffice:tinyoffice_dev@127.0.0.1:55432/tinyoffice?sslmode=disable";

const databaseUrl = process.env.TINYOFFICE_DATABASE_URL?.trim() || defaultDatabaseUrl;
const pool = new Pool({ connectionString: databaseUrl });

try {
  const result = await migratePostgresPool(pool);
  console.log(
    result.appliedMigrationIds.length
      ? `Applied migrations: ${result.appliedMigrationIds.join(", ")}`
      : "PostgreSQL schema is already current.",
  );
} finally {
  await pool.end();
}
