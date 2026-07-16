import { access } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

import { postgresSchemaMigrations } from "../company-config/postgres-schema.js";

export type TinyOfficeReadiness = {
  ok: boolean;
  surface: "tinyoffice-readiness";
  deploymentMode: string;
  releaseVersion: string;
  checks: Array<{ id: string; ok: boolean; summary: string }>;
};

export async function loadTinyOfficeReadiness(input: {
  databaseUrl: string;
  repoRoot: string;
  staticWebRoot?: string;
  deploymentMode?: string;
  releaseVersion?: string;
}): Promise<TinyOfficeReadiness> {
  const checks: TinyOfficeReadiness["checks"] = [];
  const pool = new Pool({ connectionString: input.databaseUrl, max: 1 });
  try {
    const result = await pool.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id ASC");
    const applied = new Set(result.rows.map(({ id }) => id));
    const missing = postgresSchemaMigrations.map(({ id }) => id).filter((id) => !applied.has(id));
    checks.push({ id: "postgres.schema", ok: missing.length === 0, summary: missing.length ? `Pending migrations: ${missing.join(", ")}` : "PostgreSQL schema is current." });
  } catch (error) {
    checks.push({ id: "postgres.schema", ok: false, summary: error instanceof Error ? error.message : String(error) });
  } finally {
    await pool.end();
  }

  for (const [id, target] of [
    ["storage.companies", path.join(input.repoRoot, "companies")],
    ["storage.data", path.join(input.repoRoot, ".data")],
    ...(input.staticWebRoot ? [["web.index", path.join(input.staticWebRoot, "index.html")]] : []),
  ] as Array<[string, string]>) {
    try {
      await access(target);
      checks.push({ id, ok: true, summary: "Available." });
    } catch {
      checks.push({ id, ok: false, summary: "Unavailable." });
    }
  }

  return {
    ok: checks.every(({ ok }) => ok),
    surface: "tinyoffice-readiness",
    deploymentMode: input.deploymentMode || "development",
    releaseVersion: input.releaseVersion || "unversioned",
    checks,
  };
}
