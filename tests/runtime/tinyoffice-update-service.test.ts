import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { TinyOfficeReleaseChannelManifest, TinyOfficeUpdateJob, TinyOfficeUpdateManifest } from "../../src/api/contracts/tinyoffice-frontend-api-contracts.js";
import { compareVersions, TinyOfficeUpdateService, TinyOfficeUpdateUnavailableError } from "../../src/runtime/update/tinyoffice-update-service.js";

const fixedNow = new Date("2026-07-16T12:00:00.000Z");
const installedCommit = "a".repeat(40);
const approvedCommit = "b".repeat(40);

test("update version comparison handles runtime versions", () => {
  assert.equal(compareVersions("0.80.6", "0.78.0"), 1);
  assert.equal(compareVersions("v22.19.0", "22.19.0"), 0);
  assert.equal(compareVersions("22.14.0", "22.19.0"), -1);
  assert.equal(compareVersions("0.1.0-alpha.2", "0.1.0-alpha.1"), 1);
  assert.equal(compareVersions("0.1.0", "0.1.0-alpha.9"), 1);
});

test("development checkouts never offer a production Release install", async () => {
  const repoRoot = await updateFixture({ productionRelease: false });
  const service = createService(repoRoot);
  const status = await service.loadStatus();
  assert.equal(status.release.state, "development");
  assert.equal(status.installation.enabled, false);
  assert.match(status.installation.reason, /immutable production Releases/);
});

test("production status separates whole-product Release updates from PI upstream visibility", async () => {
  const repoRoot = await updateFixture();
  const service = createService(repoRoot, { approvedReleaseId: installedReleaseId(), latestPi: "0.81.0" });
  const status = await service.loadStatus();
  assert.equal(status.release.state, "up_to_date");
  assert.equal(status.pi.state, "upstream_available");
  assert.equal(status.installation.enabled, false);
});

test("approved TinyOffice Release requires an external updater", async () => {
  const repoRoot = await updateFixture();
  const service = createService(repoRoot);
  const status = await service.loadStatus();
  assert.equal(status.release.state, "ready_to_install");
  assert.equal(status.installation.enabled, false);
  assert.match(status.installation.reason, /no external updater/);
  await assert.rejects(() => service.startApprovedUpdate(), TinyOfficeUpdateUnavailableError);
});

test("approved TinyOffice Release is blocked when Node is too old", async () => {
  const repoRoot = await updateFixture();
  const service = createService(repoRoot, { nodeVersion: "22.14.0" });
  const status = await service.loadStatus();
  assert.equal(status.release.state, "blocked");
  assert.equal(status.runtime.compatible, false);
});

test("failed Release discovery never falls back to an installable target", async () => {
  const repoRoot = await updateFixture();
  const service = new TinyOfficeUpdateService({
    repoRoot,
    deploymentMode: "production",
    nodeVersion: "22.19.0",
    fetch: async (url) => {
      if (String(url).includes("registry.npmjs.org")) return Response.json({ version: "0.80.6" });
      if (String(url).includes("releases/latest")) return new Response("offline", { status: 503, statusText: "Offline" });
      return Response.json(piManifest("0.80.6"));
    },
  });
  const status = await service.loadStatus();
  assert.equal(status.release.state, "check_failed");
  assert.equal(status.sources.releaseManifestSource, "unavailable");
  assert.equal(status.installation.enabled, false);
});

test("update service submits only the exact approved Release", async () => {
  const repoRoot = await updateFixture();
  const targets: string[] = [];
  const job: TinyOfficeUpdateJob = {
    schema: "tinyoffice-update-job", version: 2, jobId: "update-1", targetReleaseId: approvedReleaseId(), status: "accepted", startedAt: fixedNow.toISOString(), updatedAt: fixedNow.toISOString(),
  };
  const service = createService(repoRoot, {
    executor: {
      start(input) { targets.push(input.targetRelease.releaseId); return job; },
      async loadLatest() { return undefined; },
    },
  });
  assert.deepEqual(await service.startApprovedUpdate(), job);
  assert.deepEqual(targets, [approvedReleaseId()]);
});

async function updateFixture(input: { productionRelease?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "tinyoffice-update-"));
  await mkdir(path.join(root, "updates"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "providers"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), JSON.stringify({ version: "0.80.6" }));
  await writeFile(path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "providers", "openai-codex.models.js"), 'export const models = [{ id: "gpt-5.6-luna" }, { id: "gpt-5.6-sol" }];');
  await writeFile(path.join(root, "updates", "stable.json"), JSON.stringify(piManifest("0.80.6")));
  if (input.productionRelease !== false) await writeFile(path.join(root, "RELEASE.json"), JSON.stringify({ schema: "tinyoffice-production-release", releaseId: installedReleaseId(), tinyOfficeVersion: "0.1.0", gitCommit: installedCommit }));
  return root;
}

function createService(repoRoot: string, input: { approvedReleaseId?: string; latestPi?: string; nodeVersion?: string; executor?: ConstructorParameters<typeof TinyOfficeUpdateService>[0]["updateExecutor"] } = {}): TinyOfficeUpdateService {
  return new TinyOfficeUpdateService({
    repoRoot,
    deploymentMode: "production",
    nodeVersion: input.nodeVersion ?? "22.19.0",
    now: () => fixedNow,
    fetch: updateFetch({ approvedReleaseId: input.approvedReleaseId, latestPi: input.latestPi }),
    ...(input.executor ? { updateExecutor: input.executor } : {}),
  });
}

function updateFetch(input: { approvedReleaseId?: string; latestPi?: string } = {}): typeof fetch {
  return async (url) => {
    if (String(url).includes("registry.npmjs.org")) return Response.json({ version: input.latestPi ?? "0.80.6" });
    if (String(url).includes("releases/latest")) return Response.json(releaseManifest(input.approvedReleaseId));
    return Response.json(piManifest("0.80.6"));
  };
}

function piManifest(approvedVersion: string): TinyOfficeUpdateManifest {
  return { schema: "tinyoffice-update-manifest", version: 1, channel: "stable", publishedAt: fixedNow.toISOString(), pi: { packageName: "@earendil-works/pi-coding-agent", approvedVersion, minimumNodeVersion: "22.19.0", models: ["openai-codex/gpt-5.6-luna", "openai-codex/gpt-5.6-sol"] } };
}

function releaseManifest(releaseId = approvedReleaseId()): TinyOfficeReleaseChannelManifest {
  const same = releaseId === installedReleaseId();
  return { schema: "tinyoffice-release-channel", version: 1, channel: "stable", publishedAt: fixedNow.toISOString(), release: { releaseId, tinyOfficeVersion: same ? "0.1.0" : "0.1.1", gitCommit: same ? installedCommit : approvedCommit, minimumNodeVersion: "22.19.0", artifact: { fileName: `tinyoffice-${releaseId}.tgz`, url: `https://github.com/xuziho/TinyOffice/releases/download/v0.1.1/tinyoffice-${releaseId}.tgz`, sha256: "c".repeat(64) }, notes: [] } };
}

function installedReleaseId(): string { return `0.1.0-${installedCommit.slice(0, 12)}`; }
function approvedReleaseId(): string { return `0.1.1-${approvedCommit.slice(0, 12)}`; }
