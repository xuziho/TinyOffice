export type RuntimeDatabaseBackend = "postgres";

export interface RuntimeDatabaseConfig {
  backend: RuntimeDatabaseBackend;
  postgresUrl?: string;
}

export interface RuntimeDatabaseConfigEnv {
  COMPANY_DATABASE_BACKEND?: string;
  TINYOFFICE_DB_BACKEND?: string;
  TINYOFFICE_DATABASE_URL?: string;
  TINYOFFICE_COMPANY_ID?: string;
  NODE_ENV?: string;
}

export function resolveRuntimeDatabaseConfig(
  env: RuntimeDatabaseConfigEnv = process.env,
  repoRoot: string = process.cwd(),
): RuntimeDatabaseConfig {
  const backendEnvName = env.COMPANY_DATABASE_BACKEND === undefined
    ? "TINYOFFICE_DB_BACKEND"
    : "COMPANY_DATABASE_BACKEND";
  const backendValue = env.COMPANY_DATABASE_BACKEND ?? env.TINYOFFICE_DB_BACKEND;
  const backend = (backendValue ?? "postgres").trim().toLowerCase();

  if (backend === "postgres") {
    const postgresUrl = env.TINYOFFICE_DATABASE_URL?.trim();
    if (!postgresUrl) {
      if (backendValue === undefined) {
        throw new Error(
          "TINYOFFICE_DATABASE_URL is required for the default PostgreSQL runtime backend.",
        );
      }
      throw new Error(
        `TINYOFFICE_DATABASE_URL is required when ${backendEnvName}=postgres.`,
      );
    }
    return {
      backend,
      postgresUrl,
    };
  }

  throw new Error(`${backendEnvName} must be postgres; received ${backend}.`);
}
