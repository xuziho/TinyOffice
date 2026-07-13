import {
  resolveRuntimeDatabaseConfig,
  type RuntimeDatabaseConfigEnv,
} from "./company-database-config.js";
import {
  runPostgresSchemaMigrations,
  type PostgresMigrationClient,
  type PostgresPoolLike,
} from "./postgres-company-database.js";

export interface CompanyPostgresClient extends PostgresMigrationClient {
  release(): void;
}

export interface CompanyPostgresPoolLike extends PostgresPoolLike {
  connect(): Promise<CompanyPostgresClient>;
  end?(): Promise<void>;
}

export interface CompanyPostgresOpenOptions {
  companyId?: string;
  env?: RuntimeDatabaseConfigEnv;
  createPostgresPool?: (databaseUrl: string) => CompanyPostgresPoolLike;
}

export interface ConfiguredPostgresConnection {
  client: CompanyPostgresClient;
  pool: CompanyPostgresPoolLike;
}

const trackedPostgresPoolEnds = new Set<Promise<unknown>>();
const sharedDefaultPostgresPools = new Map<string, Promise<CompanyPostgresPoolLike>>();
const sharedDefaultPostgresPoolInstances = new WeakSet<object>();
const sharedDefaultPostgresMigrations = new Map<string, Promise<void>>();

export function endCompanyPostgresPool(pool: { end?(): Promise<void> }): Promise<void> {
  if (sharedDefaultPostgresPoolInstances.has(pool as object)) {
    return Promise.resolve();
  }
  if (!pool.end) {
    return Promise.resolve();
  }
  const endPromise = pool.end();
  const trackedPromise = endPromise
    .catch(() => undefined)
    .finally(() => {
      trackedPostgresPoolEnds.delete(trackedPromise);
    });
  trackedPostgresPoolEnds.add(trackedPromise);
  return endPromise;
}

export function releaseCompanyPostgresConnection(input: {
  client: CompanyPostgresClient;
  pool: { end?(): Promise<void> };
  destroyClient?: boolean;
}): void {
  if (sharedDefaultPostgresPoolInstances.has(input.pool as object)) {
    input.client.release();
    return;
  }
  (input.client.release as (destroy?: boolean) => void)(input.destroyClient ?? true);
  void endCompanyPostgresPool(input.pool);
}

export async function waitForTrackedPostgresPoolEnds(): Promise<void> {
  while (trackedPostgresPoolEnds.size > 0) {
    await Promise.allSettled([...trackedPostgresPoolEnds]);
  }
}

async function createDefaultPostgresPool(databaseUrl: string): Promise<CompanyPostgresPoolLike> {
  const existing = sharedDefaultPostgresPools.get(databaseUrl);
  if (existing) {
    return existing;
  }
  const creating = (async () => {
    const pg = await import("pg");
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      allowExitOnIdle: true,
      max: 20,
      idleTimeoutMillis: 1000,
    }) as CompanyPostgresPoolLike;
    sharedDefaultPostgresPoolInstances.add(pool as object);
    return pool;
  })();
  sharedDefaultPostgresPools.set(databaseUrl, creating);
  try {
    return await creating;
  } catch (error) {
    sharedDefaultPostgresPools.delete(databaseUrl);
    throw error;
  }
}

export async function openConfiguredPostgresConnection(
  repoRoot: string,
  options: CompanyPostgresOpenOptions = {},
): Promise<ConfiguredPostgresConnection | undefined> {
  const config = resolveRuntimeDatabaseConfig(options.env, repoRoot);
  if (config.backend !== "postgres") {
    return undefined;
  }

  const postgresUrl = config.postgresUrl as string;
  const pool = options.createPostgresPool
    ? options.createPostgresPool(postgresUrl)
    : await createDefaultPostgresPool(postgresUrl);
  const client = await pool.connect();
  try {
    if (options.createPostgresPool) {
      await runPostgresSchemaMigrations(client);
    } else {
      let migrations = sharedDefaultPostgresMigrations.get(postgresUrl);
      if (!migrations) {
        migrations = runPostgresSchemaMigrations(client).then(() => undefined);
        sharedDefaultPostgresMigrations.set(postgresUrl, migrations);
      }
      try {
        await migrations;
      } catch (error) {
        sharedDefaultPostgresMigrations.delete(postgresUrl);
        throw error;
      }
    }
    return { client, pool };
  } catch (error) {
    client.release();
    await endCompanyPostgresPool(pool);
    throw error;
  }
}
