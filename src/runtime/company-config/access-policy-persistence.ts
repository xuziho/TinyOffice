import { normalizeCompanyId } from "./company-paths.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
} from "./postgres-runtime-connection.js";
import {
  defaultToolGuardPolicy,
  normalizeToolGuardPolicy,
  TOOL_GUARD_POLICY_SOURCE,
  type ToolGuardAdminState,
  type ToolGuardPolicy,
  type ToolSafetyCompanyOptions,
} from "./access-policy.js";
function resolveToolSafetyCompanyId(options: ToolSafetyCompanyOptions): string {
  return normalizeCompanyId(options.companyId);
}

export async function loadToolGuardAdminState(
  repoRoot: string,
  options: ToolSafetyCompanyOptions,
): Promise<ToolGuardAdminState> {
  return {
    policy: await loadToolGuardPolicy(repoRoot, options),
    policyPath: TOOL_GUARD_POLICY_SOURCE,
  };
}

export async function loadToolGuardPolicy(
  repoRoot: string,
  options: ToolSafetyCompanyOptions,
): Promise<ToolGuardPolicy> {
  const companyId = resolveToolSafetyCompanyId(options);
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  if (!postgres) {
    throw new Error("Access requires PostgreSQL runtime configuration.");
  }
  try {
    const rows = await postgres.client.query<{ policy_json: ToolGuardPolicy }>(
      "SELECT policy_json FROM tool_safety_policies WHERE company_id = $1 AND id = 'default'",
      [companyId],
    );
    return normalizeToolGuardPolicy(rows.rows[0]?.policy_json || defaultToolGuardPolicy);
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

export async function saveToolGuardPolicy(input: {
  repoRoot: string;
  policy: unknown;
  companyId: string;
}): Promise<ToolGuardAdminState> {
  const companyId = resolveToolSafetyCompanyId(input);
  const normalized = normalizeToolGuardPolicy(input.policy);
  const postgres = await openConfiguredPostgresConnection(input.repoRoot);
  if (!postgres) {
    throw new Error("Access requires PostgreSQL runtime configuration.");
  }
  try {
    await postgres.client.query(
      `INSERT INTO tool_safety_policies (company_id, id, policy_json, created_at, updated_at)
VALUES ($1, 'default', $2, NOW(), NOW())
ON CONFLICT (company_id, id) DO UPDATE SET
  policy_json = EXCLUDED.policy_json,
  updated_at = EXCLUDED.updated_at`,
      [companyId, normalized],
    );
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
  return {
    policy: normalized,
    policyPath: TOOL_GUARD_POLICY_SOURCE,
  };
}
