import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  TinyOfficeReleaseChannelManifest,
  TinyOfficeReleaseIdentity,
  TinyOfficeUpdateJob,
  TinyOfficeUpdateManifest,
  TinyOfficeUpdateStatus,
} from "../../api/contracts/tinyoffice-frontend-api-contracts.js";

const PI_PACKAGE = "@earendil-works/pi-coding-agent" as const;
const DEFAULT_NPM_REGISTRY_URL = "https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent/latest";
const DEFAULT_PI_APPROVAL_MANIFEST_URL = "https://raw.githubusercontent.com/xuziho/TinyOffice/main/updates/stable.json";
const DEFAULT_RELEASE_MANIFEST_URL = "https://github.com/xuziho/TinyOffice/releases/latest/download/tinyoffice-stable.json";
const UPDATE_SOURCE_TIMEOUT_MS = 8_000;
const UPDATE_SOURCE_ATTEMPTS = 2;

export interface TinyOfficeUpdateExecutor {
  start(input: { targetRelease: TinyOfficeReleaseChannelManifest["release"] }): Promise<TinyOfficeUpdateJob> | TinyOfficeUpdateJob;
  loadLatest?(): Promise<TinyOfficeUpdateJob | undefined>;
}

export class TinyOfficeUpdateUnavailableError extends Error {
  readonly statusCode = 409;
}

export type TinyOfficeUpdateServiceOptions = {
  repoRoot: string;
  fetch?: typeof globalThis.fetch;
  npmRegistryUrl?: string;
  approvalManifestUrl?: string;
  releaseManifestUrl?: string;
  updateExecutor?: TinyOfficeUpdateExecutor;
  now?: () => Date;
  nodeVersion?: string;
  deploymentMode?: string;
};

export class TinyOfficeUpdateService {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly npmRegistryUrl: string;
  private readonly approvalManifestUrl: string;
  private readonly releaseManifestUrl: string;
  private readonly now: () => Date;

  constructor(private readonly options: TinyOfficeUpdateServiceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.npmRegistryUrl = options.npmRegistryUrl ?? process.env.TINYOFFICE_NPM_REGISTRY_URL?.trim() ?? DEFAULT_NPM_REGISTRY_URL;
    this.approvalManifestUrl = options.approvalManifestUrl ?? process.env.TINYOFFICE_UPDATE_MANIFEST_URL?.trim() ?? DEFAULT_PI_APPROVAL_MANIFEST_URL;
    this.releaseManifestUrl = options.releaseManifestUrl ?? process.env.TINYOFFICE_RELEASE_MANIFEST_URL?.trim() ?? DEFAULT_RELEASE_MANIFEST_URL;
    this.now = options.now ?? (() => new Date());
  }

  async loadStatus(): Promise<TinyOfficeUpdateStatus> {
    const warnings: string[] = [];
    const localPiManifest = await this.readLocalPiManifest();
    const packageState = await this.readPackageState();
    const installedRelease = await this.readInstalledRelease(packageState.tinyOfficeVersion);
    const installedModels = await this.readInstalledPiModels();
    let piManifest = localPiManifest;
    let approvalManifestSource: "remote" | "local" = "local";
    let releaseManifest: TinyOfficeReleaseChannelManifest | undefined;
    let releaseManifestSource: "remote" | "unavailable" = "unavailable";
    let npmLatestVersion: string | undefined;

    const [piManifestResult, npmResult, releaseManifestResult] = await Promise.allSettled([
      this.fetchJson<TinyOfficeUpdateManifest>(this.approvalManifestUrl),
      this.fetchJson<{ version?: unknown }>(this.npmRegistryUrl),
      this.fetchJson<TinyOfficeReleaseChannelManifest>(this.releaseManifestUrl),
    ]);
    if (piManifestResult.status === "fulfilled") {
      try {
        validatePiManifest(piManifestResult.value);
        piManifest = piManifestResult.value;
        approvalManifestSource = "remote";
      } catch (error) {
        warnings.push(`PI approval manifest could not be refreshed: ${errorMessage(error)}`);
      }
    } else {
      warnings.push(`PI approval manifest could not be refreshed: ${errorMessage(piManifestResult.reason)}`);
    }
    if (npmResult.status === "fulfilled" && typeof npmResult.value.version === "string" && npmResult.value.version.trim()) {
      npmLatestVersion = npmResult.value.version.trim();
    } else {
      warnings.push(`npm registry could not be checked: ${npmResult.status === "rejected" ? errorMessage(npmResult.reason) : "response did not include a version"}`);
    }
    if (releaseManifestResult.status === "fulfilled") {
      try {
        validateReleaseManifest(releaseManifestResult.value);
        releaseManifest = releaseManifestResult.value;
        releaseManifestSource = "remote";
      } catch (error) {
        warnings.push(`TinyOffice Release manifest could not be refreshed: ${errorMessage(error)}`);
      }
    } else {
      warnings.push(`TinyOffice Release manifest could not be refreshed: ${errorMessage(releaseManifestResult.reason)}`);
    }

    const nodeVersion = (this.options.nodeVersion ?? process.versions.node).trim().replace(/^v/, "");
    const minimumNodeVersion = (releaseManifest?.release.minimumNodeVersion ?? piManifest.pi.minimumNodeVersion).trim().replace(/^v/, "");
    const compatible = compareVersions(nodeVersion, minimumNodeVersion) >= 0;
    const releaseState = resolveReleaseState({
      deploymentMode: this.options.deploymentMode ?? process.env.TINYOFFICE_DEPLOYMENT_MODE ?? "development",
      installedRelease,
      approvedRelease: releaseManifest?.release,
      compatible,
      releaseManifestFresh: releaseManifestSource === "remote",
    });
    const executorConfigured = Boolean(this.options.updateExecutor);
    const installationEnabled = releaseState === "ready_to_install" && executorConfigured;
    const approvedModels = uniqueSorted(piManifest.pi.models);
    const approvedComparison = compareVersions(piManifest.pi.approvedVersion, packageState.piVersion);
    const npmComparison = npmLatestVersion ? compareVersions(npmLatestVersion, packageState.piVersion) : 0;
    const piState = updatePiState({
      approvedComparison,
      npmComparison,
      npmChecked: Boolean(npmLatestVersion),
      compatible: compareVersions(nodeVersion, piManifest.pi.minimumNodeVersion) >= 0,
      approvalManifestFresh: approvalManifestSource === "remote",
    });
    const job = await this.options.updateExecutor?.loadLatest?.();

    return {
      schema: "tinyoffice-update-status",
      version: 2,
      checkedAt: this.now().toISOString(),
      channel: "stable",
      release: {
        installed: installedRelease,
        ...(releaseManifest ? { approved: releaseManifest.release } : {}),
        state: releaseState,
      },
      runtime: { nodeVersion, minimumNodeVersion, compatible },
      pi: {
        packageName: PI_PACKAGE,
        installedVersion: packageState.piVersion,
        ...(npmLatestVersion ? { npmLatestVersion } : {}),
        approvedVersion: piManifest.pi.approvedVersion,
        state: piState,
        installedModels,
        approvedModels,
        addedModels: approvedModels.filter((model) => !installedModels.includes(model)),
        removedModels: installedModels.filter((model) => !approvedModels.includes(model)),
      },
      installation: {
        enabled: installationEnabled,
        reason: installationReason({ releaseState, compatible, executorConfigured, approvedRelease: releaseManifest?.release }),
        requiresBackup: true,
        requiresRestart: true,
      },
      sources: {
        npmRegistry: this.npmRegistryUrl,
        approvalManifest: this.approvalManifestUrl,
        approvalManifestSource,
        releaseManifest: this.releaseManifestUrl,
        releaseManifestSource,
        warnings,
      },
      ...(job ? { job } : {}),
    };
  }

  async startApprovedUpdate(): Promise<TinyOfficeUpdateJob> {
    const status = await this.loadStatus();
    if (!status.installation.enabled || !this.options.updateExecutor || !status.release.approved) {
      throw new TinyOfficeUpdateUnavailableError(status.installation.reason);
    }
    return await this.options.updateExecutor.start({ targetRelease: status.release.approved });
  }

  private async readLocalPiManifest(): Promise<TinyOfficeUpdateManifest> {
    const manifest = JSON.parse(await readFile(path.join(this.options.repoRoot, "updates", "stable.json"), "utf8")) as TinyOfficeUpdateManifest;
    validatePiManifest(manifest);
    return manifest;
  }

  private async readPackageState(): Promise<{ tinyOfficeVersion: string; piVersion: string }> {
    const rootPackage = JSON.parse(await readFile(path.join(this.options.repoRoot, "package.json"), "utf8")) as { version?: unknown };
    const piPackage = JSON.parse(await readFile(path.join(this.options.repoRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), "utf8")) as { version?: unknown };
    if (typeof rootPackage.version !== "string" || typeof piPackage.version !== "string") throw new Error("TinyOffice or PI package version is unavailable");
    return { tinyOfficeVersion: rootPackage.version, piVersion: piPackage.version };
  }

  private async readInstalledRelease(tinyOfficeVersion: string): Promise<TinyOfficeReleaseIdentity> {
    try {
      const release = JSON.parse(await readFile(path.join(this.options.repoRoot, "RELEASE.json"), "utf8")) as Record<string, unknown>;
      if (release.schema !== "tinyoffice-production-release" || typeof release.releaseId !== "string" || typeof release.gitCommit !== "string" || typeof release.tinyOfficeVersion !== "string") throw new Error("invalid RELEASE.json");
      return { releaseId: release.releaseId, tinyOfficeVersion: release.tinyOfficeVersion, gitCommit: release.gitCommit };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { releaseId: "development", tinyOfficeVersion, gitCommit: "development" };
      throw error;
    }
  }

  private async readInstalledPiModels(): Promise<string[]> {
    const piPackageRoot = path.join(this.options.repoRoot, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist");
    const providerCatalog = path.join(piPackageRoot, "providers", "openai-codex.models.js");
    const legacyCatalog = path.join(piPackageRoot, "models.generated.js");
    let source: string;
    try { source = await readFile(providerCatalog, "utf8"); } catch { source = await readFile(legacyCatalog, "utf8"); }
    return uniqueSorted([...source.matchAll(/\bid:\s*["']([^"']+)["']/g)].map((match) => `openai-codex/${match[1]}`));
  }

  private async fetchJson<T>(url: string): Promise<T> {
    for (let attempt = 1; attempt <= UPDATE_SOURCE_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(UPDATE_SOURCE_TIMEOUT_MS),
        });
      } catch (error) {
        if (attempt < UPDATE_SOURCE_ATTEMPTS) continue;
        throw error;
      }
      if (!response.ok) {
        if (attempt < UPDATE_SOURCE_ATTEMPTS && isRetryableUpdateSourceStatus(response.status)) continue;
        throw new Error(`${response.status} ${response.statusText}`.trim());
      }
      return await response.json() as T;
    }
    throw new Error("Update source request exhausted without a result");
  }
}

function isRetryableUpdateSourceStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function validateReleaseManifest(value: TinyOfficeReleaseChannelManifest): void {
  if (value?.schema !== "tinyoffice-release-channel" || value.version !== 1 || value.channel !== "stable") throw new Error("unsupported TinyOffice Release manifest");
  const release = value.release;
  if (!release?.releaseId || !isSemver(release.tinyOfficeVersion) || !/^[0-9a-f]{40}$/i.test(release.gitCommit) || !/^\d+\.\d+\.\d+$/.test(release.minimumNodeVersion)) throw new Error("TinyOffice Release manifest is incomplete");
  const expectedReleaseId = `${release.tinyOfficeVersion}-${release.gitCommit.slice(0, 12)}`;
  if (release.releaseId !== expectedReleaseId || !isSafeReleaseId(release.releaseId)) throw new Error("TinyOffice Release identity is invalid");
  const expectedArtifactName = `tinyoffice-${release.releaseId}.tgz`;
  if (release.artifact?.fileName !== expectedArtifactName || !/^https:\/\//.test(release.artifact.url) || !/^[0-9a-f]{64}$/i.test(release.artifact.sha256)) throw new Error("TinyOffice Release artifact is invalid");
  if (!Array.isArray(release.notes) || !release.notes.every((note) => typeof note === "string")) throw new Error("TinyOffice Release notes are invalid");
}

function validatePiManifest(value: TinyOfficeUpdateManifest): void {
  if (value?.schema !== "tinyoffice-update-manifest" || value.version !== 1 || value.channel !== "stable") throw new Error("unsupported TinyOffice update manifest");
  if (value.pi?.packageName !== PI_PACKAGE || !value.pi.approvedVersion || !value.pi.minimumNodeVersion || !Array.isArray(value.pi.models)) throw new Error("TinyOffice update manifest is incomplete");
  if (!isSemver(value.pi.approvedVersion) || !/^\d+\.\d+\.\d+$/.test(value.pi.minimumNodeVersion)) throw new Error("TinyOffice update manifest contains invalid versions");
  if (!value.pi.models.every((model) => typeof model === "string" && /^[a-z0-9-]+\/[A-Za-z0-9._-]+$/.test(model))) throw new Error("TinyOffice update manifest contains invalid model references");
}

function resolveReleaseState(input: { deploymentMode: string; installedRelease: TinyOfficeReleaseIdentity; approvedRelease?: TinyOfficeReleaseChannelManifest["release"]; compatible: boolean; releaseManifestFresh: boolean }): TinyOfficeUpdateStatus["release"]["state"] {
  if (input.deploymentMode !== "production" || input.installedRelease.releaseId === "development") return "development";
  if (!input.releaseManifestFresh || !input.approvedRelease) return "check_failed";
  if (input.approvedRelease.releaseId === input.installedRelease.releaseId) return "up_to_date";
  if (compareVersions(input.approvedRelease.tinyOfficeVersion, input.installedRelease.tinyOfficeVersion) <= 0) return "up_to_date";
  if (!input.compatible) return "blocked";
  return "ready_to_install";
}

function updatePiState(input: { approvedComparison: number; npmComparison: number; npmChecked: boolean; compatible: boolean; approvalManifestFresh: boolean }): TinyOfficeUpdateStatus["pi"]["state"] {
  if (!input.npmChecked || !input.approvalManifestFresh) return "check_failed";
  if (input.approvedComparison > 0) return input.compatible ? "ready_to_install" : "blocked";
  if (input.npmComparison > 0) return "upstream_available";
  return "up_to_date";
}

function installationReason(input: { releaseState: TinyOfficeUpdateStatus["release"]["state"]; compatible: boolean; executorConfigured: boolean; approvedRelease?: TinyOfficeReleaseChannelManifest["release"] }): string {
  if (input.releaseState === "development") return "Application updates are installed only on immutable production Releases.";
  if (input.releaseState === "up_to_date") return "The approved TinyOffice Release is already installed.";
  if (input.releaseState === "check_failed") return "The stable TinyOffice Release could not be checked.";
  if (!input.compatible) return "Upgrade Node.js to the required version before installing this Release.";
  if (!input.executorConfigured) return `TinyOffice ${input.approvedRelease?.tinyOfficeVersion ?? "Release"} is approved, but this host has no external updater configured.`;
  return `Back up TinyOffice, install ${input.approvedRelease?.releaseId ?? "the approved Release"}, restart, and verify readiness.`;
}

export function compareVersions(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = a.core[index] - b.core[index];
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart.localeCompare(rightPart) > 0 ? 1 : -1;
  }
  return 0;
}
function parseSemver(value: string): { core: [number, number, number]; prerelease: string[] } {
  const match = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`Invalid semantic version: ${value}`);
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split(".") ?? [] };
}
function isSemver(value: string): boolean { try { parseSemver(value); return true; } catch { return false; } }
function isSafeReleaseId(value: string): boolean { return /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/.test(value); }
function uniqueSorted(values: string[]): string[] { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
