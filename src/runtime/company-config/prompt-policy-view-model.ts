import {
  DEFAULT_PROMPT_BLOCKS_BY_SCENE,
  DEFAULT_PROMPT_POLICY_BLOCKS,
  SCENES,
  SCENE_LABELS,
  SCENE_PURPOSES,
  getDefaultPromptPolicyTemplateContent,
  type AvailablePromptBlock,
  type PromptBlockScene,
  type PromptBlocksAdminState,
  type PromptBlocksConfig,
  type PromptPolicyBlockUsage,
  type PromptPolicyCompanyOptions,
  type PromptPolicyDiagnostic,
  type PromptPolicyViewModel,
} from "./prompt-policy-model.js";
import {
  listAvailablePromptBlocks,
  listPromptPolicyTemplates,
  loadPromptBlocksConfig,
  savePromptBlockContent,
  savePromptBlocksConfig,
  savePromptTemplateRow,
} from "./prompt-policy-persistence.js";
import {
  validatePromptBlockId,
  validatePromptBlocksConfig,
  validatePromptPolicyTemplateId,
} from "./prompt-policy-format.js";

export async function loadPromptBlocksAdminState(
  repoRoot: string,
  options: PromptPolicyCompanyOptions,
): Promise<PromptBlocksAdminState> {
  const [config, availableBlocks] = await Promise.all([
    loadPromptBlocksConfig(repoRoot, options),
    listAvailablePromptBlocks(repoRoot, options),
  ]);
  return {
    config: validatePromptBlocksConfig(config, repoRoot, availableBlocks.map((block) => block.path)),
    availableBlocks,
  };
}

export async function loadPromptPolicyViewModel(
  repoRoot: string,
  options: PromptPolicyCompanyOptions,
): Promise<PromptPolicyViewModel> {
  const [config, availableBlocks, templates] = await Promise.all([
    loadPromptBlocksConfig(repoRoot, options),
    listAvailablePromptBlocks(repoRoot, options),
    listPromptPolicyTemplates(repoRoot, options),
  ]);
  const runtimeConfig = resolveRuntimePromptBlocksConfig(config);
  const diagnostics = auditPromptPolicyConfig(runtimeConfig, availableBlocks);
  const blockByPath = new Map(availableBlocks.map((block) => [block.path, block]));
  const promptPolicyPath = `/api/companies/${encodeURIComponent(options.companyId)}/prompt-policy`;
  const alwaysBlocks = runtimeConfig.always
    .map((blockPath) => blockByPath.get(blockPath))
    .filter((block): block is AvailablePromptBlock => Boolean(block))
    .map((block) => ({ ...block, mount: "always" as const }));
  const usageByPath = buildPromptBlockUsageByPath(config, runtimeConfig);

  return {
    contract: {
      name: "prompt-policy",
      version: 1,
      boundary: "scene-runtime-contract",
    },
    routes: {
      htmlPath: "/config/prompt-policy",
      viewModelJsonPath: promptPolicyPath,
      saveBlockPath: `${promptPolicyPath}/blocks/:blockPath`,
      resetBlockPath: `${promptPolicyPath}/blocks/:blockPath/reset`,
      saveTemplatePath: `${promptPolicyPath}/templates/:templateId`,
      resetTemplatePath: `${promptPolicyPath}/templates/:templateId/reset`,
    },
    config,
    templates,
    scenes: SCENES.map((scene) => {
      const sceneBlocks = runtimeConfig.scenes[scene]
        .map((blockPath) => blockByPath.get(blockPath))
        .filter((block): block is AvailablePromptBlock => Boolean(block))
        .map((block) => ({ ...block, mount: scene }));
      const effectiveBlocks = [...alwaysBlocks, ...sceneBlocks];
      return {
        id: scene,
        label: SCENE_LABELS[scene],
        purpose: SCENE_PURPOSES[scene],
        alwaysBlocks,
        sceneBlocks,
        effectiveBlockPaths: effectiveBlocks.map((block) => block.path),
        effectivePrompt: effectiveBlocks.map((block) => block.content.trim()).filter(Boolean).join("\n\n"),
      };
    }),
    availableBlocks: availableBlocks.map((block) => ({
      ...block,
      loadedBy: usageByPath.get(block.path) || [],
    })),
    diagnostics,
  };
}

export async function savePromptPolicyConfig(input: {
  repoRoot: string;
  config: unknown;
  companyId: string;
}): Promise<PromptPolicyViewModel> {
  await savePromptBlocksConfig(input);
  return loadPromptPolicyViewModel(input.repoRoot, { companyId: input.companyId });
}

export async function savePromptPolicyBlockContent(input: {
  repoRoot: string;
  blockPath: unknown;
  title?: unknown;
  content: unknown;
  companyId: string;
}): Promise<PromptPolicyViewModel> {
  await savePromptBlockContent(input);
  return loadPromptPolicyViewModel(input.repoRoot, { companyId: input.companyId });
}

export async function savePromptPolicyTemplateContent(input: {
  repoRoot: string;
  templateId: unknown;
  content: unknown;
  companyId: string;
}): Promise<PromptPolicyViewModel> {
  const templateId = validatePromptPolicyTemplateId(input.templateId);
  if (typeof input.content !== "string") {
    throw new Error("prompt template content must be a string.");
  }
  await savePromptTemplateRow(input.repoRoot, templateId, input.content, { companyId: input.companyId });
  return loadPromptPolicyViewModel(input.repoRoot, { companyId: input.companyId });
}

export async function resetPromptPolicyTemplateToDefault(input: {
  repoRoot: string;
  templateId: unknown;
  companyId: string;
}): Promise<PromptPolicyViewModel> {
  const templateId = validatePromptPolicyTemplateId(input.templateId);
  await savePromptTemplateRow(input.repoRoot, templateId, getDefaultPromptPolicyTemplateContent(templateId), {
    companyId: input.companyId,
  });
  return loadPromptPolicyViewModel(input.repoRoot, { companyId: input.companyId });
}

export async function resetPromptPolicyBlockToDefault(input: {
  repoRoot: string;
  blockPath: unknown;
  companyId: string;
}): Promise<PromptPolicyViewModel> {
  if (typeof input.blockPath !== "string") {
    throw new Error("prompt block path is required.");
  }
  const blockPath = validatePromptBlockId(input.blockPath);
  const defaults = DEFAULT_PROMPT_POLICY_BLOCKS[blockPath];
  if (!defaults) {
    throw new Error(`No built-in default exists for prompt block ${blockPath}.`);
  }
  await savePromptBlockContent({
    repoRoot: input.repoRoot,
    blockPath,
    title: defaults.title,
    content: defaults.content,
    companyId: input.companyId,
  });
  return loadPromptPolicyViewModel(input.repoRoot, { companyId: input.companyId });
}

function resolveRuntimePromptBlocksConfig(config: PromptBlocksConfig): PromptBlocksConfig {
  return {
    version: 1,
    always: config.always,
    scenes: {
      dm_thread: resolveScenePromptBlockIds(config, "dm_thread"),
      channel_thread: resolveScenePromptBlockIds(config, "channel_thread"),
      intake_event: resolveScenePromptBlockIds(config, "intake_event"),
      work_run_execution: resolveScenePromptBlockIds(config, "work_run_execution"),
    },
  };
}

function resolveScenePromptBlockIds(config: PromptBlocksConfig, scene: PromptBlockScene): string[] {
  return config.scenes[scene];
}

function buildPromptBlockUsageByPath(
  config: PromptBlocksConfig,
  runtimeConfig: PromptBlocksConfig,
): Map<string, PromptPolicyBlockUsage[]> {
  const usageByPath = new Map<string, PromptPolicyBlockUsage[]>();
  const addUsage = (blockPath: string, usage: PromptPolicyBlockUsage) => {
    const existing = usageByPath.get(blockPath) || [];
    if (!existing.some((item) => item.scene === usage.scene && item.source === usage.source)) {
      usageByPath.set(blockPath, [...existing, usage]);
    }
  };

  for (const scene of SCENES) {
    for (const blockPath of runtimeConfig.always) {
      addUsage(blockPath, {
        scene,
        label: `${SCENE_LABELS[scene]} (company-wide)`,
        source: "always",
      });
    }
    for (const blockPath of runtimeConfig.scenes[scene]) {
      addUsage(blockPath, {
        scene,
        label: SCENE_LABELS[scene],
        source: config.scenes[scene].includes(blockPath) ? "configured_scene" : "runtime_default",
      });
    }
  }

  return usageByPath;
}

function auditPromptPolicyConfig(
  config: PromptBlocksConfig,
  availableBlocks: AvailablePromptBlock[],
): PromptPolicyViewModel["diagnostics"] {
  const diagnostics: PromptPolicyDiagnostic[] = [];
  const available = new Set(availableBlocks.map((block) => block.path));
  const seen = new Map<string, string>();
  const groups: Array<{ label: string; scene?: PromptBlockScene; paths: string[] }> = [
    { label: "always", paths: config.always },
    ...SCENES.map((scene) => ({ label: scene, scene, paths: config.scenes[scene] })),
  ];

  for (const group of groups) {
    for (const blockPath of group.paths) {
      const normalized = blockPath.trim();
      if (!available.has(normalized)) {
        diagnostics.push({
          severity: "error",
          code: "dangling_prompt_block",
          message: `Mounted prompt block id does not exist: ${normalized}`,
          path: normalized,
          scene: group.scene,
        });
      }
      const previous = seen.get(normalized);
      if (previous) {
        diagnostics.push({
          severity: "error",
          code: "duplicate_prompt_block",
          message: `Prompt block ${normalized} is mounted by both ${previous} and ${group.label}.`,
          path: normalized,
          scene: group.scene,
        });
      } else {
        seen.set(normalized, group.label);
      }
    }
  }

  for (const scene of SCENES) {
    if (config.scenes[scene].length === 0) {
      diagnostics.push({
        severity: "error",
        code: "missing_scene_prompt_block",
        message: `Prompt Policy scene ${scene} has no configured prompt block.`,
        scene,
      });
    }
  }

  return {
    errors: diagnostics.filter((item) => item.severity === "error"),
    warnings: [],
    unmountedBlocks: [],
  };
}
