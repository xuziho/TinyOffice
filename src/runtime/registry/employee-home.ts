import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import type { PresenceMode } from "../../collaboration/runtime/presence-mode.js";
import type { EmployeeRuntimeConfig } from "../company-config/employees-admin.js";
import {
  DEFAULT_RESOURCE_POLICY,
  normalizeResourcePolicy,
  type EmployeeResourcePolicy,
} from "../company-config/resource-policy.js";
import { CompanyDirectoryRepository } from "../company-config/company-directory-repository.js";
import {
  companyEmployeeHomePath,
  normalizeCompanyId,
} from "../company-config/company-paths.js";

export interface EmployeeHomeProfile {
  employeeId: string;
  avatarSeed?: string;
  role: string;
  displayName?: string;
  presenceMode: PresenceMode;
  sceneProfile?: string;
}

export interface EmployeeHome {
  companyId: string;
  employeeId: string;
  homePath: string;
  workspacePath: string;
  profile: EmployeeHomeProfile;
  resourcePolicy: EmployeeResourcePolicy;
  runtime?: EmployeeRuntimeConfig;
}

function assertProfile(
  value: unknown,
  homePath: string,
): asserts value is EmployeeHomeProfile {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid employee profile in ${homePath}.`);
  }

  const profile = value as Partial<EmployeeHomeProfile>;

  if (!profile.employeeId || typeof profile.employeeId !== "string") {
    throw new Error(`Missing employeeId in PostgreSQL employee profile for ${homePath}.`);
  }

  if (!profile.role || typeof profile.role !== "string") {
    throw new Error(`Missing role in PostgreSQL employee profile for ${homePath}.`);
  }

  if (
    profile.presenceMode !== "resident" &&
    profile.presenceMode !== "auto_exit_idle"
  ) {
    throw new Error(`Invalid presenceMode in PostgreSQL employee profile for ${homePath}.`);
  }

}

export async function loadEmployeeHome(input: {
  repoRoot: string;
  companyId: string;
  employeeId: string;
}): Promise<EmployeeHome> {
  const companyId = normalizeCompanyId(input.companyId);
  const employeeId = input.employeeId;
  const homePath = companyEmployeeHomePath({
    repoRoot: input.repoRoot,
    companyId,
    employeeId,
  });
  const workspacePath = path.join(homePath, "workspace");

  const repository = await CompanyDirectoryRepository.open(input.repoRoot, { companyId });
  let record;
  try {
    record = (await repository.loadEmployees()).find(
      (employee) => employee.employeeId === employeeId,
    );
  } finally {
    repository.close();
  }
  if (!record) {
    throw new Error(`Employee ${employeeId} is not configured in PostgreSQL Company Directory.`);
  }
  const profileJson = record.profile;
  assertProfile(profileJson, homePath);

  const workspaceStats = await stat(workspacePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (!workspaceStats) {
    await mkdir(workspacePath, { recursive: true });
  } else if (!workspaceStats.isDirectory()) {
    throw new Error(`workspace is not a directory in ${homePath}.`);
  }

  if (path.basename(homePath) !== profileJson.employeeId) {
    throw new Error(
      `Employee home folder ${path.basename(homePath)} does not match employeeId ${profileJson.employeeId}.`,
    );
  }

  return {
    companyId,
    employeeId: profileJson.employeeId,
    homePath,
    workspacePath,
    profile: profileJson,
    resourcePolicy: normalizeResourcePolicy(record.resourcePolicy || DEFAULT_RESOURCE_POLICY),
    runtime: record.runtime,
  };
}

export async function loadEmployeeHomes(input: {
  repoRoot: string;
  companyId: string;
}): Promise<EmployeeHome[]> {
  const companyId = normalizeCompanyId(input.companyId);
  const repository = await CompanyDirectoryRepository.open(input.repoRoot, { companyId });
  let employeeIds: string[];
  try {
    employeeIds = (await repository.loadEmployees())
      .filter((employee) => employee.enabled)
      .map((employee) => employee.employeeId)
      .sort();
  } finally {
    repository.close();
  }
  const homes = await Promise.all(employeeIds.map((employeeId) => loadEmployeeHome({
    repoRoot: input.repoRoot,
    companyId,
    employeeId,
  })));
  return homes.sort((left, right) => left.employeeId.localeCompare(right.employeeId));
}
