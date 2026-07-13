import path from "node:path";
import { createTinyOfficeBackup, listTinyOfficeBackups, type TinyOfficeBackupReceipt, type TinyOfficeBackupRecord } from "./tinyoffice-backup.js";

export type TinyOfficeBackupJob = {
  jobId: string;
  status: "creating" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
  receipt?: TinyOfficeBackupPublicReceipt;
};

type TinyOfficeBackupInternalJob = Omit<TinyOfficeBackupJob, "receipt"> & { receipt?: TinyOfficeBackupReceipt };
type TinyOfficeBackupPublicReceipt = Omit<TinyOfficeBackupRecord, "path">;

function publicReceipt(receipt: TinyOfficeBackupReceipt): TinyOfficeBackupPublicReceipt {
  const { manifest: _manifest, path: _path, ...safe } = receipt;
  return safe;
}

export class TinyOfficeBackupService {
  private jobs = new Map<string, TinyOfficeBackupInternalJob>();

  constructor(private readonly repoRoot: string) {}

  async list(): Promise<{ schema: "tinyoffice-backups"; version: 1; jobs: TinyOfficeBackupJob[]; backups: TinyOfficeBackupPublicReceipt[] }> {
    return {
      schema: "tinyoffice-backups",
      version: 1,
      jobs: [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((job) => ({ ...job, ...(job.receipt ? { receipt: publicReceipt(job.receipt) } : {}) })),
      backups: (await listTinyOfficeBackups(this.repoRoot)).map(({ path: _path, ...receipt }) => receipt),
    };
  }

  start(): TinyOfficeBackupJob {
    if ([...this.jobs.values()].some((job) => job.status === "creating")) throw new Error("A TinyOffice backup is already being created.");
    const jobId = `backup-job-${Date.now()}`;
    const job: TinyOfficeBackupInternalJob = { jobId, status: "creating", startedAt: new Date().toISOString() };
    this.jobs.set(jobId, job);
    void createTinyOfficeBackup({ repoRoot: this.repoRoot }).then((receipt) => {
      this.jobs.set(jobId, { ...job, status: "completed", completedAt: new Date().toISOString(), receipt });
    }).catch((error: unknown) => {
      this.jobs.set(jobId, { ...job, status: "failed", completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
    });
    return job;
  }

  async download(backupId: string): Promise<TinyOfficeBackupRecord> {
    const backup = (await listTinyOfficeBackups(this.repoRoot)).find((candidate) => candidate.backupId === backupId);
    if (!backup) throw new Error(`TinyOffice backup not found: ${backupId}`);
    const root = path.resolve(this.repoRoot, ".data", "backups");
    if (!path.resolve(backup.path).startsWith(`${root}${path.sep}`)) throw new Error("Backup download path escaped the managed backup directory.");
    return backup;
  }
}
