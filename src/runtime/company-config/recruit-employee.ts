import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PresenceMode } from "../../collaboration/runtime/presence-mode.js";
import type {
  EmployeeAdminRecord,
  EmployeeRuntimeConfig,
} from "./employees-admin.js";
import {
  loadEmployeesAdminState,
  saveEmployeeAdminRecord,
} from "./employees-admin.js";
import { companyEmployeeHomePath, normalizeCompanyId } from "./company-paths.js";
import {
  normalizeResourcePolicy,
  type EmployeeResourcePolicy,
} from "./resource-policy.js";
import {
  loadCompanyMemberDirectory,
  saveCompanyMemberProfile,
} from "../members/company-member-directory.js";

export interface RecruitEmployeeInput {
  repoRoot: string;
  companyId: string;
  employeeId?: string;
  displayName: string;
  role: string;
  summary: string;
  presenceMode?: PresenceMode;
  runtime: EmployeeRuntimeConfig;
  resourcePolicy?: EmployeeResourcePolicy;
  instructionContent?: string;
}

export interface RecruitEmployeeResult {
  schema: "tinyoffice-recruit-employee-result";
  version: 1;
  companyId: string;
  employee: EmployeeAdminRecord;
  localAssets: {
    homePath: string;
    workspacePath: string;
    instructionPath: string;
    skillsPath: string;
  };
}

export const DEFAULT_RECRUITED_EMPLOYEE_RESOURCE_POLICY: EmployeeResourcePolicy = {
  version: 1,
  filesystem: {
    ownWorkspace: "allow",
    otherEmployeeWorkspace: "approval",
    repo: "approval",
    secrets: "deny",
  },
};

function requiredString(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function slugifyEmployeeId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "employee";
}

async function resolveRecruitEmployeeId(input: {
  repoRoot: string;
  companyId: string;
  requestedEmployeeId?: string;
  displayName: string;
}): Promise<string> {
  const requestedEmployeeId = input.requestedEmployeeId?.trim();
  if (requestedEmployeeId) {
    return requestedEmployeeId;
  }

  const baseEmployeeId = slugifyEmployeeId(input.displayName);
  const directory = await loadCompanyMemberDirectory(input.repoRoot, {
    companyId: input.companyId,
  });
  const existingIds = new Set(directory.members.map((member) => member.id.toLowerCase()));
  if (!existingIds.has(baseEmployeeId.toLowerCase())) {
    return baseEmployeeId;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${baseEmployeeId}-${suffix}`;
    if (!existingIds.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  throw new Error(`Unable to derive a unique employeeId from ${input.displayName}.`);
}

function employeeInstructionContent(): string {
  return [
    "# Personal Operating Guidance",
    "",
    "Use this file for employee-specific detailed responsibilities, working style, and long-term guidance.",
    "",
    "Keep structured identity fields such as display name, role, and short responsibility summary in Company member configuration.",
    "Work inside your company-scoped workspace by default.",
    "Use shared Company Prompt Policy and Access policy as your operating boundary.",
    "Ask for approval before touching another employee workspace or repository-wide files unless a tool policy explicitly allows it.",
    "",
  ].join("\n");
}

async function writeRecruitEmployeeAssets(input: {
  repoRoot: string;
  companyId: string;
  employeeId: string;
  displayName: string;
  role: string;
  summary: string;
  instructionContent?: string;
}): Promise<RecruitEmployeeResult["localAssets"]> {
  const homePath = companyEmployeeHomePath({
    repoRoot: input.repoRoot,
    companyId: input.companyId,
    employeeId: input.employeeId,
  });
  const workspacePath = path.join(homePath, "workspace");
  const skillsPath = path.join(homePath, "skills");
  const instructionPath = path.join(homePath, "AGENTS.md");
  await mkdir(workspacePath, { recursive: true });
  await mkdir(skillsPath, { recursive: true });
  await writeFile(
    instructionPath,
    input.instructionContent || employeeInstructionContent(),
    "utf8",
  );
  await writeFile(
    path.join(workspacePath, "README.md"),
    [
      `# ${input.displayName} Workspace`,
      "",
      `This workspace belongs to ${input.displayName}.`,
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    homePath,
    workspacePath,
    instructionPath,
    skillsPath,
  };
}

export async function recruitEmployee(input: RecruitEmployeeInput): Promise<RecruitEmployeeResult> {
  const companyId = normalizeCompanyId(input.companyId);
  const displayName = requiredString(input.displayName, "displayName");
  const employeeId = requiredString(await resolveRecruitEmployeeId({
    repoRoot: input.repoRoot,
    companyId,
    requestedEmployeeId: input.employeeId,
    displayName,
  }), "employeeId");
  const role = requiredString(input.role, "role");
  const summary = requiredString(input.summary, "summary");
  const presenceMode = input.presenceMode || "resident";
  const resourcePolicy = normalizeResourcePolicy(
    input.resourcePolicy || DEFAULT_RECRUITED_EMPLOYEE_RESOURCE_POLICY,
  );

  const localAssets = await writeRecruitEmployeeAssets({
    repoRoot: input.repoRoot,
    companyId,
    employeeId,
    displayName,
    role,
    summary,
    instructionContent: input.instructionContent,
  });

  await saveEmployeeAdminRecord({
    repoRoot: input.repoRoot,
    companyId,
    employeeId,
    profile: {
      employeeId,
      avatarSeed: employeeId,
      displayName,
      role,
      presenceMode,
    },
    resourcePolicy,
    runtime: input.runtime,
    instructionFiles: [{
      path: localAssets.instructionPath,
      content: input.instructionContent || employeeInstructionContent(),
    }],
  });
  await saveCompanyMemberProfile(input.repoRoot, {
    companyId,
    memberId: employeeId,
    role,
    summary,
    avatarSeed: employeeId,
  });

  const state = await loadEmployeesAdminState({
    repoRoot: input.repoRoot,
    companyId,
  });
  const employee = state.employees.find((candidate) => candidate.employeeId === employeeId);
  if (!employee) {
    throw new Error(`recruited employee ${employeeId} was not found after save`);
  }

  return {
    schema: "tinyoffice-recruit-employee-result",
    version: 1,
    companyId,
    employee,
    localAssets,
  };
}
