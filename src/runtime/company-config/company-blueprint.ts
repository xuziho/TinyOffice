import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PresenceMode } from "../../collaboration/runtime/presence-mode.js";
import type { EmployeeRuntimeConfig } from "./employees-admin.js";
import {
  DEFAULT_PROMPT_BLOCKS_BY_SCENE,
  DEFAULT_PROMPT_POLICY_BLOCKS,
  DEFAULT_BASE_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_RUNTIME_PROMPT_TEMPLATE,
  type PromptBlockScene,
} from "./prompt-blocks-admin.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
  type CompanyPostgresClient,
  type CompanyPostgresOpenOptions,
} from "./postgres-runtime-connection.js";
import { companyEmployeeHomePath, companySkillsRootPath, normalizeCompanyId } from "./company-paths.js";
import { deriveUniqueEmployeeId } from "./employee-id.js";
import { normalizeResourcePolicy, type EmployeeResourcePolicy } from "./resource-policy.js";
import { defaultToolGuardPolicy } from "./tool-guard-admin.js";
import {
  SYSTEM_AI_CHAT_TITLE_CAPABILITY,
  SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
} from "../../system-ai/provider-config.js";

export interface CompanyBlueprintInstance {
  companyId: string;
  displayName: string;
  hrEmployeeId: string;
  hrEmployeeDisplayName: string;
  hrEmployeeHomePath: string;
  hrEmployeeWorkspacePath: string;
}

interface CompanyBlueprint {
  version: 1;
  hrEmployee: {
    role: string;
    memberSummary: string;
    presenceMode: PresenceMode;
    thinkingLevel: EmployeeRuntimeConfig["thinkingLevel"];
    resourcePolicy: EmployeeResourcePolicy;
  };
}

export interface CompanyBlueprintSeedInput {
  client: CompanyPostgresClient;
  companyId: string;
  displayName?: unknown;
  hrEmployeeDisplayName?: unknown;
  hrRuntime?: unknown;
  systemAiRuntime?: unknown;
  ownerMemberId?: unknown;
  ownerDisplayName?: unknown;
  conflictMode?: "create" | "upsert";
}

export interface CompanyBlueprintSeedResult {
  companyId: string;
  displayName: string;
  hrEmployeeId: string;
  hrEmployeeDisplayName: string;
}

const DEFAULT_COMPANY_BLUEPRINT: CompanyBlueprint = {
  version: 1,
  hrEmployee: {
    role: "hr",
    memberSummary: "Company HR contact for initial member setup.",
    presenceMode: "resident",
    thinkingLevel: "medium",
    resourcePolicy: {
      version: 1,
      filesystem: {
        ownWorkspace: "allow",
        otherEmployeeWorkspace: "approval",
        repo: "approval",
        secrets: "deny",
      },
    },
  },
};

const PROMPT_POLICY_TEMPLATES = [
  {
    templateId: "base-system-prompt",
    title: "Base System Prompt",
    content: DEFAULT_BASE_SYSTEM_PROMPT_TEMPLATE.replace(/\n/g, "\r\n"),
  },
  {
    templateId: "runtime-prompt-template",
    title: "Runtime Prompt Template",
    content: DEFAULT_RUNTIME_PROMPT_TEMPLATE.replace(/\n/g, "\r\n"),
  },
] as const;

const SCENES: PromptBlockScene[] = ["dm_thread", "channel_thread", "intake_event", "work_run_execution"];

const HR_RECRUIT_EMPLOYEE_SKILL = [
  "---",
  "name: recruit-employee",
  "description: Use when the operator asks HR to recruit, hire, create, or configure a new TinyOffice employee.",
  "---",
  "",
  "## Recommended Draft First",
  "",
  "When the operator gives a clear purpose but not all fields, propose a complete draft with sensible defaults:",
  "",
  "- role: derive a short role from the purpose",
  "- displayName: first read existing company members, then generate a natural employee name that does not duplicate an existing displayName.",
  "- summary: one sentence describing what this employee will do",
  "- instructionContent: detailed responsibilities, working style, and practical boundaries",
  "- modelProvider and modelId: first read the currently available model list, then recommend one from that list, prioritize the smarter models.",
  "- thinkingLevel: default to `medium` unless the operator asks for cheaper, faster, or deeper reasoning",
  "",
  "Use English for API-bound fields.",
  "",
  "Before creation, show a confirmation checklist with the exact displayName, role, summary, modelId, thinkingLevel, and instructionContent that will be submitted.",
  "",
  "## Existing Member Check",
  "",
  "Call `tinyoffice_capability_call` with:",
  "",
  "{",
  "  \"capabilityId\": \"company.member.directory.list\"",
  "}",
  "",
  "The runtime tool will resolve companyId automatically.",
  "Use returned `displayName` values to avoid duplicate employee names. Use returned `employeeId` and `memberId` only for workflows that need to reference existing participants.",
  "",
  "## Model Selection",
  "",
  "Call `tinyoffice_capability_call` with:",
  "",
  "{",
  "  \"capabilityId\": \"runtime.models.list\"",
  "}",
  "",
  "Select a suitable model from the list of returned models. Prioritize the smarter models. Do not enter models other than those on the model list.",
  "",
  "## Create Employee",
  "",
  "Please refer to the format below and replace the placeholders with actual parameters when submitting.",
  "",
  "Call `tinyoffice_capability_call` with:",
  "",
  "{",
  "  \"capabilityId\": \"employee.recruit\",",
  "  \"confirmation\": {",
  "    \"accepted\": true",
  "  },",
  "  \"input\": {",
  "    \"displayName\": \"xxx\",",
  "    \"role\": \"xxx\",",
  "    \"summary\": \"xxx\",",
  "    \"instructionContent\": \"xxx\",",
  "    \"runtime\": {",
  "      \"version\": 1,",
  "      \"modelProvider\": \"xxx\",",
  "      \"modelId\": \"xxx\",",
  "      \"thinkingLevel\": \"xxx\"",
  "    }",
  "  }",
  "}",
  "",
  "Do not claim the employee exists before the API succeeds.",
  "",
].join("\n");

function normalizeCompanyDisplayName(value: unknown, companyId: string): string {
  const displayName = typeof value === "string" ? value.trim() : "";
  return displayName || companyId;
}

function normalizeBlueprintCompanyId(value: string): string {
  const companyId = normalizeCompanyId(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(companyId)) {
    throw new Error("companyId must use lowercase letters, numbers, and hyphens.");
  }
  return companyId;
}

function normalizeHrEmployeeDisplayName(value: unknown): string {
  const displayName = typeof value === "string" ? value.trim() : "";
  return displayName || "Company HR";
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOwnerMemberId(value: unknown): string | undefined {
  const memberId = normalizeOptionalString(value);
  if (!memberId) {
    return undefined;
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(memberId)) {
    throw new Error("ownerMemberId must use letters, numbers, underscores, or hyphens.");
  }
  return memberId;
}

function normalizeHrRuntime(value: unknown, fallbackThinkingLevel: EmployeeRuntimeConfig["thinkingLevel"]): EmployeeRuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      version: 1,
      thinkingLevel: fallbackThinkingLevel,
    };
  }
  const candidate = value as Partial<EmployeeRuntimeConfig>;
  const modelProvider = normalizeOptionalString(candidate.modelProvider);
  const modelId = normalizeOptionalString(candidate.modelId);
  if ((modelProvider && !modelId) || (!modelProvider && modelId)) {
    throw new Error("hrRuntime.modelProvider and hrRuntime.modelId must be provided together.");
  }
  return {
    version: 1,
    modelProvider,
    modelId,
    thinkingLevel: candidate.thinkingLevel || fallbackThinkingLevel,
  };
}

interface SystemAiRuntimeConfig {
  version: 1;
  modelProvider?: string;
  modelId?: string;
}

function normalizeSystemAiRuntime(value: unknown): SystemAiRuntimeConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("systemAiRuntime must be a JSON object when provided.");
  }
  const candidate = value as Partial<SystemAiRuntimeConfig>;
  const modelProvider = normalizeOptionalString(candidate.modelProvider);
  const modelId = normalizeOptionalString(candidate.modelId);
  if ((modelProvider && !modelId) || (!modelProvider && modelId)) {
    throw new Error("systemAiRuntime.modelProvider and systemAiRuntime.modelId must be provided together.");
  }
  if (!modelProvider || !modelId) {
    return undefined;
  }
  return {
    version: 1,
    modelProvider,
    modelId,
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function seedPromptPolicyDefaults(client: CompanyPostgresClient, companyId: string): Promise<void> {
  for (const [blockId, block] of Object.entries(DEFAULT_PROMPT_POLICY_BLOCKS)) {
    await client.query(
      `INSERT INTO prompt_policy_blocks (company_id, block_id, title, content, content_sha256, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
ON CONFLICT (company_id, block_id) DO NOTHING`,
      [companyId, blockId, block.title, block.content, sha256(block.content)],
    );
  }

  for (const template of PROMPT_POLICY_TEMPLATES) {
    await client.query(
      `INSERT INTO prompt_policy_templates (company_id, template_id, title, content, content_sha256, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
ON CONFLICT (company_id, template_id) DO NOTHING`,
      [companyId, template.templateId, template.title, template.content, sha256(template.content)],
    );
  }

  for (const scene of SCENES) {
    await client.query(
      `INSERT INTO prompt_policy_bindings (company_id, mount_kind, scene_type, block_id, position, created_at, updated_at)
VALUES ($1, 'scene', $2, $3, 0, NOW(), NOW())
ON CONFLICT DO NOTHING`,
      [companyId, scene, DEFAULT_PROMPT_BLOCKS_BY_SCENE[scene]],
    );
  }
}

async function seedAccessDefaults(client: CompanyPostgresClient, companyId: string): Promise<void> {
  await client.query(
    `INSERT INTO tool_safety_policies (company_id, id, policy_json, created_at, updated_at)
VALUES ($1, 'default', $2, NOW(), NOW())
ON CONFLICT (company_id, id) DO NOTHING`,
    [companyId, defaultToolGuardPolicy],
  );
}

async function seedSystemAiProviderDefaults(input: {
  client: CompanyPostgresClient;
  companyId: string;
  runtime?: unknown;
}): Promise<void> {
  const runtime = normalizeSystemAiRuntime(input.runtime);
  if (!runtime?.modelProvider || !runtime.modelId) {
    return;
  }
  const modelRef = `${runtime.modelProvider}/${runtime.modelId}`;
  for (const capability of [SYSTEM_AI_CHAT_TITLE_CAPABILITY, SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY]) {
    await input.client.query(
      `INSERT INTO system_ai_provider_configs (
  company_id, capability, provider_kind, enabled, config_ref, model_ref, config_version, created_at, updated_at
)
VALUES ($1, $2, 'pi_model', true, NULL, $3, 1, NOW(), NOW())
ON CONFLICT (company_id, capability) DO UPDATE SET
  provider_kind = EXCLUDED.provider_kind,
  enabled = EXCLUDED.enabled,
  config_ref = EXCLUDED.config_ref,
  model_ref = EXCLUDED.model_ref,
  config_version = system_ai_provider_configs.config_version + 1,
  updated_at = NOW()`,
      [input.companyId, capability, modelRef],
    );
  }
}

async function seedHrEmployee(input: {
  client: CompanyPostgresClient;
  companyId: string;
  employeeId: string;
  displayName: string;
  runtime?: unknown;
  blueprint: CompanyBlueprint;
}): Promise<void> {
  const employee = input.blueprint.hrEmployee;
  const runtime = normalizeHrRuntime(input.runtime, employee.thinkingLevel);
  await input.client.query(
    `INSERT INTO company_members (
  company_id, id, display_name, role, summary, avatar_seed, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $2, NOW(), NOW())
ON CONFLICT (company_id, id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  summary = EXCLUDED.summary,
  updated_at = NOW()`,
    [input.companyId, input.employeeId, input.displayName, employee.role, employee.memberSummary],
  );
  await input.client.query(
    `INSERT INTO member_runtime_profiles (
  company_id, member_id, presence_mode, model_provider, model_id, thinking_level, resource_policy_json, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
ON CONFLICT (company_id, member_id) DO UPDATE SET
  presence_mode = EXCLUDED.presence_mode,
  model_provider = EXCLUDED.model_provider,
  model_id = EXCLUDED.model_id,
  thinking_level = EXCLUDED.thinking_level,
  resource_policy_json = EXCLUDED.resource_policy_json,
  updated_at = NOW()`,
    [
      input.companyId,
      input.employeeId,
      employee.presenceMode,
      runtime.modelProvider ?? null,
      runtime.modelId ?? null,
      runtime.thinkingLevel,
      normalizeResourcePolicy(employee.resourcePolicy),
    ],
  );
}

async function resolveHrEmployeeId(input: {
  client: CompanyPostgresClient;
  companyId: string;
  displayName: string;
}): Promise<string> {
  const existing = await input.client.query<{
    id: string;
    display_name: string;
    role: string;
  }>(
    "SELECT id, display_name, role FROM company_members WHERE company_id = $1 ORDER BY created_at ASC, id ASC",
    [input.companyId],
  );
  const existingBlueprintHr = existing.rows.find((member) =>
    member.role === DEFAULT_COMPANY_BLUEPRINT.hrEmployee.role &&
    member.display_name === input.displayName
  );
  if (existingBlueprintHr) {
    return existingBlueprintHr.id;
  }
  return deriveUniqueEmployeeId({
    displayName: input.displayName,
    existingIds: existing.rows.map((member) => member.id),
  });
}

async function seedOwnerMember(input: {
  client: CompanyPostgresClient;
  companyId: string;
  ownerMemberId?: unknown;
  ownerDisplayName?: unknown;
}): Promise<void> {
  const ownerMemberId = normalizeOwnerMemberId(input.ownerMemberId);
  if (!ownerMemberId) {
    return;
  }
  const ownerDisplayName = normalizeOptionalString(input.ownerDisplayName) || ownerMemberId;
  await input.client.query(
    `INSERT INTO company_members (
  company_id, id, display_name, role, summary, avatar_seed, created_at, updated_at
)
VALUES ($1, $2, $3, 'boss', 'Company boss.', $2, NOW(), NOW())
ON CONFLICT (company_id, id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  summary = EXCLUDED.summary,
  updated_at = NOW()`,
    [input.companyId, ownerMemberId, ownerDisplayName],
  );
}

export async function writeDefaultCompanyBlueprintAssets(input: {
  repoRoot: string;
  companyId: string;
  employeeId: string;
  displayName: string;
}): Promise<{
  homePath: string;
  workspacePath: string;
}> {
  const homePath = companyEmployeeHomePath({
    repoRoot: input.repoRoot,
    companyId: input.companyId,
    employeeId: input.employeeId,
  });
  const workspacePath = path.join(homePath, "workspace");
  const recruitSkillPath = path.join(homePath, "skills", "recruit-employee");
  await mkdir(companySkillsRootPath({ repoRoot: input.repoRoot, companyId: input.companyId }), { recursive: true });
  await mkdir(workspacePath, { recursive: true });
  await mkdir(recruitSkillPath, { recursive: true });
  await writeFile(
    path.join(homePath, "AGENTS.md"),
    [
      `# ${input.displayName}`,
      "",
      "You are the Company HR for this Company.",
      "Your narrow responsibility is initial member setup and helping the operator configure runtime-capable members.",
      "Use the Company Prompt Policy and Access policy as the shared operating boundary.",
      "Keep work inside your company-scoped workspace unless a tool policy explicitly allows a broader path.",
      "You are not a full conversational HR Agent and you do not have unlimited admin privileges.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(recruitSkillPath, "SKILL.md"),
    HR_RECRUIT_EMPLOYEE_SKILL,
    "utf8",
  );
  await writeFile(
    path.join(workspacePath, "README.md"),
    [
      `# ${input.displayName} Workspace`,
      "",
      "This workspace belongs to the Company HR for this Company.",
      "",
    ].join("\n"),
    "utf8",
  );
  return { homePath, workspacePath };
}

export async function seedDefaultCompanyBlueprintData(input: CompanyBlueprintSeedInput): Promise<CompanyBlueprintSeedResult> {
  const companyId = normalizeBlueprintCompanyId(input.companyId);
  const displayName = normalizeCompanyDisplayName(input.displayName, companyId);
  const hrEmployeeDisplayName = normalizeHrEmployeeDisplayName(input.hrEmployeeDisplayName);
  const blueprint = DEFAULT_COMPANY_BLUEPRINT;
  const conflictMode = input.conflictMode || "upsert";

  if (conflictMode === "create") {
    await input.client.query(
      `INSERT INTO companies (company_id, display_name, created_at, updated_at)
VALUES ($1, $2, NOW(), NOW())`,
      [companyId, displayName],
    );
  } else {
    await input.client.query(
      `INSERT INTO companies (company_id, display_name, created_at, updated_at)
VALUES ($1, $2, NOW(), NOW())
ON CONFLICT (company_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  updated_at = NOW()`,
      [companyId, displayName],
    );
  }

  await seedPromptPolicyDefaults(input.client, companyId);
  await seedAccessDefaults(input.client, companyId);
  await seedSystemAiProviderDefaults({
    client: input.client,
    companyId,
    runtime: input.systemAiRuntime,
  });
  await seedOwnerMember({
    client: input.client,
    companyId,
    ownerMemberId: input.ownerMemberId,
    ownerDisplayName: input.ownerDisplayName,
  });
  const hrEmployeeId = await resolveHrEmployeeId({
    client: input.client,
    companyId,
    displayName: hrEmployeeDisplayName,
  });
  await seedHrEmployee({
    client: input.client,
    companyId,
    employeeId: hrEmployeeId,
    displayName: hrEmployeeDisplayName,
    runtime: input.hrRuntime,
    blueprint,
  });

  return {
    companyId,
    displayName,
    hrEmployeeId,
    hrEmployeeDisplayName,
  };
}

export async function instantiateDefaultCompanyBlueprint(input: {
  repoRoot: string;
  companyId: string;
  displayName?: unknown;
  hrEmployeeDisplayName?: unknown;
  hrRuntime?: unknown;
  systemAiRuntime?: unknown;
  ownerMemberId?: unknown;
  ownerDisplayName?: unknown;
  conflictMode?: "create" | "upsert";
} & CompanyPostgresOpenOptions): Promise<CompanyBlueprintInstance> {
  const postgres = await openConfiguredPostgresConnection(input.repoRoot, input);
  if (!postgres) {
    throw new Error("Company Blueprint instantiation requires PostgreSQL runtime configuration.");
  }

  let seed: CompanyBlueprintSeedResult | undefined;
  let assets: Awaited<ReturnType<typeof writeDefaultCompanyBlueprintAssets>> | undefined;
  try {
    await postgres.client.query("BEGIN");
    seed = await seedDefaultCompanyBlueprintData({
      client: postgres.client,
      companyId: input.companyId,
      displayName: input.displayName,
      hrEmployeeDisplayName: input.hrEmployeeDisplayName,
      hrRuntime: input.hrRuntime,
      systemAiRuntime: input.systemAiRuntime,
      ownerMemberId: input.ownerMemberId,
      ownerDisplayName: input.ownerDisplayName,
      conflictMode: input.conflictMode,
    });
    assets = await writeDefaultCompanyBlueprintAssets({
      repoRoot: input.repoRoot,
      companyId: seed.companyId,
      employeeId: seed.hrEmployeeId,
      displayName: seed.hrEmployeeDisplayName,
    });
    await postgres.client.query("COMMIT");
  } catch (error) {
    await postgres.client.query("ROLLBACK");
    throw error;
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }

  if (!seed || !assets) {
    throw new Error("Company Blueprint instantiation did not return seeded Company data.");
  }

  return {
    companyId: seed.companyId,
    displayName: seed.displayName,
    hrEmployeeId: seed.hrEmployeeId,
    hrEmployeeDisplayName: seed.hrEmployeeDisplayName,
    hrEmployeeHomePath: assets.homePath,
    hrEmployeeWorkspacePath: assets.workspacePath,
  };
}
