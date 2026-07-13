import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PresenceMode } from "../../collaboration/runtime/presence-mode.js";
import type {
  EmployeeHomeProfile,
} from "../registry/employee-home.js";
import {
  CompanyDirectoryRepository,
  type CompanyDirectoryEmployeeRecord,
} from "./company-directory-repository.js";
import {
  companyEmployeeHomePath,
  companyEmployeesRootPath,
  normalizeCompanyId,
} from "./company-paths.js";
import {
  DEFAULT_RESOURCE_POLICY,
  normalizeResourcePolicy,
  type EmployeeResourcePolicy,
} from "./resource-policy.js";
import {
  AuthStorage,
  getAgentDir,
  ModelRegistry,
} from "../pi/pi-coding-agent-sdk.js";
import { validateSkillMarkdown } from "../capabilities/skill-markdown.js";

export type EmployeeThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AvailablePiModel {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  supportsImageInput: boolean;
}

export interface EmployeeRuntimeConfig {
  version: 1;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel: EmployeeThinkingLevel;
}

export type EmployeeInstructionLocation = "employee_home";

export interface EmployeeInstructionFile {
  location: EmployeeInstructionLocation;
  name: string;
  path: string;
  relativePath: string;
  exists: boolean;
  content: string;
  editable: boolean;
}

export interface EmployeeLocalAssets {
  homePath: string;
  workspacePath: string;
  skillPaths: string[];
  instructionFiles: EmployeeInstructionFile[];
}

export interface EmployeePrivateSkillListItem {
  skillId: string;
  name: string;
  path: string;
  relativePath: string;
  exists: boolean;
}

export interface EmployeePrivateSkillsState {
  schema: "employee-private-skills";
  version: 1;
  companyId: string;
  memberId: string;
  skillsRootPath: string;
  skills: EmployeePrivateSkillListItem[];
}

export interface EmployeePrivateSkillFile extends EmployeePrivateSkillListItem {
  schema: "employee-private-skill";
  version: 1;
  companyId: string;
  memberId: string;
  content: string;
  editable: boolean;
}

export interface SaveEmployeePrivateSkillInput {
  repoRoot: string;
  companyId: string;
  memberId: string;
  skillId: string;
  content: string;
}

export interface EmployeeAdminRecord {
  employeeId: string;
  enabled?: boolean;
  profile: EmployeeHomeProfile;
  resourcePolicy: EmployeeResourcePolicy;
  runtime: EmployeeRuntimeConfig;
  localAssets?: EmployeeLocalAssets;
}

export interface EmployeesAdminState {
  employees: EmployeeAdminRecord[];
  availableModels: AvailablePiModel[];
  presenceModes: PresenceMode[];
  thinkingLevels: EmployeeThinkingLevel[];
}

export interface CompanyEmployeeScope {
  repoRoot: string;
  companyId: string;
}

const PRESENCE_MODES: PresenceMode[] = ["resident", "auto_exit_idle"];
export const EMPLOYEE_THINKING_LEVELS: EmployeeThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const EMPLOYEE_INSTRUCTIONS_FILE_NAME = "AGENTS.md";
const DEFAULT_RUNTIME_CONFIG: EmployeeRuntimeConfig = {
  version: 1,
  thinkingLevel: "minimal",
};
const PI_MODEL_SETUP_GUIDANCE = "No PI models are available. Configure PI using the normal PI setup flow, then refresh Employee Config to load models from the local PI configuration.";
const CONFIGURE_RUNTIME_MODEL_FIRST_MESSAGE = "configure-runtime-model-first: Select and save a runtime model in Employee Config before starting or reloading this employee.";

export async function loadEmployeesAdminState(scope: CompanyEmployeeScope): Promise<EmployeesAdminState> {
  const companyId = normalizeCompanyId(scope.companyId);
  const employeesRootPath = companyEmployeesRootPath({ repoRoot: scope.repoRoot, companyId });
  const [modelState, repository] = await Promise.all([
    loadPiModelState(),
    CompanyDirectoryRepository.open(scope.repoRoot, { companyId }),
  ]);
  let employeeRecords: CompanyDirectoryEmployeeRecord[];
  try {
    employeeRecords = await repository.loadEmployees();
  } finally {
    repository.close();
  }
  const employees = await Promise.all(
    employeeRecords.map((record) => employeeAdminRecordFromDirectoryRecord(record, {
      repoRoot: scope.repoRoot,
      companyId,
      employeesRootPath,
    })),
  );

  return {
    employees: employees.sort((left, right) => left.employeeId.localeCompare(right.employeeId)),
    availableModels: modelState.availableModels,
    presenceModes: PRESENCE_MODES,
    thinkingLevels: EMPLOYEE_THINKING_LEVELS,
  };
}

export async function loadPiModelState(): Promise<{
  availableModels: AvailablePiModel[];
}> {
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, path.join(agentDir, "models.json"));
  const availableModels = modelRegistry.getAvailable().map((model: {
    provider: string;
    id: string;
    name?: string;
    reasoning?: boolean;
    input?: string[];
  }) => ({
    provider: model.provider,
    id: model.id,
    name: model.name || model.id,
    reasoning: Boolean(model.reasoning),
    input: Array.isArray(model.input) ? model.input.filter((item) => typeof item === "string") : [],
    supportsImageInput: Array.isArray(model.input) && model.input.includes("image"),
  })).sort((left: AvailablePiModel, right: AvailablePiModel) =>
    `${left.provider}/${left.id}`.localeCompare(`${right.provider}/${right.id}`)
  );

  return {
    availableModels,
  };
}

export function runtimeModelSupportsImageInput(input: {
  runtime?: Pick<EmployeeRuntimeConfig, "modelProvider" | "modelId">;
  availableModels: readonly AvailablePiModel[];
}): boolean {
  const provider = input.runtime?.modelProvider?.trim();
  const id = input.runtime?.modelId?.trim();
  if (!provider || !id) {
    return false;
  }
  return input.availableModels.some((model) =>
    model.provider === provider && model.id === id && model.supportsImageInput
  );
}

export async function saveEmployeeAdminRecord(input: {
  repoRoot: string;
  companyId: string;
  employeeId: unknown;
  profile: unknown;
  resourcePolicy: unknown;
  runtime: unknown;
  instructionFiles?: unknown;
  availableModels?: readonly AvailablePiModel[];
}): Promise<EmployeesAdminState> {
  if (typeof input.employeeId !== "string" || !input.employeeId.trim()) {
    throw new Error("employeeId is required.");
  }
  const companyId = normalizeCompanyId(input.companyId);
  const employeeId = normalizeEmployeeId(input.employeeId);

  const profile = normalizeProfile(input.profile, employeeId);
  const resourcePolicy = normalizeResourcePolicy(input.resourcePolicy);
  const runtime = normalizeRuntime(input.runtime, { requireModel: true });
  if (input.availableModels && !input.availableModels.some((model) =>
    model.provider === runtime.modelProvider && model.id === runtime.modelId
  )) {
    throw new Error(
      `runtime model ${runtime.modelProvider}/${runtime.modelId} is not available in the local PI model registry.`,
    );
  }
  const employeeHomePath = companyEmployeeHomePath({
    repoRoot: input.repoRoot,
    companyId,
    employeeId,
  });
  const instructionFileUpdates = normalizeInstructionFileUpdates(
    input.instructionFiles,
    employeeHomePath,
  );

  const repository = await CompanyDirectoryRepository.open(input.repoRoot, { companyId });
  try {
    await repository.upsertEmployee({
      employeeId,
      profile,
      enabled: true,
      resourcePolicy,
      runtime,
    });
    await repository.save();
  } finally {
    repository.close();
  }
  await saveEmployeeInstructionFiles(instructionFileUpdates);

  return loadEmployeesAdminState({ repoRoot: input.repoRoot, companyId });
}

export async function setEmployeeRuntimeEnabled(input: {
  repoRoot: string;
  companyId: string;
  employeeId: string;
  enabled: boolean;
}): Promise<EmployeesAdminState> {
  const companyId = normalizeCompanyId(input.companyId);
  const employeeId = normalizeEmployeeId(input.employeeId);
  const repository = await CompanyDirectoryRepository.open(input.repoRoot, { companyId });
  try {
    await repository.setEmployeeEnabled(employeeId, input.enabled);
  } finally {
    repository.close();
  }
  return loadEmployeesAdminState({ repoRoot: input.repoRoot, companyId });
}

export async function loadEmployeeRuntimeConfig(input: {
  repoRoot: string;
  companyId: string;
  employeeId: string;
}): Promise<EmployeeRuntimeConfig> {
  const companyId = normalizeCompanyId(input.companyId);
  const repository = await CompanyDirectoryRepository.open(input.repoRoot, { companyId });
  try {
    return (await repository.getRuntimeConfig(input.employeeId)) || DEFAULT_RUNTIME_CONFIG;
  } finally {
    repository.close();
  }
}

export async function listEmployeePrivateSkills(input: {
  repoRoot: string;
  companyId: string;
  memberId: string;
}): Promise<EmployeePrivateSkillsState> {
  const scope = employeePrivateSkillScope(input);
  const skillDirectories = await readdir(scope.skillsRootPath, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    });
  const skills: EmployeePrivateSkillListItem[] = [];
  for (const entry of skillDirectories) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillId = normalizeEmployeePrivateSkillId(entry.name);
    const skillPath = employeePrivateSkillPath(scope.skillsRootPath, skillId);
    if (!(await pathIsFile(skillPath))) {
      continue;
    }
    skills.push(employeePrivateSkillListItem(scope.skillsRootPath, skillId, skillPath));
  }
  return {
    schema: "employee-private-skills",
    version: 1,
    companyId: scope.companyId,
    memberId: scope.memberId,
    skillsRootPath: scope.skillsRootPath,
    skills: skills.sort((left, right) => left.skillId.localeCompare(right.skillId)),
  };
}

export async function readEmployeePrivateSkill(input: {
  repoRoot: string;
  companyId: string;
  memberId: string;
  skillId: string;
}): Promise<EmployeePrivateSkillFile> {
  const scope = employeePrivateSkillScope(input);
  const skillId = normalizeEmployeePrivateSkillId(input.skillId);
  const skillPath = employeePrivateSkillPath(scope.skillsRootPath, skillId);
  const content = await readOptionalTextFile(skillPath);
  if (content === undefined) {
    const error = new Error(`Employee private skill not found: ${skillId}`) as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }
  return {
    schema: "employee-private-skill",
    version: 1,
    companyId: scope.companyId,
    memberId: scope.memberId,
    ...employeePrivateSkillListItem(scope.skillsRootPath, skillId, skillPath),
    content,
    editable: true,
  };
}

export async function saveEmployeePrivateSkill(input: SaveEmployeePrivateSkillInput): Promise<EmployeePrivateSkillFile> {
  if (typeof input.content !== "string") {
    throw new Error("content is required");
  }
  const scope = employeePrivateSkillScope(input);
  const skillId = normalizeEmployeePrivateSkillId(input.skillId);
  validateSkillMarkdown(skillId, input.content);
  const skillPath = employeePrivateSkillPath(scope.skillsRootPath, skillId);
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(skillPath, ensureTrailingNewline(input.content), "utf8");
  return readEmployeePrivateSkill({
    repoRoot: input.repoRoot,
    companyId: scope.companyId,
    memberId: scope.memberId,
    skillId,
  });
}

async function employeeAdminRecordFromDirectoryRecord(
  record: CompanyDirectoryEmployeeRecord,
  scope?: CompanyEmployeeScope & { employeesRootPath: string },
): Promise<EmployeeAdminRecord> {
  const employeeHomePath = scope
    ? companyEmployeeHomePath({
        repoRoot: scope.repoRoot,
        companyId: scope.companyId,
        employeeId: record.employeeId,
      })
    : undefined;
  return {
    employeeId: record.employeeId,
    enabled: record.enabled,
    profile: record.profile,
    resourcePolicy: record.resourcePolicy,
    runtime: record.runtime,
    localAssets: employeeHomePath && scope
      ? await loadEmployeeLocalAssets({
          repoRoot: scope.repoRoot,
          employeeHomePath,
        })
      : undefined,
  };
}

async function loadEmployeeLocalAssets(input: {
  repoRoot: string;
  employeeHomePath: string;
}): Promise<EmployeeLocalAssets> {
  const employeeHomePath = input.employeeHomePath;
  const workspacePath = path.join(employeeHomePath, "workspace");
  const instructionFiles = await loadEmployeeInstructionFiles(employeeHomePath);
  const skillPaths = await loadEmployeeSkillPaths({
    repoRoot: input.repoRoot,
    employeeHomePath,
  });
  return {
    homePath: employeeHomePath,
    workspacePath,
    skillPaths,
    instructionFiles,
  };
}

async function loadEmployeeInstructionFiles(
  employeeHomePath: string,
): Promise<EmployeeInstructionFile[]> {
  const filePath = path.join(employeeHomePath, EMPLOYEE_INSTRUCTIONS_FILE_NAME);
  const content = await readOptionalTextFile(filePath);
  return [{
    location: "employee_home",
    name: EMPLOYEE_INSTRUCTIONS_FILE_NAME,
    path: filePath,
    relativePath: EMPLOYEE_INSTRUCTIONS_FILE_NAME,
    exists: content !== undefined,
    content: content || "",
    editable: true,
  }];
}

async function loadEmployeeSkillPaths(input: {
  repoRoot: string;
  employeeHomePath: string;
}): Promise<string[]> {
  const companyHomePath = path.dirname(path.dirname(input.employeeHomePath));
  const candidatePaths = [
    path.join(companyHomePath, "skills"),
    path.join(input.employeeHomePath, "skills"),
  ];
  const existingPaths: string[] = [];
  for (const candidatePath of candidatePaths) {
    if (await pathIsDirectory(candidatePath)) {
      existingPaths.push(candidatePath);
    }
  }
  return existingPaths;
}

async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function pathIsDirectory(directoryPath: string): Promise<boolean> {
  return stat(directoryPath)
    .then((entry) => entry.isDirectory())
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    });
}

async function pathIsFile(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then((entry) => entry.isFile())
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    });
}

interface EmployeeInstructionFileUpdate {
  path: string;
  content: string;
}

function normalizeInstructionFileUpdates(
  value: unknown,
  employeeHomePath: string,
): EmployeeInstructionFileUpdate[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("instructionFiles must be an array.");
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("instructionFiles entries must be JSON objects.");
    }
    const candidate = entry as Partial<EmployeeInstructionFileUpdate>;
    if (typeof candidate.path !== "string" || !candidate.path.trim()) {
      throw new Error("instructionFiles.path is required.");
    }
    if (typeof candidate.content !== "string") {
      throw new Error("instructionFiles.content is required.");
    }
    const targetPath = classifyEditableInstructionPath(
      candidate.path,
      employeeHomePath,
    );
    return {
      path: targetPath,
      content: candidate.content,
    };
  });
}

function classifyEditableInstructionPath(
  filePath: string,
  employeeHomePath: string,
): string {
  const resolvedPath = path.resolve(filePath);
  const allowedPath = path.resolve(employeeHomePath, EMPLOYEE_INSTRUCTIONS_FILE_NAME);
  const normalizedResolved = process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
  const normalizedAllowed = process.platform === "win32" ? allowedPath.toLowerCase() : allowedPath;
  if (normalizedResolved === normalizedAllowed) {
    return resolvedPath;
  }
  throw new Error("instructionFiles.path must target the selected employee's company-scoped AGENTS.md file.");
}

async function saveEmployeeInstructionFiles(updates: EmployeeInstructionFileUpdate[]): Promise<void> {
  for (const update of updates) {
    await mkdir(path.dirname(update.path), { recursive: true });
    await writeFile(update.path, ensureTrailingNewline(update.content), "utf8");
  }
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function normalizeProfile(value: unknown, employeeId: string): EmployeeHomeProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("profile must be a JSON object.");
  }
  const candidate = value as Partial<EmployeeHomeProfile>;
  if (candidate.employeeId !== employeeId) {
    throw new Error("profile.employeeId must match the selected employee.");
  }
  if (typeof candidate.role !== "string" || !candidate.role.trim()) {
    throw new Error("profile.role is required.");
  }
  if (!PRESENCE_MODES.includes(candidate.presenceMode as PresenceMode)) {
    throw new Error("profile.presenceMode is invalid.");
  }
  const presenceMode = candidate.presenceMode as PresenceMode;
  return {
    employeeId,
    avatarSeed: requiredAvatarSeed(candidate.avatarSeed, employeeId),
    role: candidate.role.trim(),
    displayName: typeof candidate.displayName === "string" ? candidate.displayName.trim() : undefined,
    presenceMode,
    sceneProfile:
      typeof candidate.sceneProfile === "string" && candidate.sceneProfile.trim()
        ? candidate.sceneProfile.trim()
        : undefined,
  };
}

function requiredAvatarSeed(value: unknown, employeeId: string): string {
  const seed = typeof value === "string" ? value.trim() : "";
  if (seed.length > 160) {
    throw new Error(`profile.avatarSeed is required for ${employeeId} and must be at most 160 characters.`);
  }
  return seed || employeeId;
}


function normalizeRuntime(
  value: unknown,
  options: { requireModel?: boolean } = {},
): EmployeeRuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (options.requireModel) {
      throw new Error("runtime must be a JSON object with runtime.modelProvider and runtime.modelId.");
    }
    return DEFAULT_RUNTIME_CONFIG;
  }
  const candidate = value as Partial<EmployeeRuntimeConfig>;
  if (candidate.version !== undefined && candidate.version !== 1) {
    throw new Error("runtime.version must be 1.");
  }
  if (!EMPLOYEE_THINKING_LEVELS.includes(candidate.thinkingLevel as EmployeeThinkingLevel)) {
    throw new Error("runtime.thinkingLevel is invalid.");
  }
  const thinkingLevel = candidate.thinkingLevel as EmployeeThinkingLevel;
  const modelProvider =
    typeof candidate.modelProvider === "string" && candidate.modelProvider.trim()
      ? candidate.modelProvider.trim()
      : undefined;
  const modelId =
    typeof candidate.modelId === "string" && candidate.modelId.trim()
      ? candidate.modelId.trim()
      : undefined;
  if (options.requireModel && (!modelProvider || !modelId)) {
    throw new Error("runtime.modelProvider and runtime.modelId are required.");
  }
  return {
    version: 1,
    modelProvider,
    modelId,
    thinkingLevel,
  };
}

function normalizeEmployeeId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(normalized)) {
    throw new Error(`Invalid employeeId: ${value}`);
  }
  return normalized;
}

function normalizeEmployeePrivateSkillId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(normalized)) {
    const error = new Error(`Invalid employee private skill id: ${value}`) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function employeePrivateSkillScope(input: {
  repoRoot: string;
  companyId: string;
  memberId: string;
}): { companyId: string; memberId: string; employeeHomePath: string; skillsRootPath: string } {
  const companyId = normalizeCompanyId(input.companyId);
  const memberId = normalizeEmployeeId(input.memberId);
  const employeeHomePath = companyEmployeeHomePath({
    repoRoot: input.repoRoot,
    companyId,
    employeeId: memberId,
  });
  return {
    companyId,
    memberId,
    employeeHomePath,
    skillsRootPath: path.join(employeeHomePath, "skills"),
  };
}

function employeePrivateSkillPath(skillsRootPath: string, skillId: string): string {
  const skillPath = path.resolve(skillsRootPath, skillId, "SKILL.md");
  assertInside(skillsRootPath, skillPath, "employee private skill path must stay inside the selected employee skills directory.");
  return skillPath;
}

function employeePrivateSkillListItem(
  skillsRootPath: string,
  skillId: string,
  skillPath: string,
): EmployeePrivateSkillListItem {
  return {
    skillId,
    name: skillId,
    path: skillPath,
    relativePath: path.relative(skillsRootPath, skillPath).replaceAll(path.sep, "/"),
    exists: true,
  };
}

function assertInside(root: string, target: string, message: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(message);
  }
}
