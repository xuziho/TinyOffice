import { openConfiguredPostgresConnection } from "../runtime/company-config/postgres-runtime-connection.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresOpenOptions,
  CompanyPostgresPoolLike,
} from "../runtime/company-config/postgres-runtime-connection.js";
import { endCompanyPostgresPool } from "../runtime/company-config/postgres-runtime-connection.js";
import type {
  SystemAiAuditEvent,
  SystemAiAuditEventListInput,
  SystemAiAuditRepository,
  SystemAiProviderConfigLookup,
  SystemAiProviderConfigRecord,
  SystemAiProviderConfigRepository,
} from "./provider-config.js";

function timestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date().toISOString();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function jsonValue<T>(value: unknown): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value as T;
}

function providerConfigFromRow(row: Record<string, unknown>): SystemAiProviderConfigRecord {
  return {
    schema: "system-ai-provider-config",
    version: 1,
    companyId: String(row.company_id),
    capability: row.capability as SystemAiProviderConfigRecord["capability"],
    providerKind: row.provider_kind as SystemAiProviderConfigRecord["providerKind"],
    enabled: Boolean(row.enabled),
    configRef: optionalText(row.config_ref),
    modelRef: optionalText(row.model_ref),
    configVersion: Number(row.config_version),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function auditEventFromRow(row: Record<string, unknown>): SystemAiAuditEvent {
  return {
    eventId: String(row.event_id),
    companyId: String(row.company_id),
    capability: row.capability as SystemAiAuditEvent["capability"],
    requestId: String(row.request_id),
    source: jsonValue<SystemAiAuditEvent["source"]>(row.source_json),
    provider: row.provider_json ? jsonValue<SystemAiAuditEvent["provider"]>(row.provider_json) : undefined,
    status: row.status as SystemAiAuditEvent["status"],
    errorReason: optionalText(row.error_reason),
    occurredAt: timestamp(row.occurred_at),
  };
}

export class PostgresSystemAiProviderConfigRepository implements SystemAiProviderConfigRepository {
  constructor(private readonly client: CompanyPostgresClient) {}

  static async open(repoRoot: string, options: CompanyPostgresOpenOptions = {}): Promise<{
    repository: PostgresSystemAiProviderConfigRepository;
    close(): void;
  }> {
    const postgres = await openConfiguredPostgresConnection(repoRoot, options);
    if (!postgres) {
      throw new Error("System AI provider config requires PostgreSQL runtime configuration.");
    }
    return {
      repository: new PostgresSystemAiProviderConfigRepository(postgres.client),
      close() {
        postgres.client.release();
        void endCompanyPostgresPool(postgres.pool);
      },
    };
  }

  async getProviderConfig(input: SystemAiProviderConfigLookup): Promise<SystemAiProviderConfigRecord | undefined> {
    const rows = await this.client.query<Record<string, unknown>>(
      `SELECT company_id, capability, provider_kind, enabled, config_ref, model_ref, config_version, created_at, updated_at
FROM system_ai_provider_configs
WHERE company_id = $1 AND capability = $2
LIMIT 1`,
      [input.companyId, input.capability],
    );
    const row = rows.rows[0];
    return row ? providerConfigFromRow(row) : undefined;
  }

  async saveProviderConfig(record: SystemAiProviderConfigRecord): Promise<SystemAiProviderConfigRecord> {
    const rows = await this.client.query<Record<string, unknown>>(
      `INSERT INTO system_ai_provider_configs (
  company_id, capability, provider_kind, enabled, config_ref, model_ref, config_version, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (company_id, capability) DO UPDATE SET
  provider_kind = EXCLUDED.provider_kind,
  enabled = EXCLUDED.enabled,
  config_ref = EXCLUDED.config_ref,
  model_ref = EXCLUDED.model_ref,
  config_version = EXCLUDED.config_version,
  updated_at = EXCLUDED.updated_at
RETURNING company_id, capability, provider_kind, enabled, config_ref, model_ref, config_version, created_at, updated_at`,
      [
        record.companyId,
        record.capability,
        record.providerKind,
        record.enabled,
        record.configRef ?? null,
        record.modelRef ?? null,
        record.configVersion,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return providerConfigFromRow(rows.rows[0] || {});
  }
}

export class PostgresSystemAiAuditRepository implements SystemAiAuditRepository {
  constructor(private readonly client: CompanyPostgresClient) {}

  static async open(repoRoot: string, options: CompanyPostgresOpenOptions = {}): Promise<{
    repository: PostgresSystemAiAuditRepository;
    close(): void;
  }> {
    const postgres = await openConfiguredPostgresConnection(repoRoot, options);
    if (!postgres) {
      throw new Error("System AI audit repository requires PostgreSQL runtime configuration.");
    }
    return {
      repository: new PostgresSystemAiAuditRepository(postgres.client),
      close() {
        postgres.client.release();
        void endCompanyPostgresPool(postgres.pool);
      },
    };
  }

  async recordEvent(event: SystemAiAuditEvent): Promise<SystemAiAuditEvent> {
    const rows = await this.client.query<Record<string, unknown>>(
      `INSERT INTO system_ai_audit_events (
  company_id, event_id, capability, request_id, source_json, provider_json, status, error_reason, occurred_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING company_id, event_id, capability, request_id, source_json, provider_json, status, error_reason, occurred_at`,
      [
        event.companyId,
        event.eventId,
        event.capability,
        event.requestId,
        event.source,
        event.provider ?? null,
        event.status,
        event.errorReason ?? null,
        event.occurredAt,
      ],
    );
    return auditEventFromRow(rows.rows[0] || {});
  }

  async listEvents(input: SystemAiAuditEventListInput): Promise<SystemAiAuditEvent[]> {
    const rows = await this.client.query<Record<string, unknown>>(
      `SELECT company_id, event_id, capability, request_id, source_json, provider_json, status, error_reason, occurred_at
FROM system_ai_audit_events
WHERE company_id = $1
  AND ($2::text IS NULL OR request_id = $2)
  AND ($3::text IS NULL OR capability = $3)
ORDER BY occurred_at ASC, event_id ASC`,
      [input.companyId, input.requestId ?? null, input.capability ?? null],
    );
    return rows.rows.map(auditEventFromRow);
  }
}
