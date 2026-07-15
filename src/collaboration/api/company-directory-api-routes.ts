import type { IncomingMessage, ServerResponse } from "node:http";

import type { PresenceMode } from "../runtime/presence-mode.js";
import {
  assertNoForbiddenPublicCarrierFields,
  ensureConversationCompanyScope,
} from "../contracts/conversation-message-contract.js";
import {
  CompanyDirectoryRepository,
  type CompanyDirectoryEmployeeRecord,
} from "../../runtime/company-config/company-directory-repository.js";
import { loadCompanyMemberDirectory, type CompanyMemberProfile } from "../../runtime/members/company-member-directory.js";
import {
  loadPiModelState,
  runtimeModelSupportsImageInput,
  type AvailablePiModel,
  type EmployeeRuntimeConfig,
} from "../../runtime/company-config/employees-admin.js";
import type { CompanyPostgresOpenOptions } from "../../runtime/company-config/postgres-runtime-connection.js";

export const COMPANY_DIRECTORY_SCHEMA = "company-directory" as const;
export const COMPANY_DIRECTORY_MEMBER_ENTRY_SCHEMA = "company-directory-member-entry" as const;
export const COMPANY_DIRECTORY_CONTRACT_VERSION = 1 as const;

export type CompanyDirectoryMemberSelectorDto =
  | { kind: "member"; memberId: string };

export interface CompanyDirectoryRuntimeCapabilityDto {
  presenceMode: PresenceMode;
  model: {
    provider?: string;
    id?: string;
    thinkingLevel: EmployeeRuntimeConfig["thinkingLevel"];
    input?: string[];
    supportsImageInput?: boolean;
  };
}

export interface CompanyDirectoryMemberEntryDto {
  schema: typeof COMPANY_DIRECTORY_MEMBER_ENTRY_SCHEMA;
  version: typeof COMPANY_DIRECTORY_CONTRACT_VERSION;
  companyId: string;
  memberId: string;
  avatarSeed: string;
  selector: CompanyDirectoryMemberSelectorDto;
  employeeId?: string;
  displayName: string;
  role?: string;
  summary?: string;
  hasRuntimeProfile: boolean;
  runtimeCapability?: CompanyDirectoryRuntimeCapabilityDto;
}

export interface CompanyDirectoryDto {
  schema: typeof COMPANY_DIRECTORY_SCHEMA;
  version: typeof COMPANY_DIRECTORY_CONTRACT_VERSION;
  companyId: string;
  directoryMembers: CompanyDirectoryMemberEntryDto[];
}

export interface CompanyDirectoryApiSource {
  loadCompanyDirectory(companyId: string): Promise<CompanyDirectoryDto>;
}

export interface CompanyDirectoryApiRouteOptions {
  directorySource: CompanyDirectoryApiSource | ((companyId: string) => Promise<CompanyDirectoryDto>);
}

export interface PostgresCompanyDirectoryApiSourceOptions extends CompanyPostgresOpenOptions {
  repoRoot: string;
}

interface RouteMatch {
  companyId: string;
}

function routeMatch(pathname: string): RouteMatch | undefined {
  const parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts.length === 4 && parts[0] === "api" && parts[1] === "companies" && parts[3] === "directory") {
    return { companyId: parts[2] ?? "" };
  }
  return undefined;
}

function writeJson(res: ServerResponse, statusCode: number, value: unknown): void {
  assertNoForbiddenPublicCarrierFields(value);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function writeError(res: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (/explicit companyId is required|companyId is missing|requires PostgreSQL runtime configuration/.test(message)) {
    writeJson(res, 400, { error: message });
    return;
  }
  writeJson(res, 500, { error: message });
}

async function resolveDirectory(
  options: CompanyDirectoryApiRouteOptions,
  companyId: string,
): Promise<CompanyDirectoryDto> {
  const directory = typeof options.directorySource === "function"
    ? await options.directorySource(companyId)
    : await options.directorySource.loadCompanyDirectory(companyId);
  if (!Array.isArray(directory.directoryMembers)) {
    throw new Error("directoryMembers is required for company directory product API");
  }
  return {
    schema: COMPANY_DIRECTORY_SCHEMA,
    version: COMPANY_DIRECTORY_CONTRACT_VERSION,
    companyId,
    directoryMembers: directory.directoryMembers,
  };
}

function runtimeCapabilityDto(
  employee: CompanyDirectoryEmployeeRecord,
  availableModels: readonly AvailablePiModel[] = [],
): CompanyDirectoryRuntimeCapabilityDto {
  const model = availableModels.find((candidate) =>
    candidate.provider === employee.runtime.modelProvider && candidate.id === employee.runtime.modelId
  );
  return {
    presenceMode: employee.profile.presenceMode,
    model: {
      ...(employee.runtime.modelProvider ? { provider: employee.runtime.modelProvider } : {}),
      ...(employee.runtime.modelId ? { id: employee.runtime.modelId } : {}),
      thinkingLevel: employee.runtime.thinkingLevel,
      input: model?.input ?? [],
      supportsImageInput: runtimeModelSupportsImageInput({
        runtime: employee.runtime,
        availableModels,
      }),
    },
  };
}

function memberEntryFromMember(
  companyId: string,
  member: CompanyMemberProfile,
  employeeById: ReadonlyMap<string, CompanyDirectoryEmployeeRecord>,
  availableModels: readonly AvailablePiModel[] = [],
): CompanyDirectoryMemberEntryDto {
  const employee = employeeById.get(member.id);
  const hasRuntimeProfile = Boolean(employee);
  return {
    schema: COMPANY_DIRECTORY_MEMBER_ENTRY_SCHEMA,
    version: COMPANY_DIRECTORY_CONTRACT_VERSION,
    companyId,
    memberId: member.id,
    avatarSeed: member.avatarSeed,
    selector: { kind: "member", memberId: member.id },
    displayName: member.displayName,
    role: member.role,
    ...(member.summary ? { summary: member.summary } : {}),
    hasRuntimeProfile,
    ...(employee ? { runtimeCapability: runtimeCapabilityDto(employee, availableModels) } : {}),
  };
}

export function projectCompanyDirectoryMembers(
  companyId: string,
  members: readonly CompanyMemberProfile[],
  employees: readonly CompanyDirectoryEmployeeRecord[],
  options: { availableModels?: readonly AvailablePiModel[] } = {},
): CompanyDirectoryMemberEntryDto[] {
  const employeeById = new Map(employees.map((employee) => [employee.employeeId, employee]));
  const inactiveRuntimeMemberIds = new Set(
    employees.filter((employee) => employee.enabled === false).map((employee) => employee.employeeId),
  );
  return members
    .filter((member) => !inactiveRuntimeMemberIds.has(member.id))
    .map((member) => memberEntryFromMember(
      companyId,
      member,
      employeeById,
      options.availableModels ?? [],
    ));
}

export async function loadCompanyDirectoryApiSnapshot(
  repoRoot: string,
  options: CompanyPostgresOpenOptions & { companyId: string },
): Promise<CompanyDirectoryDto> {
  const companyId = ensureConversationCompanyScope({ companyId: options.companyId });
  const employeeRepository = await CompanyDirectoryRepository.open(repoRoot, options);
  try {
    const [members, employees, modelState] = await Promise.all([
      loadCompanyMemberDirectory(repoRoot, options),
      employeeRepository.loadEmployees(),
      loadPiModelState(),
    ]);
    return {
      schema: COMPANY_DIRECTORY_SCHEMA,
      version: COMPANY_DIRECTORY_CONTRACT_VERSION,
      companyId,
      directoryMembers: projectCompanyDirectoryMembers(companyId, members.members, employees, {
        availableModels: modelState.availableModels,
      }),
    };
  } finally {
    employeeRepository.close();
  }
}

export function createPostgresCompanyDirectoryApiSource(
  options: PostgresCompanyDirectoryApiSourceOptions,
): CompanyDirectoryApiSource {
  return {
    loadCompanyDirectory(companyId: string) {
      return loadCompanyDirectoryApiSnapshot(options.repoRoot, { ...options, companyId });
    },
  };
}

export async function handleCompanyDirectoryApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: CompanyDirectoryApiRouteOptions,
): Promise<boolean> {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  const match = routeMatch(requestUrl.pathname);
  if (!match) {
    return false;
  }

  try {
    const companyId = ensureConversationCompanyScope({ companyId: match.companyId });
    if (req.method === "GET") {
      writeJson(res, 200, await resolveDirectory(options, companyId));
      return true;
    }
    return false;
  } catch (error) {
    if (!res.headersSent) {
      writeError(res, error);
    }
    return true;
  }
}
