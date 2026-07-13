import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { TinyOfficeUpdateJob, TinyOfficeUpdateManifest } from "../../src/api/contracts/tinyoffice-frontend-api-contracts.js";
import { compareVersions, TinyOfficeUpdateService, TinyOfficeUpdateUnavailableError } from "../../src/runtime/update/tinyoffice-update-service.js";

const fixedNow = new Date("2026-07-12T12:00:00.000Z");

test("update version comparison handles the PI release versions used by the stable channel", () => {
  assert.equal(compareVersions("0.80.6", "0.78.0"), 1);
  assert.equal(compareVersions("v22.19.0", "22.19.0"), 0);
  assert.equal(compareVersions("22.14.0", "22.19.0"), -1);
});

test("update service distinguishes an unapproved upstream PI release", async () => {
  const repoRoot = await updateFixture({ installedVersion: "0.80.6", approvedVersion: "0.80.6" });
  const service = new TinyOfficeUpdateService({
    repoRoot,
    nodeVersion: "22.19.0",
    now: () => fixedNow,
    fetch: updateFetch({ latestVersion: "0.81.0", approvedVersion: "0.80.6" }),
  });

  const status = await service.loadStatus();

  assert.equal(status.pi.state, "upstream_available");
  assert.equal(status.installation.enabled, false);
  assert.match(status.installation.reason, /has not approved/);
  assert.equal(status.sources.approvalManifestSource, "remote");
  await assert.rejects(() => service.startApprovedUpdate(), (error: unknown) => {
    assert.equal(error instanceof TinyOfficeUpdateUnavailableError, true);
    assert.equal((error as TinyOfficeUpdateUnavailableError).statusCode, 409);
    return true;
  });
});

test("update service exposes approved model changes but requires an external executor", async () => {
  const repoRoot = await updateFixture({ installedVersion: "0.80.6", approvedVersion: "0.80.6" });
  const service = new TinyOfficeUpdateService({
    repoRoot,
    nodeVersion: "22.19.0",
    fetch: updateFetch({ latestVersion: "0.81.0", approvedVersion: "0.81.0", models: ["openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.7"] }),
  });

  const status = await service.loadStatus();

  assert.equal(status.pi.state, "ready_to_install");
  assert.equal(status.installation.enabled, false);
  assert.match(status.installation.reason, /no external update executor/);
  assert.deepEqual(status.pi.addedModels, ["openai-codex/gpt-5.7"]);
  assert.deepEqual(status.pi.removedModels, ["openai-codex/gpt-5.6-luna"]);
});

test("update service blocks an approved update when Node is too old", async () => {
  const repoRoot = await updateFixture({ installedVersion: "0.80.6", approvedVersion: "0.80.6" });
  const service = new TinyOfficeUpdateService({
    repoRoot,
    nodeVersion: "22.14.0",
    fetch: updateFetch({ latestVersion: "0.81.0", approvedVersion: "0.81.0" }),
  });

  const status = await service.loadStatus();

  assert.equal(status.pi.state, "blocked");
  assert.equal(status.runtime.compatible, false);
  assert.match(status.installation.reason, /Upgrade Node/);
});

test("update service falls back to its bundled approval manifest when the remote source fails", async () => {
  const repoRoot = await updateFixture({ installedVersion: "0.80.6", approvedVersion: "0.80.6" });
  const service = new TinyOfficeUpdateService({
    repoRoot,
    nodeVersion: "22.19.0",
    fetch: async (input) => {
      if (String(input).includes("registry.npmjs.org")) return Response.json({ version: "0.80.6" });
      return new Response("offline", { status: 503, statusText: "Offline" });
    },
  });

  const status = await service.loadStatus();

  assert.equal(status.pi.state, "check_failed");
  assert.equal(status.installation.enabled, false);
  assert.match(status.installation.reason, /could not be checked/);
  assert.equal(status.sources.approvalManifestSource, "local");
  assert.equal(status.sources.warnings.length, 1);
});

test("update service starts only the exact approved version through its executor", async () => {
  const repoRoot = await updateFixture({ installedVersion: "0.80.6", approvedVersion: "0.80.6" });
  const targets: string[] = [];
  const job: TinyOfficeUpdateJob = {
    schema: "tinyoffice-update-job",
    version: 1,
    jobId: "update-1",
    targetPiVersion: "0.81.0",
    status: "accepted",
    startedAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
  };
  const service = new TinyOfficeUpdateService({
    repoRoot,
    nodeVersion: "22.19.0",
    fetch: updateFetch({ latestVersion: "0.81.0", approvedVersion: "0.81.0" }),
    updateExecutor: { start(input) { targets.push(input.targetPiVersion); return job; } },
  });

  assert.deepEqual(await service.startApprovedUpdate(), job);
  assert.deepEqual(targets, ["0.81.0"]);
});

async function updateFixture(input: { installedVersion: string; approvedVersion: string }): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "tinyoffice-update-"));
  await mkdir(path.join(root, "updates"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "providers"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), JSON.stringify({ version: input.installedVersion }));
  await writeFile(path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "providers", "openai-codex.models.js"), [
    'export const models = [{ id: "gpt-5.6-luna" }, { id: "gpt-5.6-sol" }];',
  ].join("\n"));
  await writeFile(path.join(root, "updates", "stable.json"), JSON.stringify(manifest(input.approvedVersion)));
  return root;
}

function updateFetch(input: { latestVersion: string; approvedVersion: string; models?: string[] }): typeof fetch {
  return async (url) => {
    if (String(url).includes("registry.npmjs.org")) return Response.json({ version: input.latestVersion });
    return Response.json(manifest(input.approvedVersion, input.models));
  };
}

function manifest(approvedVersion: string, models = ["openai-codex/gpt-5.6-luna", "openai-codex/gpt-5.6-sol"]): TinyOfficeUpdateManifest {
  return {
    schema: "tinyoffice-update-manifest",
    version: 1,
    channel: "stable",
    publishedAt: fixedNow.toISOString(),
    pi: {
      packageName: "@earendil-works/pi-coding-agent",
      approvedVersion,
      minimumNodeVersion: "22.19.0",
      models,
    },
  };
}
