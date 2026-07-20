import type {
  TinyOfficeReleaseChannelManifest,
  TinyOfficeUpdateManifest,
} from "../../api/contracts/tinyoffice-frontend-api-contracts.js";

export const DEFAULT_PI_APPROVAL_MANIFEST_URL = "https://api.github.com/repos/xuziho/TinyOffice/contents/updates/stable.json?ref=main";
export const DEFAULT_RELEASE_MANIFEST_URL = "https://api.github.com/repos/xuziho/TinyOffice/releases/latest";

const RELEASE_MANIFEST_ASSET_NAME = "tinyoffice-stable.json";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_ATTEMPTS = 2;
const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "TinyOffice-update-check",
} as const;

type UpdateSourceOptions = {
  fetchImpl: typeof globalThis.fetch;
  directManifestUrl?: string;
  timeoutMs?: number;
  attempts?: number;
};

export async function loadPiApprovalManifestFromSource(options: UpdateSourceOptions): Promise<TinyOfficeUpdateManifest> {
  if (options.directManifestUrl) {
    return await fetchJson<TinyOfficeUpdateManifest>(options.directManifestUrl, options);
  }
  const file = await fetchJson<GithubContentsFile>(DEFAULT_PI_APPROVAL_MANIFEST_URL, options, GITHUB_API_HEADERS);
  if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
    throw new Error("GitHub PI approval manifest response is incomplete");
  }
  return JSON.parse(Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8")) as TinyOfficeUpdateManifest;
}

export async function loadReleaseManifestFromSource(options: UpdateSourceOptions): Promise<TinyOfficeReleaseChannelManifest> {
  if (options.directManifestUrl) {
    return await fetchJson<TinyOfficeReleaseChannelManifest>(options.directManifestUrl, options);
  }
  const release = await fetchJson<GithubRelease>(DEFAULT_RELEASE_MANIFEST_URL, options, GITHUB_API_HEADERS);
  const manifestAsset = release.assets?.find((asset) => asset.name === RELEASE_MANIFEST_ASSET_NAME);
  if (!manifestAsset?.url) throw new Error(`GitHub Release does not contain ${RELEASE_MANIFEST_ASSET_NAME}`);
  return await fetchJson<TinyOfficeReleaseChannelManifest>(manifestAsset.url, options, {
    ...GITHUB_API_HEADERS,
    Accept: "application/octet-stream",
  });
}

export async function fetchJson<T>(
  url: string,
  options: Pick<UpdateSourceOptions, "fetchImpl" | "timeoutMs" | "attempts">,
  headers: HeadersInit = { Accept: "application/json" },
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response;
    try {
      response = await options.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt < attempts) continue;
      throw error;
    }
    if (!response.ok) {
      if (attempt < attempts && isRetryableUpdateSourceStatus(response.status)) continue;
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    return await response.json() as T;
  }
  throw new Error("Update source request exhausted without a result");
}

type GithubContentsFile = {
  type?: unknown;
  encoding?: unknown;
  content?: unknown;
};

type GithubRelease = {
  assets?: Array<{ name?: string; url?: string }>;
};

function isRetryableUpdateSourceStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
