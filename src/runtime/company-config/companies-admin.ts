import { rm } from "node:fs/promises";
import path from "node:path";

import { companyHomePath } from "./company-paths.js";
import {
  loadPiModelState,
  type AvailablePiModel,
  type EmployeeRuntimeConfig,
} from "./employees-admin.js";
import {
  instantiateDefaultCompanyBlueprint,
  type CompanyBlueprintInstance,
} from "./company-blueprint.js";
import {
  SYSTEM_AI_CHAT_TITLE_CAPABILITY,
  SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
  SystemAiProviderConfigService,
  type SystemAiCapability,
} from "../../system-ai/provider-config.js";
import { PostgresSystemAiProviderConfigRepository } from "../../system-ai/postgres-system-ai-repository.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
  type CompanyPostgresClient,
  type CompanyPostgresOpenOptions,
  type CompanyPostgresPoolLike,
} from "./postgres-runtime-connection.js";

export interface CompanyRecord {
  companyId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanySystemAiSetting {
  companyId: string;
  capability: SystemAiCapability;
  label: string;
  enabled: boolean;
  configured: boolean;
  modelProvider?: string;
  modelId?: string;
  modelRef?: string;
  modelDisplay?: string;
}

export interface DeleteCompanyResult {
  companyId: string;
  deletedAssetPath: string;
  viewModel: CompaniesAdminViewModel;
}

export interface CompanyRuntimeDeletionGuard {
  ensureSafeToDeleteCompany(companyId: string): Promise<void>;
}

export interface OwnedCreateCompanyResult {
  company: CompanyRecord;
  hr: CompanyBlueprintInstance;
  owner?: {
    memberId: string;
    displayName: string;
    role: "boss";
  };
  viewModel: CompaniesAdminViewModel;
}

export interface CompaniesAdminViewModel {
  contract: {
    name: "company-lifecycle";
    version: 1;
    boundary: "company-lifecycle";
  };
  routes: {
    htmlPath: string;
    companiesJsonPath: string;
    createCompanyPath: string;
    deleteCompanyPath: string;
  };
  companies: CompanyRecord[];
  availableModels: AvailablePiModel[];
  systemAiSettings: CompanySystemAiSetting[];
}

export interface SaveCompanySystemAiSettingsInput {
  repoRoot: string;
  companyId?: unknown;
  settings?: {
    chatTitleGeneration?: {
      modelProvider?: unknown;
      modelId?: unknown;
    };
    chatTopicSummary?: {
      modelProvider?: unknown;
      modelId?: unknown;
    };
  };
}

interface CompanyRow {
  company_id: string;
  display_name: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SystemAiProviderConfigRow {
  company_id: string;
  capability: SystemAiCapability;
  enabled: boolean;
  model_ref: string | null;
}

const SYSTEM_AI_CAPABILITIES: Array<{ capability: SystemAiCapability; label: string }> = [
  { capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY, label: "Chat title generation" },
  { capability: SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY, label: "Topic summaries" },
];

function normalizeCompanyId(value: unknown): string {
  const companyId = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!companyId) {
    throw new Error("companyId is required.");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(companyId)) {
    throw new Error("companyId must use lowercase letters, numbers, and hyphens.");
  }
  return companyId;
}

function deriveCompanyIdFromDisplayName(value: unknown): string {
  const displayName = typeof value === "string" ? value.trim() : "";
  if (!displayName) {
    throw new Error("Company display name is required.");
  }
  const companyId = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  if (!companyId) {
    throw new Error("Company display name must include letters or numbers so TinyOffice can derive a companyId.");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(companyId)) {
    throw new Error("Company display name must derive a companyId with at least 2 lowercase letters, numbers, or hyphens.");
  }
  return companyId;
}

function normalizeCreateCompanyId(input: {
  companyId?: unknown;
  displayName?: unknown;
}): string {
  return typeof input.companyId === "string" && input.companyId.trim()
    ? normalizeCompanyId(input.companyId)
    : deriveCompanyIdFromDisplayName(input.displayName);
}

function normalizeDisplayName(value: unknown, companyId: string): string {
  const displayName = typeof value === "string" ? value.trim() : "";
  return displayName || companyId;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseModelRef(modelRef: string | undefined): {
  modelProvider?: string;
  modelId?: string;
  modelDisplay?: string;
} {
  if (!modelRef) {
    return {};
  }
  const [modelProvider, ...modelIdParts] = modelRef.split("/");
  const modelId = modelIdParts.join("/");
  if (!modelProvider || !modelId) {
    return {};
  }
  return {
    modelProvider,
    modelId,
    modelDisplay: `${modelProvider} / ${modelId}`,
  };
}

function normalizeSystemAiModelInput(value: {
  modelProvider?: unknown;
  modelId?: unknown;
} | undefined): {
  modelProvider?: string;
  modelId?: string;
  modelRef?: string;
  enabled: boolean;
} {
  const modelProvider = normalizeOptionalString(value?.modelProvider);
  const modelId = normalizeOptionalString(value?.modelId);
  if ((modelProvider && !modelId) || (!modelProvider && modelId)) {
    throw new Error("System AI modelProvider and modelId must be provided together.");
  }
  if (!modelProvider || !modelId) {
    return { enabled: false };
  }
  return {
    modelProvider,
    modelId,
    modelRef: `${modelProvider}/${modelId}`,
    enabled: true,
  };
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

function normalizeHrRuntime(value: unknown): EmployeeRuntimeConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("hrRuntime must be a JSON object when provided.");
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
    thinkingLevel: candidate.thinkingLevel || "medium",
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

function normalizeDeleteCompanyConfirmation(input: {
  companyId: string;
  confirmation?: {
    intent?: unknown;
  };
}): void {
  const intent = typeof input.confirmation?.intent === "string"
    ? input.confirmation.intent.trim()
    : "";
  if (intent !== "DELETE") {
    throw new Error("Delete Company requires confirmation.intent='DELETE'.");
  }
}

function resolveCompanyAssetRoot(input: {
  repoRoot: string;
  companyId: string;
}): string {
  const companiesRoot = path.resolve(input.repoRoot, "companies");
  const assetRoot = path.resolve(companyHomePath(input));
  const relative = path.relative(companiesRoot, assetRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to delete Company assets outside the company asset root.");
  }
  return assetRoot;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function companyFromRow(row: CompanyRow): CompanyRecord {
  return {
    companyId: row.company_id,
    displayName: row.display_name,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export class CompaniesAdminRepository {
  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
  ) {}

  static async open(
    repoRoot: string,
    options: CompanyPostgresOpenOptions = {},
  ): Promise<CompaniesAdminRepository> {
    const postgres = await openConfiguredPostgresConnection(repoRoot, options);
    if (!postgres) {
      throw new Error("Company setup requires PostgreSQL runtime configuration.");
    }
    return new CompaniesAdminRepository(postgres.client, postgres.pool);
  }

  close(): void {
    this.client.release();
    void endCompanyPostgresPool(this.pool);
  }

  async listCompanies(): Promise<CompanyRecord[]> {
    const rows = await this.client.query<CompanyRow>(
      `SELECT company_id, display_name, created_at, updated_at
FROM companies
ORDER BY display_name ASC, company_id ASC`,
    );
    return rows.rows.map(companyFromRow);
  }

  async listSystemAiSettings(companyIds: string[]): Promise<CompanySystemAiSetting[]> {
    if (companyIds.length === 0) {
      return [];
    }
    const rows = await this.client.query<SystemAiProviderConfigRow>(
      `SELECT company_id, capability, enabled, model_ref
FROM system_ai_provider_configs
WHERE company_id = ANY($1::text[])
  AND capability = ANY($2::text[])
ORDER BY company_id ASC, capability ASC`,
      [companyIds, SYSTEM_AI_CAPABILITIES.map((item) => item.capability)],
    );
    const byKey = new Map(rows.rows.map((row) => [`${row.company_id}\0${row.capability}`, row]));
    return companyIds.flatMap((companyId) => SYSTEM_AI_CAPABILITIES.map(({ capability, label }) => {
      const row = byKey.get(`${companyId}\0${capability}`);
      const modelRef = row?.model_ref?.trim() || undefined;
      const parsed = parseModelRef(modelRef);
      const configured = Boolean(row?.enabled && modelRef && parsed.modelProvider && parsed.modelId);
      return {
        companyId,
        capability,
        label,
        enabled: Boolean(row?.enabled && configured),
        configured,
        ...(parsed.modelProvider ? { modelProvider: parsed.modelProvider } : {}),
        ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
        ...(modelRef && configured ? { modelRef } : {}),
        ...(parsed.modelDisplay && configured ? { modelDisplay: parsed.modelDisplay } : {}),
      };
    }));
  }

}

export async function loadCompaniesAdminViewModel(input: {
  repoRoot: string;
}): Promise<CompaniesAdminViewModel> {
  const [repository, modelState] = await Promise.all([
    CompaniesAdminRepository.open(input.repoRoot),
    loadPiModelState(),
  ]);
  try {
    const companies = await repository.listCompanies();
    return {
      contract: {
        name: "company-lifecycle",
        version: 1,
        boundary: "company-lifecycle",
      },
      routes: {
        htmlPath: "/company",
        companiesJsonPath: "/api/companies",
        createCompanyPath: "/api/companies",
        deleteCompanyPath: "/api/companies/:companyId",
      },
      companies,
      availableModels: modelState.availableModels,
      systemAiSettings: await repository.listSystemAiSettings(companies.map((company) => company.companyId)),
    };
  } finally {
    repository.close();
  }
}

export async function saveCompanySystemAiSettings(input: SaveCompanySystemAiSettingsInput): Promise<CompaniesAdminViewModel> {
  const companyId = normalizeCompanyId(input.companyId);
  const postgres = await openConfiguredPostgresConnection(input.repoRoot);
  if (!postgres) {
    throw new Error("System AI settings require PostgreSQL runtime configuration.");
  }
  const service = new SystemAiProviderConfigService({
    repository: new PostgresSystemAiProviderConfigRepository(postgres.client),
  });
  try {
    const title = normalizeSystemAiModelInput(input.settings?.chatTitleGeneration);
    const summary = normalizeSystemAiModelInput(input.settings?.chatTopicSummary);
    await service.saveProviderConfig({
      companyId,
      capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
      providerKind: "pi_model",
      enabled: title.enabled,
      modelRef: title.modelRef,
    });
    await service.saveProviderConfig({
      companyId,
      capability: SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
      providerKind: "pi_model",
      enabled: summary.enabled,
      modelRef: summary.modelRef,
    });
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
  return loadCompaniesAdminViewModel({ repoRoot: input.repoRoot });
}

export async function deleteCompany(input: {
  repoRoot: string;
  companyId?: unknown;
  confirmation?: {
    companyId?: unknown;
    intent?: unknown;
  };
  runtime?: CompanyRuntimeDeletionGuard;
}): Promise<DeleteCompanyResult> {
  const companyId = normalizeCompanyId(input.companyId);
  normalizeDeleteCompanyConfirmation({ companyId, confirmation: input.confirmation });
  await input.runtime?.ensureSafeToDeleteCompany(companyId);

  const assetRoot = resolveCompanyAssetRoot({
    repoRoot: input.repoRoot,
    companyId,
  });
  const postgres = await openConfiguredPostgresConnection(input.repoRoot);
  if (!postgres) {
    throw new Error("Delete Company requires PostgreSQL runtime configuration.");
  }

  try {
    await postgres.client.query("BEGIN");
    const deleted = await postgres.client.query(
      `DELETE FROM companies WHERE company_id = $1 RETURNING company_id`,
      [companyId],
    );
    if (deleted.rows.length !== 1) {
      await postgres.client.query("ROLLBACK");
      throw new Error(`Company ${companyId} was not found during delete.`);
    }
    await postgres.client.query("COMMIT");

    try {
      await rm(assetRoot, { recursive: true, force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Company ${companyId} was deleted from PostgreSQL, but asset cleanup failed: ${message}`);
    }

    return {
      companyId,
      deletedAssetPath: assetRoot,
      viewModel: await loadCompaniesAdminViewModel({ repoRoot: input.repoRoot }),
    };
  } catch (error) {
    await postgres.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

export async function createCompany(input: {
  repoRoot: string;
  companyId?: unknown;
  displayName?: unknown;
  ownerMemberId?: unknown;
  ownerDisplayName?: unknown;
  hrEmployeeDisplayName?: unknown;
  hrRuntime?: unknown;
  systemAiRuntime?: unknown;
}): Promise<CompaniesAdminViewModel> {
  return (await createCompanyWithoutCarrier(input)).viewModel;
}

export async function createCompanyWithoutCarrier(input: {
  repoRoot: string;
  companyId?: unknown;
  displayName?: unknown;
  ownerMemberId?: unknown;
  ownerDisplayName?: unknown;
  hrEmployeeDisplayName?: unknown;
  hrRuntime?: unknown;
  systemAiRuntime?: unknown;
}): Promise<OwnedCreateCompanyResult> {
  const companyId = normalizeCreateCompanyId(input);
  const displayName = normalizeDisplayName(input.displayName, companyId);
  const ownerMemberId = normalizeOwnerMemberId(input.ownerMemberId);
  const ownerDisplayName = normalizeOptionalString(input.ownerDisplayName) || ownerMemberId;
  const hrRuntime = normalizeHrRuntime(input.hrRuntime);
  const systemAiRuntime = normalizeSystemAiRuntime(input.systemAiRuntime);
  const hr = await instantiateDefaultCompanyBlueprint({
    repoRoot: input.repoRoot,
    companyId,
    displayName,
    hrEmployeeDisplayName: input.hrEmployeeDisplayName,
    ownerMemberId,
    ownerDisplayName,
    hrRuntime,
    systemAiRuntime,
    conflictMode: "create",
  });
  const viewModel = await loadCompaniesAdminViewModel({ repoRoot: input.repoRoot });
  const company = viewModel.companies.find((candidate) => candidate.companyId === hr.companyId);
  if (!company) {
    throw new Error("Created Company was not returned by the lifecycle view model.");
  }
  return {
    company,
    hr,
    ...(ownerMemberId && ownerDisplayName ? {
      owner: {
        memberId: ownerMemberId,
        displayName: ownerDisplayName,
        role: "boss",
      },
    } : {}),
    viewModel,
  };
}
