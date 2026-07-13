import { requestJson } from "./tinyofficeRequest";

export type BackupReceipt = { backupId: string; createdAt: string; fileName: string; byteLength: number; sha256: string };
export type BackupJob = { jobId: string; status: "creating" | "completed" | "failed"; startedAt: string; completedAt?: string; error?: string; receipt?: BackupReceipt };
export type BackupsState = { schema: "tinyoffice-backups"; version: 1; jobs: BackupJob[]; backups: BackupReceipt[] };

export function listBackups(): Promise<BackupsState> { return requestJson("/api/tinyoffice/backups"); }
export function createBackup(): Promise<BackupJob> { return requestJson("/api/tinyoffice/backups", { method: "POST" }); }
export function backupDownloadHref(backupId: string): string { return `/api/tinyoffice/backups/${encodeURIComponent(backupId)}/download`; }
