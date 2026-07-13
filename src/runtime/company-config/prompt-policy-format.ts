import { createHash } from "node:crypto";

import { normalizeCompanyId } from "./company-paths.js";
import {
  SCENES,
  TEMPLATE_IDS,
  type PromptBlockScene,
  type PromptBlocksConfig,
  type PromptPolicyCompanyOptions,
  type PromptPolicyTemplateId,
} from "./prompt-policy-model.js";

export function resolvePromptPolicyCompanyId(options: PromptPolicyCompanyOptions): string {
  return normalizeCompanyId(options.companyId);
}

export function normalizePromptBlocksConfig(value: unknown): PromptBlocksConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("prompt-blocks config must be a JSON object.");
  }
  const candidate = value as {
    version?: unknown;
    always?: unknown;
    scenes?: unknown;
  };
  if (candidate.version !== 1) {
    throw new Error("prompt-blocks config requires version=1.");
  }
  const scenesValue = candidate.scenes || {};
  if (!scenesValue || typeof scenesValue !== "object" || Array.isArray(scenesValue)) {
    throw new Error("prompt-blocks config scenes must be an object.");
  }
  const scenesRecord = scenesValue as Record<string, unknown>;
  for (const scene of Object.keys(scenesRecord)) {
    if (!SCENES.includes(scene as PromptBlockScene)) {
      throw new Error(`prompt-blocks config has unknown scene ${scene}.`);
    }
  }
  return {
    version: 1,
    always: normalizePathArray(candidate.always, "always"),
    scenes: {
      dm_thread: normalizePathArray(scenesRecord.dm_thread, "dm_thread"),
      channel_thread: normalizePathArray(scenesRecord.channel_thread, "channel_thread"),
      intake_event: normalizePathArray(scenesRecord.intake_event, "intake_event"),
      work_run_execution: normalizePathArray(scenesRecord.work_run_execution, "work_run_execution"),
    },
  };
}

export function validatePromptBlocksConfig(
  config: PromptBlocksConfig,
  _repoRoot: string,
  availablePaths: string[],
): PromptBlocksConfig {
  assertNoDuplicateMountedBlocks(config);
  const available = new Set(availablePaths);
  return {
    version: 1,
    always: validateBlockPaths(config.always, available),
    scenes: {
      dm_thread: validateBlockPaths(config.scenes.dm_thread, available),
      channel_thread: validateBlockPaths(config.scenes.channel_thread, available),
      intake_event: validateBlockPaths(config.scenes.intake_event, available),
      work_run_execution: validateBlockPaths(config.scenes.work_run_execution, available),
    },
  };
}

export function validatePromptBlockId(value: string): string {
  const normalized = normalizeRepoRelativePath(value);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(normalized)) {
    throw new Error(`Prompt block id is invalid: ${value}`);
  }
  return normalized;
}

export function validatePromptPolicyTemplateId(value: unknown): PromptPolicyTemplateId {
  if (typeof value !== "string") {
    throw new Error("prompt template id is required.");
  }
  const normalized = value.trim();
  if (!(TEMPLATE_IDS as readonly string[]).includes(normalized)) {
    throw new Error(`Unknown prompt template id: ${value}.`);
  }
  return normalized as PromptPolicyTemplateId;
}

export function normalizePromptBlockTitle(value: unknown, blockPath: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("prompt block title must be a string.");
  }
  const trimmed = value.trim();
  return trimmed || blockPath;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function buildPreview(content: string): string {
  const normalized = content
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("# "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function assertNoDuplicateMountedBlocks(config: PromptBlocksConfig): void {
  const seen = new Map<string, string>();
  const groups: Array<{ label: string; paths: string[] }> = [
    { label: "always", paths: config.always },
    ...SCENES.map((scene) => ({ label: scene, paths: config.scenes[scene] })),
  ];
  for (const group of groups) {
    for (const blockPath of group.paths) {
      const normalized = normalizeRepoRelativePath(blockPath);
      const previous = seen.get(normalized);
      if (previous) {
        throw new Error(`Duplicate prompt block ${normalized} mounted by both ${previous} and ${group.label}.`);
      }
      seen.set(normalized, group.label);
    }
  }
}

function validateBlockPaths(paths: string[], available: Set<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const blockPath of paths) {
    const normalized = validatePromptBlockId(blockPath);
    if (!available.has(normalized)) {
      throw new Error(`Prompt block id does not exist: ${blockPath}`);
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function normalizePathArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`prompt-blocks config ${label} must be an array of block ids.`);
  }
  return value;
}

function normalizeRepoRelativePath(value: string): string {
  return value.trim();
}
