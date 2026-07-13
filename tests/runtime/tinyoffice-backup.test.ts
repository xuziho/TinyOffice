import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTinyOfficeBackup, inspectTinyOfficeBackup, verifyTinyOfficeBackup, type BackupCommandRunner } from "../../src/runtime/backup/tinyoffice-backup.js";

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
