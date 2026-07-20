import path from "node:path";

import type {
  ExtensionFactory,
  InlineExtension,
  LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";

import collaborationActionsExtension from "../../collaboration/pi/collaboration-actions-extension.js";
import { DefaultResourceLoader } from "./pi-coding-agent-sdk.js";

export interface EmployeeResourceLoaderInput {
  cwd: string;
  agentDir: string;
  repoRoot: string;
  skillPaths: string[];
  systemPrompt: string;
  appendSystemPrompt: string[];
}

export interface SystemAiResourceLoaderInput {
  cwd: string;
  agentDir: string;
  systemPrompt: string;
}

export interface ApprovedRuntimeExtension {
  id: string;
  relativePath?: string;
  factory?: ExtensionFactory;
  expectedToolNames: string[];
}

export const APPROVED_RUNTIME_EXTENSIONS: readonly ApprovedRuntimeExtension[] = [
  {
    id: "tinyoffice-tool-guard",
    relativePath: "packages/pi-tool-guard/src/index.ts",
    expectedToolNames: [],
  },
  {
    id: "tinyoffice-webfetch",
    relativePath: "packages/pi-web-tools/extensions/webfetch.ts",
    expectedToolNames: ["webfetch"],
  },
  {
    id: "tinyoffice-websearch",
    relativePath: "packages/pi-web-tools/extensions/websearch.ts",
    expectedToolNames: ["websearch"],
  },
  {
    id: "tinyoffice-collaboration-actions",
    factory: collaborationActionsExtension,
    expectedToolNames: [
      "finish_intake_turn",
      "finish_work_turn",
      "handoff_topic_turn",
      "recall_memory",
      "tinyoffice_capability_call",
      "tinyoffice_capability_describe",
      "tinyoffice_capability_list",
    ],
  },
  {
    id: "tinyoffice-context-harness",
    relativePath: "packages/pi-context-harness/src/index.ts",
    expectedToolNames: [],
  },
];

function approvedExtensionFactories(): InlineExtension[] {
  return APPROVED_RUNTIME_EXTENSIONS.flatMap((extension) =>
    extension.factory
      ? [{ name: extension.id, factory: extension.factory }]
      : []
  );
}

function approvedExtensionPaths(repoRoot: string): string[] {
  return APPROVED_RUNTIME_EXTENSIONS.flatMap((extension) =>
    extension.relativePath
      ? [path.resolve(repoRoot, extension.relativePath)]
      : []
  );
}

export function createEmployeeResourceLoader(
  input: EmployeeResourceLoaderInput,
): DefaultResourceLoader {
  return new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.agentDir,
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalExtensionPaths: approvedExtensionPaths(input.repoRoot),
    additionalSkillPaths: input.skillPaths,
    extensionFactories: approvedExtensionFactories(),
    systemPromptOverride: () => input.systemPrompt,
    appendSystemPromptOverride: () => input.appendSystemPrompt,
  });
}

export function createSystemAiResourceLoader(
  input: SystemAiResourceLoaderInput,
): DefaultResourceLoader {
  return new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.agentDir,
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPromptOverride: () => input.systemPrompt,
  });
}

export function assertApprovedRuntimeExtensions(
  result: LoadExtensionsResult,
  repoRoot: string,
): void {
  if (result.errors.length > 0) {
    const details = result.errors
      .map((error) => `${error.path}: ${error.error}`)
      .join("; ");
    throw new Error(`TinyOffice approved PI extensions failed to load: ${details}`);
  }

  const extensionsByPath = new Map(
    result.extensions.map((extension) => [extension.resolvedPath, extension]),
  );
  const expectedPaths = APPROVED_RUNTIME_EXTENSIONS
    .map((extension) => extension.relativePath
      ? path.resolve(repoRoot, extension.relativePath)
      : `<inline:${extension.id}>`)
    .sort();
  const actualPaths = result.extensions
    .map((extension) => extension.resolvedPath)
    .sort();
  if (actualPaths.join("\n") !== expectedPaths.join("\n")) {
    throw new Error(
      `TinyOffice PI extension isolation mismatch. Expected ${expectedPaths.join(", ")}; loaded ${actualPaths.join(", ") || "none"}.`,
    );
  }

  for (const approved of APPROVED_RUNTIME_EXTENSIONS) {
    const extensionPath = approved.relativePath
      ? path.resolve(repoRoot, approved.relativePath)
      : `<inline:${approved.id}>`;
    const loaded = extensionsByPath.get(extensionPath);
    if (!loaded) {
      throw new Error(`TinyOffice approved PI extension did not load: ${approved.id}.`);
    }
    for (const toolName of approved.expectedToolNames) {
      if (!loaded.tools.has(toolName)) {
        throw new Error(
          `TinyOffice approved PI extension ${approved.id} did not register expected tool ${toolName}.`,
        );
      }
    }
  }
}
