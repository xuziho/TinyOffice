import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
  return readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
}

function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

export function companyScopeFromEmployeeHome(employeeHomePath: string): {
  repoRoot: string;
  companyId: string;
  employeeId: string;
} {
  const pathApi = isWindowsDrivePath(employeeHomePath) ? path.win32 : path;
  const normalized = pathApi.normalize(employeeHomePath);
  const parts = normalized.split(/[\\/]+/);
  const companiesIndex = parts.lastIndexOf("companies");
  if (
    companiesIndex < 0 ||
    parts[companiesIndex + 1] === undefined ||
    parts[companiesIndex + 2] !== "employees" ||
    parts[companiesIndex + 3] === undefined
  ) {
    throw new Error(
      `Employee home path must be company-scoped as companies/<companyId>/employees/<employeeId>: ${employeeHomePath}`,
    );
  }
  return {
    repoRoot: parts.slice(0, companiesIndex).join(pathApi.sep) || pathApi.sep,
    companyId: parts[companiesIndex + 1],
    employeeId: parts[companiesIndex + 3],
  };
}

export function repoRootFromEmployeeHome(employeeHomePath: string): string {
  return companyScopeFromEmployeeHome(employeeHomePath).repoRoot;
}

export function toBashShellPath(filePath: string): string {
  const trimmed = filePath.trim();
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(trimmed);
  if (!match) {
    return trimmed.replace(/\\/g, "/");
  }
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, "/").replace(/^\/+/, "");
  return rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`;
}

