import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readUpdateJob } from "../../src/runtime/update/tinyoffice-update-job-store.js";
import { TinyOfficeSystemdUpdateExecutor } from "../../src/runtime/update/tinyoffice-systemd-update-executor.js";

test("systemd updater queues only an exact Release id and starts the fixed oneshot service", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-systemd-updater-"));
  const previousMode = process.env.TINYOFFICE_DEPLOYMENT_MODE;
  process.env.TINYOFFICE_DEPLOYMENT_MODE = "production";
  const commands: Array<[string, string[]]> = [];
  try {
    const executor = new TinyOfficeSystemdUpdateExecutor({
      repoRoot,
      now: () => new Date("2026-07-16T12:00:00.000Z"),
      serviceName: "tinyoffice-updater.service",
      run(command, args) { commands.push([command, args]); return { status: 0 }; },
    });
    const job = await executor.start({ targetRelease: {
      releaseId: "0.1.1-bbbbbbbbbbbb", tinyOfficeVersion: "0.1.1", gitCommit: "b".repeat(40), minimumNodeVersion: "22.19.0",
      artifact: { fileName: "tinyoffice.tgz", url: "https://example.test/tinyoffice.tgz", sha256: "c".repeat(64) }, notes: [],
    } });
    assert.equal(job.targetReleaseId, "0.1.1-bbbbbbbbbbbb");
    assert.equal((await readUpdateJob(repoRoot))?.status, "accepted");
    assert.deepEqual(commands, [["systemctl", ["--user", "start", "--no-block", "tinyoffice-updater.service"]]]);
    await assert.rejects(() => executor.start({ targetRelease: {
      releaseId: "other", tinyOfficeVersion: "0.1.2", gitCommit: "d".repeat(40), minimumNodeVersion: "22.19.0",
      artifact: { fileName: "other.tgz", url: "https://example.test/other.tgz", sha256: "e".repeat(64) }, notes: [],
    } }), /already running/);
  } finally {
    if (previousMode === undefined) delete process.env.TINYOFFICE_DEPLOYMENT_MODE; else process.env.TINYOFFICE_DEPLOYMENT_MODE = previousMode;
  }
});
