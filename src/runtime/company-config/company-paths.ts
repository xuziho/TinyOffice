import path from "node:path";

export function normalizeCompanyId(companyId: string | undefined): string {
  const normalized = companyId?.trim();
  if (!normalized) {
    throw new Error("Company context is required: companyId is missing.");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error(`Invalid companyId: ${companyId}`);
  }
  return normalized;
}

export function companyHomePath(input: {
  repoRoot: string;
  companyId: string;
}): string {
  return path.join(input.repoRoot, "companies", normalizeCompanyId(input.companyId));
}

export function companyEmployeesRootPath(input: {
  repoRoot: string;
  companyId: string;
}): string {
  return path.join(companyHomePath(input), "employees");
}

export function companySkillsRootPath(input: {
  repoRoot: string;
  companyId: string;
}): string {
  return path.join(companyHomePath(input), "skills");
}

export function companyEmployeeHomePath(input: {
  repoRoot: string;
  companyId: string;
  employeeId: string;
}): string {
  return path.join(companyEmployeesRootPath(input), input.employeeId);
}
