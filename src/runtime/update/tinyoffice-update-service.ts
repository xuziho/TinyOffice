import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  TinyOfficeUpdateJob,
  TinyOfficeUpdateManifest,
  TinyOfficeUpdateStatus,
} from "../../api/contracts/tinyoffice-frontend-api-contracts.js";

const PI_PACKAGE = "@earendil-works/pi-coding-agent" as const;
const DEFAULT_NPM_REGISTRY_URL = "https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent/latest";
const DEFAULT_APPROVAL_MANIFEST_URL = "https://raw.githubusercontent.com/xuziho/TinyOffice/main/updates/stable.json";

export interface TinyOfficeUpdateExecutor {
  start(input: { targetPiVersion: string }): TinyOfficeUpdateJob;
}

export class TinyOfficeUpdateUnavailableError extends Error {
  readonly statusCode = 409;
}

export type TinyOfficeUpdateServiceOptions = {
  repoRoot: string;
  fetch?: typeof globalThis.fetch;
  npmRegistryUrl?: string;
  approvalManifestUrl?: string;
  updateExecutor?: TinyOfficeUpdateExecutor;
  now?: () => Date;
  nodeVersion?: string;
};

export class TinyOfficeUpdateService {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly npmRegistryUrl: string;
  private readonly approvalManifestUrl: string;
  private readonly now: () => Date;

  constructor(private readonly options: TinyOfficeUpdateServiceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.npmRegistryUrl = options.npmRegistryUrl ?? process.env.TINYOFFICE_NPM_REGISTRY_URL?.trim() ?? DEFAULT_NPM_REGISTRY_URL;
    this.approvalManifestUrl = options.approvalManifestUrl ?? process.env.TINYOFFICE_UPDATE_MANIFEST_URL?.trim() ?? DEFAULT_APPROVAL_MANIFEST_URL;
    this.now = options.now ?? (() => new Date());
  }

  async loadStatus(): Promise<TinyOfficeUpdateStatus> {
    const warnings: string[] = [];
    const localManifest = await this.readLocalManifest();
    const packageState = await this.readPackageState();
    const installedModels = await this.readInstalledPiModels();
    let manifest = localManifest;
    let approvalManifestSource: "remote" | "local" = "local";
    let npmLatestVersion: string | undefined;

    const [manifestResult, npmResult] = await Promise.allSettled([
      this.fetchJson<TinyOfficeUpdateManifest>(this.approvalManifestUrl),
      this.fetchJson<{ version?: unknown }>(this.npmRegistryUrl),
    ]);
    if (manifestResult.status === "fulfilled") {
      try {
        validateManifest(manifestResult.value);
        manifest = manifestResult.value;
        approvalManifestSource = "remote";
      } catch (error) {
        warnings.push(`Approval manifest could not be refreshed: ${errorMessage(error)}`);
      }
    } else {
      warnings.push(`Approval manifest could not be refreshed: ${errorMessage(manifestResult.reason)}`);
    }

    if (npmResult.status === "fulfilled") {
      if (typeof npmResult.value.version === "string" && npmResult.value.version.trim()) {
        npmLatestVersion = npmResult.value.version.trim();
      } else {
        warnings.push("npm registry could not be checked: npm registry response did not include a version");
      }
    } else {
      warnings.push(`npm registry could not be checked: ${errorMessage(npmResult.reason)}`);
    }

    const nodeVersion = normalizeVersion(this.options.nodeVersion ?? process.versions.node);
    const minimumNodeVersion = normalizeVersion(manifest.pi.minimumNodeVersion);
    const compatible = compareVersions(nodeVersion, minimumNodeVersion) >= 0;
    const approvedComparison = compareVersions(manifest.pi.approvedVersion, packageState.piVersion);
    const npmComparison = npmLatestVersion ? compareVersions(npmLatestVersion, packageState.piVersion) : 0;
    const executorConfigured = Boolean(this.options.updateExecutor);
    const state = updateState({
      approvedComparison,
      npmComparison,
      npmChecked: Boolean(npmLatestVersion),
      compatible,
      approvalManifestFresh: approvalManifestSource === "remote",
    });
    const canInstall = state === "ready_to_install" && executorConfigured;
    const reason = installationReason({ state, compatible, executorConfigured, approvedVersion: manifest.pi.approvedVersion });
    const approvedModels = uniqueSorted(manifest.pi.models);

    return {
      schema: "tinyoffice-update-status",
      version: 1,
      checkedAt: this.now().toISOString(),
      channel: "stable",
      tinyOfficeVersion: packageState.tinyOfficeVersion,
      runtime: { nodeVersion, minimumNodeVersion, compatible },
      pi: {
        packageName: PI_PACKAGE,
        installedVersion: packageState.piVersion,
        ...(npmLatestVersion ? { npmLatestVersion } : {}),
        approvedVersion: manifest.pi.approvedVersion,
        state,
        installedModels,
        approvedModels,
        addedModels: approvedModels.filter((model) => !installedModels.includes(model)),
        removedModels: installedModels.filter((model) => !approvedModels.includes(model)),
      },
      installation: {
        enabled: canInstall,
        reason,
        requiresBackup: true,
        requiresRestart: true,
      },
      sources: {
        npmRegistry: this.npmRegistryUrl,
        approvalManifest: this.approvalManifestUrl,
        approvalManifestSource,
        warnings,
      },
    };
  }

  async startApprovedUpdate(): Promise<TinyOfficeUpdateJob> {
    const status = await this.loadStatus();
    if (!status.installation.enabled || !this.options.updateExecutor) {
      throw new TinyOfficeUpdateUnavailableError(status.installation.reason);
    }
    return this.options.updateExecutor.start({ targetPiVersion: status.pi.approvedVersion });
  }

  private async readLocalManifest(): Promise<TinyOfficeUpdateManifest> {
    const manifest = JSON.parse(await readFile(path.join(this.options.repoRoot, "updates", "stable.json"), "utf8")) as TinyOfficeUpdateManifest;
    validateManifest(manifest);
    return manifest;
  }

  private async readPackageState(): Promise<{ tinyOfficeVersion: string; piVersion: string }> {
    const rootPackage = JSON.parse(await readFile(path.join(this.options.repoRoot, "package.json"), "utf8")) as { version?: unknown };
    const piPackage = JSON.parse(await readFile(path.join(this.options.repoRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), "utf8")) as { version?: unknown };
    if (typeof rootPackage.version !== "string" || typeof piPackage.version !== "string") {
      throw new Error("TinyOffice or PI package version is unavailable");
    }
    return { tinyOfficeVersion: rootPackage.version, piVersion: piPackage.version };
  }

  private async readInstalledPiModels(): Promise<string[]> {
    const piPackageRoot = path.join(this.options.repoRoot, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist");
    const providerCatalog = path.join(piPackageRoot, "providers", "openai-codex.models.js");
    const legacyCatalog = path.join(piPackageRoot, "models.generated.js");
    let source: string;
    try {
      source = await readFile(providerCatalog, "utf8");
    } catch {
      source = await readFile(legacyCatalog, "utf8");
    }
    const ids = [...source.matchAll(/\bid:\s*["']([^"']+)["']/g)].map((match) => match[1]).filter((id): id is string => Boolean(id));
    return uniqueSorted(ids.map((id) => `openai-codex/${id}`));
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const signal = AbortSignal.timeout(8_000);
    const response = await this.fetchImpl(url, { headers: { Accept: "application/json" }, signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    return await response.json() as T;
  }
}

function validateManifest(value: TinyOfficeUpdateManifest): void {
  if (value?.schema !== "tinyoffice-update-manifest" || value.version !== 1 || value.channel !== "stable") {
    throw new Error("unsupported TinyOffice update manifest");
  }
  if (value.pi?.packageName !== PI_PACKAGE || !value.pi.approvedVersion || !value.pi.minimumNodeVersion || !Array.isArray(value.pi.models)) {
    throw new Error("TinyOffice update manifest is incomplete");
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.pi.approvedVersion) || !/^\d+\.\d+\.\d+$/.test(value.pi.minimumNodeVersion)) {
    throw new Error("TinyOffice update manifest contains invalid versions");
  }
  if (!value.pi.models.every((model) => typeof model === "string" && /^[a-z0-9-]+\/[A-Za-z0-9._-]+$/.test(model))) {
    throw new Error("TinyOffice update manifest contains invalid model references");
  }
}

function updateState(input: { approvedComparison: number; npmComparison: number; npmChecked: boolean; compatible: boolean; approvalManifestFresh: boolean }): TinyOfficeUpdateStatus["pi"]["state"] {
  if (!input.npmChecked || !input.approvalManifestFresh) return "check_failed";
  if (input.approvedComparison > 0) return input.compatible ? "ready_to_install" : "blocked";
  if (input.npmComparison > 0) return "upstream_available";
  return "up_to_date";
}

function installationReason(input: { state: TinyOfficeUpdateStatus["pi"]["state"]; compatible: boolean; executorConfigured: boolean; approvedVersion: string }): string {
  if (input.state === "up_to_date") return "The approved PI version is already installed.";
  if (input.state === "upstream_available") return "A newer PI release exists, but TinyOffice has not approved it for installation yet.";
  if (input.state === "check_failed") return "Update sources could not be checked. Try again when the network is available.";
  if (!input.compatible) return "Upgrade Node.js to the required version before installing this update.";
  if (!input.executorConfigured) return `PI ${input.approvedVersion} is approved, but this deployment has no external update executor configured.`;
  return `Back up TinyOffice, install PI ${input.approvedVersion}, verify it, and restart the runtime.`;
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/, "").split("-")[0] ?? value;
}

export function compareVersions(left: string, right: string): number {
  const a = normalizeVersion(left).split(".").map(numberPart);
  const b = normalizeVersion(right).split(".").map(numberPart);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function numberPart(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
