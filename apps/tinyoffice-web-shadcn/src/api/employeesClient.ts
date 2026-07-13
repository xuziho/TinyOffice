import type {
  EmployeeAdminRecord,
  EmployeePrivateSkillFile,
  EmployeePrivateSkillSaveRequest,
  EmployeePrivateSkillsState,
  EmployeeRuntimeConfig,
  EmployeesAdminState,
  MemberRuntimeReloadResult,
} from "tinyoffice/frontend-api-contracts";
import {
  companyEmployeesPath,
  companyMemberRuntimePath,
  employeePrivateSkillPath,
  employeePrivateSkillsPath,
  memberRuntimeMemberPath,
} from "./tinyofficePaths";
import { requestJson, required, TinyOfficeApiError } from "./tinyofficeRequest";

export type CreateEmployeeInput = {
  companyId?: string;
  employeeId?: string;
  displayName?: string;
  role?: string;
  summary?: string;
  runtime?: EmployeeRuntimeConfig;
  instructionContent?: string;
};

export type SaveEmployeeInput = {
  companyId?: string;
  employee: EmployeeAdminRecord;
};

export async function getEmployees(input: { companyId?: string }): Promise<EmployeesAdminState> {
  const companyId = required(input.companyId, "companyId");
  return requestJson<EmployeesAdminState>(companyMemberRuntimePath(companyId));
}

export async function saveEmployee(input: SaveEmployeeInput): Promise<EmployeesAdminState> {
  const companyId = required(input.companyId, "companyId");
  const memberId = required(input.employee.employeeId, "employeeId");
  return requestJson<EmployeesAdminState>(memberRuntimeMemberPath(companyId, memberId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      memberId,
      profile: input.employee.profile,
      resourcePolicy: input.employee.resourcePolicy,
      runtime: input.employee.runtime,
      instructionFiles: editableInstructionFiles(input.employee),
    }),
  });
}

export async function setEmployeeEnabled(input: { companyId?: string; memberId?: string; enabled: boolean }): Promise<EmployeesAdminState> {
  const companyId = required(input.companyId, "companyId");
  const memberId = required(input.memberId, "memberId");
  return requestJson<EmployeesAdminState>(`${memberRuntimeMemberPath(companyId, memberId)}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: input.enabled }),
  });
}

export async function createEmployee(input: CreateEmployeeInput): Promise<unknown> {
  const companyId = required(input.companyId, "companyId");
  return requestJson<unknown>(companyEmployeesPath(companyId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...(input.employeeId?.trim() ? { employeeId: input.employeeId.trim() } : {}),
      displayName: required(input.displayName, "displayName"),
      role: required(input.role, "role"),
      ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
      ...(input.runtime ? { runtime: input.runtime } : {}),
      ...(input.instructionContent !== undefined ? { instructionContent: input.instructionContent } : {}),
    }),
  });
}

export async function reloadEmployee(input: { companyId?: string; memberId?: string }): Promise<MemberRuntimeReloadResult> {
  const companyId = required(input.companyId, "companyId");
  const memberId = required(input.memberId, "memberId");
  return requestJson<MemberRuntimeReloadResult>(`${memberRuntimeMemberPath(companyId, memberId)}/reload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ companyId, memberId }),
  });
}

export async function reloadEmployeeRuntimeIfAvailable(input: { companyId?: string; memberId?: string }): Promise<void> {
  try {
    await reloadEmployee(input);
  } catch (error) {
    if (error instanceof TinyOfficeApiError && /member runtime reload is not configured/i.test(error.message)) {
      return;
    }
    throw error;
  }
}

export async function reloadAllEmployees(input: { companyId?: string }): Promise<MemberRuntimeReloadResult> {
  const companyId = required(input.companyId, "companyId");
  return requestJson<MemberRuntimeReloadResult>(`${companyMemberRuntimePath(companyId)}/reload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ companyId }),
  });
}

export async function getEmployeePrivateSkills(input: {
  companyId?: string;
  memberId?: string;
}): Promise<EmployeePrivateSkillsState> {
  const companyId = required(input.companyId, "companyId");
  const memberId = required(input.memberId, "memberId");
  return requestJson<EmployeePrivateSkillsState>(employeePrivateSkillsPath(companyId, memberId));
}

export async function getEmployeePrivateSkill(input: {
  companyId?: string;
  memberId?: string;
  skillId?: string;
}): Promise<EmployeePrivateSkillFile> {
  const companyId = required(input.companyId, "companyId");
  const memberId = required(input.memberId, "memberId");
  const skillId = required(input.skillId, "skillId");
  return requestJson<EmployeePrivateSkillFile>(employeePrivateSkillPath(companyId, memberId, skillId));
}

export async function saveEmployeePrivateSkill(input: EmployeePrivateSkillSaveRequest): Promise<EmployeePrivateSkillFile> {
  const companyId = required(input.companyId, "companyId");
  const memberId = required(input.memberId, "memberId");
  const skillId = required(input.skillId, "skillId");
  return requestJson<EmployeePrivateSkillFile>(employeePrivateSkillPath(companyId, memberId, skillId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      memberId,
      skillId,
      content: input.content,
    }),
  });
}

function editableInstructionFiles(employee: EmployeeAdminRecord): Array<{ path: string; content: string }> {
  return (employee.localAssets?.instructionFiles ?? [])
    .filter((file) => file.editable)
    .map((file) => ({
      path: file.path,
      content: file.content,
    }));
}
