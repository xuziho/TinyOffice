import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTinyOfficeBackup, inspectTinyOfficeBackup, pruneTinyOfficeBackups, verifyTinyOfficeBackup, type BackupCommandRunner } from "../../src/runtime/backup/tinyoffice-backup.js";

test("creates, inspects, and verifies a full-instance backup package", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-backup-test-"));
  const output = path.join(repoRoot, "output");
  await mkdir(path.join(repoRoot, "companies", "acme", "skills", "brief"), { recursive: true });
  await mkdir(path.join(repoRoot, ".data", "companies", "acme", "chat-attachments", "att-1"), { recursive: true });
  await writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
  await writeFile(path.join(repoRoot, "companies", "acme", "skills", "brief", "SKILL.md"), "# Brief\n");
  await writeFile(path.join(repoRoot, ".data", "companies", "acme", "chat-attachments", "att-1", "original"), "image-bytes");
  const runner: BackupCommandRunner = {
    async run(command, args) {
      assert.equal(command, "pg_dump");
      const destination = args[args.indexOf("--file") + 1];
      await writeFile(destination, "postgres-custom-dump");
    },
  };
  try {
    const receipt = await createTinyOfficeBackup({ repoRoot, outputDirectory: output, databaseUrl: "postgres://test", commandRunner: runner, now: new Date("2026-07-11T02:00:00.000Z") });
    assert.equal(receipt.ok, true);
    assert.match(receipt.fileName, /^tinyoffice-2026-07-11T02-00-00-000Z\.tobackup$/);
    const inspected = await inspectTinyOfficeBackup(receipt.path);
    assert.equal(inspected.appVersion, "1.2.3");
    assert.deepEqual(inspected.fileRoots.map((item) => [item.source, item.present]), [["companies", true], [".data/companies", true]]);
    assert.ok(inspected.files.some((file) => file.relativePath === "database/tinyoffice.dump"));
    assert.ok(inspected.files.some((file) => file.relativePath.endsWith("SKILL.md")));
    assert.ok(inspected.files.some((file) => file.relativePath.endsWith("chat-attachments/att-1/original")));
    assert.equal((await verifyTinyOfficeBackup(receipt.path)).backupId, receipt.backupId);
    assert.ok((await readFile(receipt.path)).byteLength > 0);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("removes an incomplete archive when database export fails", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-backup-fail-"));
  const output = path.join(repoRoot, "output");
  await writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ version: "1.0.0" }));
  try {
    await assert.rejects(createTinyOfficeBackup({
      repoRoot,
      outputDirectory: output,
      databaseUrl: "postgres://test",
      commandRunner: { run: async () => { throw new Error("dump failed"); } },
      now: new Date("2026-07-11T02:00:00.000Z"),
    }), /dump failed/);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("backs up production managed roots through absolute directory symlinks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-backup-links-"));
  const repoRoot = path.join(root, "release");
  const sharedRoot = path.join(root, "shared");
  const output = path.join(sharedRoot, "backups");
  await mkdir(path.join(repoRoot, ".data"), { recursive: true });
  await mkdir(path.join(sharedRoot, "companies", "acme"), { recursive: true });
  await mkdir(path.join(sharedRoot, "data-companies", "acme"), { recursive: true });
  await writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
  await writeFile(path.join(sharedRoot, "companies", "acme", "AGENTS.md"), "# Acme\n");
  await writeFile(path.join(sharedRoot, "data-companies", "acme", "state.json"), "{}\n");
  await symlink(path.join(sharedRoot, "companies"), path.join(repoRoot, "companies"), process.platform === "win32" ? "junction" : "dir");
  await symlink(path.join(sharedRoot, "data-companies"), path.join(repoRoot, ".data", "companies"), process.platform === "win32" ? "junction" : "dir");
  const runner: BackupCommandRunner = {
    async run(_command, args) {
      await writeFile(args[args.indexOf("--file") + 1], "postgres-custom-dump");
    },
  };
  try {
    const receipt = await createTinyOfficeBackup({ repoRoot, outputDirectory: output, databaseUrl: "postgres://test", commandRunner: runner });
    const manifest = await verifyTinyOfficeBackup(receipt.path);
    assert.ok(manifest.files.some((file) => file.relativePath === "files/companies/acme/AGENTS.md"));
    assert.ok(manifest.files.some((file) => file.relativePath === "files/data-companies/acme/state.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects nested symbolic links inside a managed backup root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-backup-unsafe-link-"));
  const repoRoot = path.join(root, "release");
  const outside = path.join(root, "outside");
  await mkdir(path.join(repoRoot, "companies", "acme"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
  await writeFile(path.join(outside, "secret.txt"), "must not be copied");
  await symlink(outside, path.join(repoRoot, "companies", "acme", "outside"), process.platform === "win32" ? "junction" : "dir");
  try {
    await assert.rejects(createTinyOfficeBackup({
      repoRoot,
      databaseUrl: "postgres://test",
      commandRunner: { async run(_command, args) { await writeFile(args[args.indexOf("--file") + 1], "postgres-custom-dump"); } },
    }), /unsupported symbolic link/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pre-update retention keeps the newest complete backup pairs without touching other files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-backup-retention-"));
  const archives: string[] = [];
  try {
    for (let index = 1; index <= 5; index += 1) {
      const createdAt = `2026-07-${String(index).padStart(2, "0")}T02:00:00.000Z`;
      const fileName = `tinyoffice-${createdAt.replace(/[:.]/g, "-")}.tobackup`;
      const archivePath = path.join(directory, fileName);
      archives.push(archivePath);
      await writeFile(archivePath, `backup-${index}`);
      await writeFile(`${archivePath}.json`, JSON.stringify({
        ok: true,
        backupId: `backup-${index}`,
        createdAt,
        path: archivePath,
        fileName,
        byteLength: 8,
        sha256: "test",
      }));
    }
    const unrelated = path.join(directory, "manual-backup.tobackup");
    const orphan = path.join(directory, "tinyoffice-orphan.tobackup");
    await writeFile(unrelated, "manual");
    await writeFile(orphan, "orphan");

    const result = await pruneTinyOfficeBackups({ directory, keep: 3 });

    assert.deepEqual(result.kept, archives.slice(2).reverse());
    assert.deepEqual(result.removed, archives.slice(0, 2).reverse());
    assert.deepEqual(result.skipped, [orphan]);
    await assert.rejects(readFile(archives[0]));
    await assert.rejects(readFile(`${archives[0]}.json`));
    assert.equal(await readFile(archives[4], "utf8"), "backup-5");
    assert.equal(await readFile(`${archives[4]}.json`, "utf8").then((value) => JSON.parse(value).backupId), "backup-5");
    assert.equal(await readFile(unrelated, "utf8"), "manual");
    assert.equal(await readFile(orphan, "utf8"), "orphan");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
