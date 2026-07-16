import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TinyOfficeUpdateJob } from "../../api/contracts/tinyoffice-frontend-api-contracts.js";

export function updateJobPath(repoRoot: string): string {
  return process.env.TINYOFFICE_UPDATE_JOB_FILE?.trim() || path.join(repoRoot, ".runtime", "updates", "latest.json");
}

export async function readUpdateJob(repoRoot: string): Promise<TinyOfficeUpdateJob | undefined> {
  try {
    return JSON.parse(await readFile(updateJobPath(repoRoot), "utf8")) as TinyOfficeUpdateJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeUpdateJob(repoRoot: string, job: TinyOfficeUpdateJob): Promise<void> {
  const target = updateJobPath(repoRoot);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}
