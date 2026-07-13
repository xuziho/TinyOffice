import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { loadEmployeesAdminState } from "../company-config/employees-admin.js";
import { companyEmployeeHomePath, companySkillsRootPath, normalizeCompanyId } from "../company-config/company-paths.js";
import { loadEmployeeHome } from "../registry/employee-home.js";
import { requestDeferredRuntimeReload } from "./deferred-runtime-reload.js";
import { validateSkillMarkdown } from "./skill-markdown.js";

export type SkillScope = { kind: "company" } | { kind: "employee"; memberId: string };

type SkillFile = { relativePath: string; content: string };

function normalizeSkillName(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/.test(value.trim())) {
    throw new Error("skillName must use lowercase letters, numbers, and hyphens and be at most 64 characters.");
  }
  return value.trim();
}

function normalizeScope(value: unknown): SkillScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("scope must be a JSON object.");
  const scope = value as Record<string, unknown>;
  if (scope.kind === "company") {
    if (scope.memberId !== undefined) throw new Error("Company Skill scope must not include memberId.");
    return { kind: "company" };
  }
  if (scope.kind === "employee") {
    if (typeof scope.memberId !== "string" || !scope.memberId.trim()) throw new Error("Employee Skill scope requires memberId.");
    return { kind: "employee", memberId: scope.memberId.trim() };
  }
  throw new Error("scope.kind must be company or employee; system Skill scope does not exist.");
}

function normalizeRelativePath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("files[].relativePath is required.");
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized === "SKILL.md") return normalized;
  if (!/^(references|scripts|assets)\/[a-zA-Z0-9._/-]+$/.test(normalized) || normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error(`Invalid Skill file path: ${value}`);
  }
  return normalized;
}

function normalizeFiles(value: unknown): SkillFile[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("files must be a non-empty array.");
  const files = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Each files item must be an object.");
    const record = item as Record<string, unknown>;
    if (typeof record.content !== "string") throw new Error("files[].content must be a string.");
    return { relativePath: normalizeRelativePath(record.relativePath), content: record.content.endsWith("\n") ? record.content : `${record.content}\n` };
  });
  if (!files.some((file) => file.relativePath === "SKILL.md")) throw new Error("files must include SKILL.md.");
  if (new Set(files.map((file) => file.relativePath)).size !== files.length) throw new Error("files contains duplicate relativePath values.");
  return files;
}

async function exists(targetPath: string): Promise<boolean> {
  return stat(targetPath).then(() => true).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? false : Promise.reject(error));
}

async function skillRoot(input: { repoRoot: string; companyId: string; scope: SkillScope }): Promise<string> {
  if (input.scope.kind === "company") return companySkillsRootPath(input);
  await loadEmployeeHome({ repoRoot: input.repoRoot, companyId: input.companyId, employeeId: input.scope.memberId });
  return path.join(companyEmployeeHomePath({ repoRoot: input.repoRoot, companyId: input.companyId, employeeId: input.scope.memberId }), "skills");
}

async function affectedMembers(input: { repoRoot: string; companyId: string; scope: SkillScope }): Promise<string[]> {
  if (input.scope.kind === "employee") return [input.scope.memberId];
  const state = await loadEmployeesAdminState({ repoRoot: input.repoRoot, companyId: input.companyId });
  return state.employees.filter((employee) => employee.enabled).map((employee) => employee.employeeId).sort();
}

async function assertNoVisibleScopeCollision(input: { repoRoot: string; companyId: string; scope: SkillScope; skillName: string }): Promise<void> {
  const companyRoot = companySkillsRootPath(input);
  if (input.scope.kind === "employee") {
    if (await exists(path.join(companyRoot, input.skillName, "SKILL.md"))) {
      throw new Error(`Employee Skill conflicts with an existing Company Skill: ${input.skillName}`);
    }
    return;
  }
  const state = await loadEmployeesAdminState({ repoRoot: input.repoRoot, companyId: input.companyId });
  for (const employee of state.employees) {
    const employeeSkill = path.join(companyEmployeeHomePath({ repoRoot: input.repoRoot, companyId: input.companyId, employeeId: employee.employeeId }), "skills", input.skillName, "SKILL.md");
    if (await exists(employeeSkill)) {
      throw new Error(`Company Skill conflicts with Employee Skill ${employee.employeeId}: ${input.skillName}`);
    }
  }
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error));
  const result: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}

async function listScopeSkills(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error));
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = normalizeSkillName(entry.name);
    const skillPath = path.join(root, name, "SKILL.md");
    if (!(await exists(skillPath))) continue;
    const content = await readFile(skillPath, "utf8");
    skills.push({ name, description: content.match(/^description:\s*([^\r\n]+)$/m)?.[1]?.trim() || "", files: await listFiles(path.join(root, name)) });
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listSkillsForCapability(input: { repoRoot: string; companyId: string; scope: unknown }) {
  const companyId = normalizeCompanyId(input.companyId);
  const scope = normalizeScope(input.scope);
  const root = await skillRoot({ ...input, companyId, scope });
  return { schema: "tinyoffice-skill-list", version: 1, companyId, scope, skills: await listScopeSkills(root) };
}

export async function describeSkillForCapability(input: { repoRoot: string; companyId: string; scope: unknown; skillName: unknown }) {
  const companyId = normalizeCompanyId(input.companyId);
  const scope = normalizeScope(input.scope);
  const skillName = normalizeSkillName(input.skillName);
  const directory = path.join(await skillRoot({ ...input, companyId, scope }), skillName);
  if (!(await exists(path.join(directory, "SKILL.md")))) throw new Error(`Skill not found in requested scope: ${skillName}`);
  const relativePaths = await listFiles(directory);
  const files = await Promise.all(relativePaths.map(async (relativePath) => ({ relativePath, content: await readFile(path.join(directory, ...relativePath.split("/")), "utf8") })));
  return { schema: "tinyoffice-skill-detail", version: 1, companyId, scope, skillName, files };
}

export async function mutateSkillForCapability(input: { repoRoot: string; companyId: string; reloadKey: string; scope: unknown; skillName: unknown; files: unknown; mode: "create" | "update"; scheduleReload?: boolean }) {
  const companyId = normalizeCompanyId(input.companyId);
  const scope = normalizeScope(input.scope);
  const skillName = normalizeSkillName(input.skillName);
  const files = normalizeFiles(input.files);
  validateSkillMarkdown(skillName, files.find((file) => file.relativePath === "SKILL.md")!.content);
  const root = await skillRoot({ ...input, companyId, scope });
  const directory = path.join(root, skillName);
  const alreadyExists = await exists(path.join(directory, "SKILL.md"));
  if (input.mode === "create" && alreadyExists) throw new Error(`Skill already exists in requested scope: ${skillName}`);
  if (input.mode === "update" && !alreadyExists) throw new Error(`Skill update requires an existing Skill in requested scope: ${skillName}`);
  if (input.mode === "create") await assertNoVisibleScopeCollision({ repoRoot: input.repoRoot, companyId, scope, skillName });
  await mkdir(directory, { recursive: true });
  for (const file of files) {
    const target = path.join(directory, ...file.relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tinyoffice-${randomUUID()}.tmp`;
    await writeFile(temporary, file.content, "utf8");
    await rename(temporary, target);
  }
  const memberIds = await affectedMembers({ repoRoot: input.repoRoot, companyId, scope });
  if (input.scheduleReload !== false) requestDeferredRuntimeReload(companyId, input.reloadKey, memberIds);
  return {
    schema: "tinyoffice-skill-mutation",
    version: 1,
    companyId,
    scope,
    skillName,
    operation: input.mode === "create" ? "created" : "updated",
    files: await listFiles(directory),
    validation: "passed",
    affectedMemberIds: memberIds,
    reload: input.scheduleReload === false ? { status: "handled_by_caller", effective: "caller_defined" } : { status: "scheduled_after_current_turn", effective: "next_employee_execution" },
  };
}
