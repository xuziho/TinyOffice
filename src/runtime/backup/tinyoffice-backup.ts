import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile, cp, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as tar from "tar";

export const TINYOFFICE_BACKUP_SCHEMA = "tinyoffice-backup";
export const TINYOFFICE_BACKUP_VERSION = 1;

export interface TinyOfficeBackupManifest {
  schema: typeof TINYOFFICE_BACKUP_SCHEMA;
  version: typeof TINYOFFICE_BACKUP_VERSION;
  backupId: string;
  createdAt: string;
  appVersion: string;
  database: { format: "postgres-custom"; relativePath: "database/tinyoffice.dump" };
  fileRoots: Array<{ source: string; relativePath: string; present: boolean }>;
  files: Array<{ relativePath: string; byteLength: number; sha256: string }>;
}

export interface TinyOfficeBackupReceipt {
  ok: true;
  backupId: string;
  createdAt: string;
  path: string;
  fileName: string;
  byteLength: number;
  sha256: string;
  manifest: TinyOfficeBackupManifest;
}

export type TinyOfficeBackupRecord = Omit<TinyOfficeBackupReceipt, "manifest">;

export interface BackupCommandRunner {
  run(command: string, args: string[], options?: { cwd?: string }): Promise<void>;
}

const defaultRunner: BackupCommandRunner = {
  run(command, args, options) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: options?.cwd, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`)));
    });
  },
};

async function dumpDatabase(input: { destination: string; databaseUrl: string; runner: BackupCommandRunner }): Promise<void> {
  const explicit = process.env.TINYOFFICE_PG_DUMP_PATH;
  if (explicit) {
    await input.runner.run(explicit, ["--format=custom", "--no-owner", "--no-privileges", "--file", input.destination, input.databaseUrl]);
    return;
  }
  try {
    await input.runner.run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", input.destination, input.databaseUrl]);
  } catch (error) {
    if (input.runner !== defaultRunner || !/ENOENT|not recognized|not found/i.test(error instanceof Error ? error.message : String(error))) throw error;
    const container = process.env.TINYOFFICE_POSTGRES_CONTAINER || "tinyoffice-postgres";
    const remote = `/tmp/tinyoffice-${randomUUID()}.dump`;
    await input.runner.run("docker", ["exec", container, "pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--file", remote, databaseUrlInsidePostgresContainer(input.databaseUrl)]);
    try { await input.runner.run("docker", ["cp", `${container}:${remote}`, input.destination]); }
    finally { await input.runner.run("docker", ["exec", container, "rm", "-f", remote]).catch(() => undefined); }
  }
}

async function restoreDatabase(input: { source: string; databaseUrl: string; runner: BackupCommandRunner }): Promise<void> {
  const args = ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", input.databaseUrl];
  const explicit = process.env.TINYOFFICE_PG_RESTORE_PATH;
  if (explicit) { await input.runner.run(explicit, [...args, input.source]); return; }
  try {
    await input.runner.run("pg_restore", [...args, input.source]);
  } catch (error) {
    if (input.runner !== defaultRunner || !/ENOENT|not recognized|not found/i.test(error instanceof Error ? error.message : String(error))) throw error;
    const container = process.env.TINYOFFICE_POSTGRES_CONTAINER || "tinyoffice-postgres";
    const remote = `/tmp/tinyoffice-${randomUUID()}.dump`;
    await input.runner.run("docker", ["cp", input.source, `${container}:${remote}`]);
    const containerArgs = ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", databaseUrlInsidePostgresContainer(input.databaseUrl)];
    try { await input.runner.run("docker", ["exec", container, "pg_restore", ...containerArgs, remote]); }
    finally { await input.runner.run("docker", ["exec", container, "rm", "-f", remote]).catch(() => undefined); }
  }
}

function requiredDatabaseUrl(value = process.env.TINYOFFICE_DATABASE_URL): string {
  if (!value?.trim()) throw new Error("TINYOFFICE_DATABASE_URL is required to create or restore a backup.");
  return value.trim();
}

function databaseUrlInsidePostgresContainer(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  parsed.hostname = "127.0.0.1";
  parsed.port = "5432";
  return parsed.toString();
}

function safeTimestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function walkFiles(root: string, relative = ""): Promise<string[]> {
  const current = path.join(root, relative);
  const entries = await readdir(current, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(root, child));
    else if (entry.isFile()) result.push(child.replaceAll("\\", "/"));
  }
  return result;
}

async function exists(target: string): Promise<boolean> {
  try { await stat(target); return true; } catch { return false; }
}

export async function createTinyOfficeBackup(input: {
  repoRoot: string;
  outputDirectory?: string;
  databaseUrl?: string;
  now?: Date;
  commandRunner?: BackupCommandRunner;
}): Promise<TinyOfficeBackupReceipt> {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const backupId = `backup-${safeTimestamp(now)}-${randomUUID().slice(0, 8)}`;
  const outputDirectory = path.resolve(input.outputDirectory ?? path.join(input.repoRoot, ".data", "backups"));
  const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-backup-"));
  const archivePath = path.join(outputDirectory, `tinyoffice-${safeTimestamp(now)}.tobackup`);
  const databasePath = path.join(stagingRoot, "database", "tinyoffice.dump");
  const runner = input.commandRunner ?? defaultRunner;
  await mkdir(path.dirname(databasePath), { recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  try {
    await dumpDatabase({ destination: databasePath, databaseUrl: requiredDatabaseUrl(input.databaseUrl), runner });

    const roots = [
      { source: "companies", absolute: path.join(input.repoRoot, "companies"), relativePath: "files/companies" },
      { source: ".data/companies", absolute: path.join(input.repoRoot, ".data", "companies"), relativePath: "files/data-companies" },
    ];
    const fileRoots: TinyOfficeBackupManifest["fileRoots"] = [];
    for (const root of roots) {
      const present = await exists(root.absolute);
      fileRoots.push({ source: root.source, relativePath: root.relativePath, present });
      if (present) await cp(root.absolute, path.join(stagingRoot, root.relativePath), { recursive: true, preserveTimestamps: true });
    }

    const packageJson = JSON.parse(await readFile(path.join(input.repoRoot, "package.json"), "utf8")) as { version?: string };
    const stagedFiles = (await walkFiles(stagingRoot)).filter((file) => file !== "manifest.json");
    const files = await Promise.all(stagedFiles.map(async (relativePath) => {
      const absolute = path.join(stagingRoot, relativePath);
      return { relativePath, byteLength: (await stat(absolute)).size, sha256: await sha256File(absolute) };
    }));
    const manifest: TinyOfficeBackupManifest = {
      schema: TINYOFFICE_BACKUP_SCHEMA,
      version: TINYOFFICE_BACKUP_VERSION,
      backupId,
      createdAt,
      appVersion: packageJson.version || "unknown",
      database: { format: "postgres-custom", relativePath: "database/tinyoffice.dump" },
      fileRoots,
      files,
    };
    await writeFile(path.join(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await tar.create({ gzip: true, cwd: stagingRoot, file: archivePath, portable: true }, ["manifest.json", "database", "files"]);
    await verifyTinyOfficeBackup(archivePath);
    const receipt: TinyOfficeBackupReceipt = {
      ok: true,
      backupId,
      createdAt,
      path: archivePath,
      fileName: path.basename(archivePath),
      byteLength: (await stat(archivePath)).size,
      sha256: await sha256File(archivePath),
      manifest,
    };
    const { manifest: _manifest, ...record } = receipt;
    await writeFile(`${archivePath}.json`, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return receipt;
  } catch (error) {
    await rm(archivePath, { force: true });
    await rm(`${archivePath}.json`, { force: true });
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function extractAndReadManifest(archivePath: string): Promise<{ root: string; manifest: TinyOfficeBackupManifest }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-verify-"));
  try {
    await tar.extract({ cwd: root, file: path.resolve(archivePath), strict: true });
    const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as TinyOfficeBackupManifest;
    if (manifest.schema !== TINYOFFICE_BACKUP_SCHEMA || manifest.version !== TINYOFFICE_BACKUP_VERSION) {
      throw new Error(`Unsupported TinyOffice backup schema/version: ${manifest.schema}@${manifest.version}.`);
    }
    if (manifest.database?.relativePath !== "database/tinyoffice.dump" || manifest.database?.format !== "postgres-custom") {
      throw new Error("TinyOffice backup has an unsupported database payload.");
    }
    const allowedRoots = new Map([["companies", "files/companies"], [".data/companies", "files/data-companies"]]);
    if (!Array.isArray(manifest.fileRoots) || manifest.fileRoots.length !== allowedRoots.size) {
      throw new Error("TinyOffice backup has an unsupported managed file-root set.");
    }
    for (const fileRoot of manifest.fileRoots) {
      if (allowedRoots.get(fileRoot.source) !== fileRoot.relativePath || typeof fileRoot.present !== "boolean") {
        throw new Error(`TinyOffice backup has an unsafe managed file root: ${String(fileRoot.source)}.`);
      }
    }
    if (!Array.isArray(manifest.files) || !manifest.files.some((file) => file.relativePath === manifest.database.relativePath)) {
      throw new Error("TinyOffice backup manifest does not include its database dump.");
    }
    return { root, manifest };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function inspectTinyOfficeBackup(archivePath: string): Promise<TinyOfficeBackupManifest> {
  const extracted = await extractAndReadManifest(archivePath);
  await rm(extracted.root, { recursive: true, force: true });
  return extracted.manifest;
}

export async function verifyTinyOfficeBackup(archivePath: string): Promise<TinyOfficeBackupManifest> {
  const { root, manifest } = await extractAndReadManifest(archivePath);
  try {
    for (const expected of manifest.files) {
      const absolute = path.resolve(root, expected.relativePath);
      if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Unsafe backup path: ${expected.relativePath}`);
      const actualSize = (await stat(absolute)).size;
      if (actualSize !== expected.byteLength) throw new Error(`Backup size mismatch: ${expected.relativePath}`);
      if (await sha256File(absolute) !== expected.sha256) throw new Error(`Backup checksum mismatch: ${expected.relativePath}`);
    }
    return manifest;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function restoreTinyOfficeBackup(input: {
  repoRoot: string;
  archivePath: string;
  confirmation: string;
  maintenanceAcknowledged: boolean;
  databaseUrl?: string;
  commandRunner?: BackupCommandRunner;
  safetyBackupDirectory?: string;
}): Promise<{ ok: true; backupId: string; safetyBackupPath: string }> {
  if (input.confirmation !== "RESTORE") throw new Error("Restore requires --confirm RESTORE.");
  if (!input.maintenanceAcknowledged) throw new Error("Restore requires --maintenance to confirm TinyOffice writes are stopped.");
  const manifest = await verifyTinyOfficeBackup(input.archivePath);
  const safety = await createTinyOfficeBackup({
    repoRoot: input.repoRoot,
    outputDirectory: input.safetyBackupDirectory ?? path.join(input.repoRoot, ".data", "backups", "pre-restore"),
    databaseUrl: input.databaseUrl,
    commandRunner: input.commandRunner,
  });
  const { root } = await extractAndReadManifest(input.archivePath);
  try {
    await restoreDatabase({ source: path.join(root, manifest.database.relativePath), databaseUrl: requiredDatabaseUrl(input.databaseUrl), runner: input.commandRunner ?? defaultRunner });
    for (const fileRoot of manifest.fileRoots) {
      const destination = path.join(input.repoRoot, fileRoot.source);
      const source = path.join(root, fileRoot.relativePath);
      const old = `${destination}.pre-restore-${Date.now()}`;
      if (await exists(destination)) await rename(destination, old);
      try {
        if (fileRoot.present) await cp(source, destination, { recursive: true, preserveTimestamps: true });
        await rm(old, { recursive: true, force: true });
      } catch (error) {
        await rm(destination, { recursive: true, force: true });
        if (await exists(old)) await rename(old, destination);
        throw error;
      }
    }
    return { ok: true, backupId: manifest.backupId, safetyBackupPath: safety.path };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function listTinyOfficeBackups(repoRoot: string): Promise<TinyOfficeBackupRecord[]> {
  const directory = path.join(repoRoot, ".data", "backups");
  if (!await exists(directory)) return [];
  const names = (await readdir(directory)).filter((name) => name.endsWith(".tobackup")).sort().reverse();
  const receipts: TinyOfficeBackupRecord[] = [];
  for (const fileName of names) {
    const archivePath = path.join(directory, fileName);
    try {
      const metadataPath = `${archivePath}.json`;
      if (await exists(metadataPath)) {
        const record = JSON.parse(await readFile(metadataPath, "utf8")) as TinyOfficeBackupRecord;
        if (record.ok === true && record.path === archivePath && record.fileName === fileName) { receipts.push(record); continue; }
      }
      const manifest = await inspectTinyOfficeBackup(archivePath);
      const record: TinyOfficeBackupRecord = { ok: true, backupId: manifest.backupId, createdAt: manifest.createdAt, path: archivePath, fileName, byteLength: (await stat(archivePath)).size, sha256: await sha256File(archivePath) };
      await writeFile(metadataPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      receipts.push(record);
    } catch { /* Invalid or partial files are intentionally omitted from the product list. */ }
  }
  return receipts;
}
