import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { PiPromptImageInput } from "../pi/persistent-pi-employee-agent-contracts.js";
import type { RuntimeImageInput } from "./contracts.js";

function tinyOfficeApiBaseUrl(): string {
  return (
    process.env.TINYOFFICE_API_BASE_URL?.trim() ||
    process.env.TINYOFFICE_RUNTIME_ORIGIN?.trim() ||
    "http://127.0.0.1:8095"
  );
}

export async function preparePiPromptImages(
  imageInputs: RuntimeImageInput[] | undefined,
  options: { repoRoot?: string; apiBaseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<PiPromptImageInput[]> {
  if (!imageInputs?.length) return [];
  return Promise.all(imageInputs.map((image) => preparePiPromptImage(image, options)));
}

async function preparePiPromptImage(
  image: RuntimeImageInput,
  options: { repoRoot?: string; apiBaseUrl?: string; fetchImpl?: typeof fetch },
): Promise<PiPromptImageInput> {
  const bytes = await readRuntimeImageBytes(image, options);
  return { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: image.mimeType };
}

async function readRuntimeImageBytes(
  image: RuntimeImageInput,
  options: { repoRoot?: string; apiBaseUrl?: string; fetchImpl?: typeof fetch },
): Promise<Uint8Array> {
  if (image.storageKey) {
    const repoRoot = path.resolve(options.repoRoot || process.cwd());
    const dataRoot = path.resolve(repoRoot, ".data");
    const targetPath = path.resolve(dataRoot, image.storageKey);
    const relative = path.relative(dataRoot, targetPath);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return readFile(targetPath);
  }

  const url = image.downloadUrl || image.previewUrl;
  if (!url) throw new Error(`Chat image attachment ${image.attachmentId} has no readable content reference.`);
  const response = await (options.fetchImpl || fetch)(new URL(url, options.apiBaseUrl || tinyOfficeApiBaseUrl()));
  if (!response.ok) throw new Error(`Failed to read Chat image attachment ${image.attachmentId}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function appendPiProviderTrace(entry: Record<string, unknown>): Promise<void> {
  const logDir = path.resolve(process.cwd(), ".scratch");
  await mkdir(logDir, { recursive: true });
  await appendFile(path.join(logDir, "pi-provider.jsonl"), `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, "utf8");
}
