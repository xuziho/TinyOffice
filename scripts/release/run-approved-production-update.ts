import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TinyOfficeReleaseChannelManifest, TinyOfficeUpdateJob } from "../../src/api/contracts/tinyoffice-frontend-api-contracts.js";
import { readUpdateJob, writeUpdateJob } from "../../src/runtime/update/tinyoffice-update-job-store.js";
import { validateReleaseManifest } from "../../src/runtime/update/tinyoffice-update-service.js";

const repoRoot = process.cwd();
const manifestUrl = process.env.TINYOFFICE_RELEASE_MANIFEST_URL?.trim() || "https://github.com/xuziho/TinyOffice/releases/latest/download/tinyoffice-stable.json";

await run().catch(async (error) => {
  const current = await readUpdateJob(repoRoot);
  if (current) await setJob(current, "failed", error instanceof Error ? error.message : String(error));
  console.error(error);
  process.exitCode = 1;
});

async function run(): Promise<void> {
  if (process.env.TINYOFFICE_DEPLOYMENT_MODE !== "production") throw new Error("TINYOFFICE_DEPLOYMENT_MODE=production is required.");
  const job = await readUpdateJob(repoRoot);
  if (!job || job.schema !== "tinyoffice-update-job" || job.version !== 2 || job.status !== "accepted") throw new Error("No accepted TinyOffice update job is available.");

  await setJob(job, "downloading", undefined, `Reading approved Release metadata from ${manifestUrl}`);
  const manifestResponse = await fetch(manifestUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!manifestResponse.ok) throw new Error(`Release manifest download failed: ${manifestResponse.status} ${manifestResponse.statusText}`);
  const manifest = await manifestResponse.json() as TinyOfficeReleaseChannelManifest;
  validateReleaseManifest(manifest);
  if (manifest.release.releaseId !== job.targetReleaseId) throw new Error(`Approved Release changed from ${job.targetReleaseId} to ${manifest.release.releaseId}; start a new update after reviewing it.`);

  const downloads = path.join(repoRoot, ".runtime", "updates", "downloads");
  await mkdir(downloads, { recursive: true });
  const fileName = path.basename(manifest.release.artifact.fileName);
  if (fileName !== manifest.release.artifact.fileName) throw new Error("Release artifact filename is unsafe.");
  const target = path.join(downloads, fileName);
  const temporary = `${target}.${process.pid}.tmp`;
  const artifactResponse = await fetch(manifest.release.artifact.url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!artifactResponse.ok) throw new Error(`Release download failed: ${artifactResponse.status} ${artifactResponse.statusText}`);
  const bytes = new Uint8Array(await artifactResponse.arrayBuffer());
  await writeFile(temporary, bytes, { mode: 0o600 });
  await setJob(job, "verifying", undefined, `Downloaded ${fileName}; verifying SHA-256.`);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== manifest.release.artifact.sha256) throw new Error("Release checksum mismatch.");
  await rename(temporary, target);

  await setJob(job, "installing", undefined, "Checksum verified. The guarded installer now owns backup, migration, restart, and readiness verification.");
  const installer = path.join(repoRoot, "scripts", "release", "install-production-release.sh");
  const result = await runCommand("bash", [installer, target, actualSha256]);
  if (result.status !== 0) throw new Error(`Guarded installer failed with exit ${result.status}: ${result.stderr.trim() || result.stdout.trim()}`);
  await setJob(job, "completed", undefined, ...tailEvidence(result.stdout));
}

async function setJob(job: TinyOfficeUpdateJob, status: TinyOfficeUpdateJob["status"], error?: string, ...evidence: string[]): Promise<void> {
  job.status = status;
  job.updatedAt = new Date().toISOString();
  if (error) job.error = error;
  job.evidence = [...(job.evidence ?? []), ...evidence].slice(-30);
  await writeUpdateJob(repoRoot, job);
}

function runCommand(command: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env: process.env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); process.stderr.write(chunk); });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

function tailEvidence(output: string): string[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-10);
}
