import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { TinyOfficeReleaseChannelManifest, TinyOfficeUpdateJob } from "../../api/contracts/tinyoffice-frontend-api-contracts.js";
import type { TinyOfficeUpdateExecutor } from "./tinyoffice-update-service.js";
import { readUpdateJob, writeUpdateJob } from "./tinyoffice-update-job-store.js";

type CommandRunner = (command: string, args: string[]) => { status: number | null; error?: Error; stderr?: string };

export class TinyOfficeSystemdUpdateExecutor implements TinyOfficeUpdateExecutor {
  constructor(private readonly options: { repoRoot: string; now?: () => Date; run?: CommandRunner; serviceName?: string }) {}

  async loadLatest(): Promise<TinyOfficeUpdateJob | undefined> {
    return await readUpdateJob(this.options.repoRoot);
  }

  async start(input: { targetRelease: TinyOfficeReleaseChannelManifest["release"] }): Promise<TinyOfficeUpdateJob> {
    if (process.env.TINYOFFICE_DEPLOYMENT_MODE !== "production") throw new Error("The systemd updater is available only in production mode.");
    const current = await this.loadLatest();
    if (current && ["accepted", "downloading", "verifying", "installing"].includes(current.status)) {
      throw new Error(`TinyOffice update ${current.jobId} is already running.`);
    }
    const timestamp = (this.options.now ?? (() => new Date()))().toISOString();
    const job: TinyOfficeUpdateJob = {
      schema: "tinyoffice-update-job",
      version: 2,
      jobId: `update-${randomUUID()}`,
      targetReleaseId: input.targetRelease.releaseId,
      status: "accepted",
      startedAt: timestamp,
      updatedAt: timestamp,
      evidence: [`Approved Release ${input.targetRelease.releaseId} queued for the external updater.`],
    };
    await writeUpdateJob(this.options.repoRoot, job);
    const run = this.options.run ?? defaultRun;
    const serviceName = this.options.serviceName ?? process.env.TINYOFFICE_UPDATER_SYSTEMD_SERVICE?.trim() ?? "tinyoffice-updater.service";
    const result = run("systemctl", ["--user", "start", "--no-block", serviceName]);
    if (result.error || result.status !== 0) {
      const failed = { ...job, status: "failed" as const, updatedAt: new Date().toISOString(), error: result.error?.message ?? (result.stderr?.trim() || "systemd did not accept the updater job") };
      await writeUpdateJob(this.options.repoRoot, failed);
      throw new Error(failed.error);
    }
    return job;
  }
}

function defaultRun(command: string, args: string[]): ReturnType<CommandRunner> {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return { status: result.status, ...(result.error ? { error: result.error } : {}), ...(result.stderr ? { stderr: result.stderr } : {}) };
}
