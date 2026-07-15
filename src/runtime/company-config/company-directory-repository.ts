import type { PresenceMode } from "../../collaboration/runtime/presence-mode.js";
import type {
  EmployeeHomeProfile,
} from "../registry/employee-home.js";
import type { EmployeeRuntimeConfig, EmployeeThinkingLevel } from "./employees-admin.js";
import {
  DEFAULT_RESOURCE_POLICY,
  normalizeResourcePolicy,
  type EmployeeResourcePolicy,
} from "./resource-policy.js";
import {
  openConfiguredPostgresConnection,
  releaseCompanyPostgresConnection,
  type CompanyPostgresClient,
  type CompanyPostgresOpenOptions,
  type CompanyPostgresPoolLike,
} from "./postgres-runtime-connection.js";
import { normalizeCompanyId } from "./company-paths.js";

export interface CompanyDirectoryEmployeeRecord {
  employeeId: string;
  profile: EmployeeHomeProfile;
  enabled: boolean;
  resourcePolicy: EmployeeResourcePolicy;
  runtime: EmployeeRuntimeConfig;
}

export interface CompanyDirectorySnapshot {
  employees: CompanyDirectoryEmployeeRecord[];
}

export interface CompanyDirectoryRepositoryOpenOptions extends CompanyPostgresOpenOptions {
  companyId: string;
}

const DEFAULT_RUNTIME_CONFIG: EmployeeRuntimeConfig = {
  version: 1,
  thinkingLevel: "minimal",
};

function normalizeRuntime(value: unknown): EmployeeRuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_RUNTIME_CONFIG;
  }
  const candidate = value as Partial<EmployeeRuntimeConfig>;
  return {
    version: 1,
    modelProvider:
      typeof candidate.modelProvider === "string" && candidate.modelProvider.trim()
        ? candidate.modelProvider.trim()
        : undefined,
    modelId:
      typeof candidate.modelId === "string" && candidate.modelId.trim()
        ? candidate.modelId.trim()
        : undefined,
    thinkingLevel: candidate.thinkingLevel || "minimal",
  };
}

interface EmployeeDirectoryRow {
  member_id: string;
  avatar_seed: string;
  display_name: string;
  role: string;
  summary: string | null;
  presence_mode: PresenceMode;
  model_provider: string | null;
  model_id: string | null;
  thinking_level: EmployeeThinkingLevel | null;
  resource_policy_json: EmployeeResourcePolicy | null;
  lifecycle_status: "active" | "inactive";
}

function recordFromRow(row: EmployeeDirectoryRow): CompanyDirectoryEmployeeRecord {
  const displayName = requiredMemberIdentityText(row.display_name, "displayName", row.member_id);
  const role = requiredMemberIdentityText(row.role, "role", row.member_id);
  const avatarSeed = requiredMemberIdentityText(row.avatar_seed, "avatarSeed", row.member_id);
  const profile: EmployeeHomeProfile = {
    employeeId: row.member_id,
    avatarSeed,
    role,
    displayName,
    presenceMode: row.presence_mode,
    sceneProfile: row.summary || undefined,
  };
  return {
    employeeId: row.member_id,
    profile,
    enabled: row.lifecycle_status === "active",
    resourcePolicy: normalizeResourcePolicy(row.resource_policy_json || DEFAULT_RESOURCE_POLICY),
    runtime: normalizeRuntime({
      version: 1,
      modelProvider: row.model_provider || undefined,
      modelId: row.model_id || undefined,
      thinkingLevel: row.thinking_level || "minimal",
    }),
  };
}

function requiredMemberIdentityText(value: string | null | undefined, field: string, memberId: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} is required for Company member ${memberId}`);
  }
  return normalized;
}

export class CompanyDirectoryRepository {
  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
    private readonly companyId: string,
  ) {}

  static async open(
    repoRoot: string,
    options: CompanyDirectoryRepositoryOpenOptions,
  ): Promise<CompanyDirectoryRepository> {
    const companyId = normalizeCompanyId(options.companyId);
    const postgres = await openConfiguredPostgresConnection(repoRoot, options);
    if (!postgres) {
      throw new Error("Company Directory requires PostgreSQL runtime configuration.");
    }
    return new CompanyDirectoryRepository(postgres.client, postgres.pool, companyId);
  }

  async save(): Promise<void> {}

  close(): void {
    releaseCompanyPostgresConnection({ client: this.client, pool: this.pool });
  }

  hasEmployees(): boolean {
    throw new Error("Use loadSnapshot() for filesystem-backed employee directory reads.");
  }

  async loadSnapshot(): Promise<CompanyDirectorySnapshot> {
    return {
      employees: await this.loadEmployees(),
    };
  }

  async loadEmployees(): Promise<CompanyDirectoryEmployeeRecord[]> {
    const rows = await this.client.query<EmployeeDirectoryRow>(`
SELECT
  runtime.member_id,
  member.avatar_seed,
  member.display_name,
  member.role,
  member.summary,
  runtime.presence_mode,
  runtime.model_provider,
  runtime.model_id,
  runtime.thinking_level,
  runtime.resource_policy_json,
  runtime.lifecycle_status
FROM member_runtime_profiles runtime
JOIN company_members member ON member.company_id = runtime.company_id AND member.id = runtime.member_id
WHERE runtime.company_id = $1
ORDER BY runtime.member_id ASC
`, [this.companyId]);
    return rows.rows.map(recordFromRow);
  }

  async getRuntimeConfig(employeeId: string): Promise<EmployeeRuntimeConfig | undefined> {
    const rows = await this.client.query<{
      model_provider: string | null;
      model_id: string | null;
      thinking_level: EmployeeThinkingLevel;
    }>(
      `SELECT model_provider, model_id, thinking_level
FROM member_runtime_profiles
WHERE company_id = $1 AND member_id = $2`,
      [this.companyId, employeeId],
    );
    const row = rows.rows[0];
    return row
      ? normalizeRuntime({
        version: 1,
        modelProvider: row.model_provider || undefined,
        modelId: row.model_id || undefined,
        thinkingLevel: row.thinking_level,
      })
      : undefined;
  }

  async upsertEmployee(record: CompanyDirectoryEmployeeRecord): Promise<void> {
    const timestamp = new Date().toISOString();
    const displayName = requiredMemberIdentityText(record.profile.displayName, "displayName", record.employeeId);
    const role = requiredMemberIdentityText(record.profile.role, "role", record.employeeId);
    const avatarSeed = record.profile.avatarSeed?.trim() || record.employeeId;
    await this.client.query("BEGIN");
    try {
      await this.client.query(
        `INSERT INTO company_members (
  company_id, id, display_name, role, summary, avatar_seed, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
ON CONFLICT (company_id, id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  summary = EXCLUDED.summary,
  avatar_seed = EXCLUDED.avatar_seed,
  updated_at = EXCLUDED.updated_at`,
        [
          this.companyId,
          record.employeeId,
          displayName,
          role,
          record.profile.sceneProfile ?? null,
          avatarSeed,
          timestamp,
        ],
      );

      const runtime = normalizeRuntime(record.runtime);
      if (!runtime.modelProvider || !runtime.modelId) {
        throw new Error("runtime.modelProvider and runtime.modelId are required");
      }
      await this.client.query(
        `INSERT INTO member_runtime_profiles (
  company_id, member_id, presence_mode, model_provider, model_id, thinking_level, resource_policy_json, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
ON CONFLICT (company_id, member_id) DO UPDATE SET
  presence_mode = EXCLUDED.presence_mode,
  model_provider = EXCLUDED.model_provider,
  model_id = EXCLUDED.model_id,
  thinking_level = EXCLUDED.thinking_level,
  resource_policy_json = EXCLUDED.resource_policy_json,
  updated_at = EXCLUDED.updated_at`,
        [
          this.companyId,
          record.employeeId,
          record.profile.presenceMode,
          runtime.modelProvider,
          runtime.modelId,
          runtime.thinkingLevel,
          normalizeResourcePolicy(record.resourcePolicy),
          timestamp,
        ],
      );

      await this.client.query("COMMIT");
    } catch (error) {
      await this.client.query("ROLLBACK");
      throw error;
    }
  }

  async setEmployeeEnabled(employeeId: string, enabled: boolean): Promise<void> {
    const result = await this.client.query(
      `UPDATE member_runtime_profiles
SET lifecycle_status = $3,
    deactivated_at = CASE WHEN $3 = 'inactive' THEN NOW() ELSE NULL END,
    updated_at = NOW()
WHERE company_id = $1 AND member_id = $2
RETURNING member_id`,
      [this.companyId, employeeId, enabled ? "active" : "inactive"],
    );
    if (result.rows.length !== 1) {
      throw new Error(`Runtime-capable member ${employeeId} was not found.`);
    }
  }
}
