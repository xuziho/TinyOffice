export type PromptBlockScene = "dm_thread" | "channel_thread" | "intake_event" | "work_run_execution";
export type PromptPolicyTemplateId = "base-system-prompt" | "runtime-prompt-template";

export interface PromptBlocksConfig {
  version: 1;
  always: string[];
  scenes: Record<PromptBlockScene, string[]>;
}

export interface AvailablePromptBlock {
  path: string;
  title: string;
  sha256: string;
  preview: string;
  content: string;
}

export interface PromptPolicyTemplateViewModel {
  id: PromptPolicyTemplateId;
  label: string;
  description: string;
  content: string;
  defaultContent: string;
  variableHints: string[];
}

export interface PromptBlocksAdminState {
  config: PromptBlocksConfig;
  availableBlocks: AvailablePromptBlock[];
}

export interface PromptPolicyBlockUsage {
  scene: PromptBlockScene;
  label: string;
  source: "runtime_default" | "configured_scene" | "always";
}

export interface PromptPolicyBlockViewModel extends AvailablePromptBlock {
  loadedBy: PromptPolicyBlockUsage[];
}

export interface PromptPolicyBlockRef extends AvailablePromptBlock {
  mount: "always" | PromptBlockScene;
}

export interface PromptPolicySceneViewModel {
  id: PromptBlockScene;
  label: string;
  purpose: string;
  alwaysBlocks: PromptPolicyBlockRef[];
  sceneBlocks: PromptPolicyBlockRef[];
  effectiveBlockPaths: string[];
  effectivePrompt: string;
}

export interface PromptPolicyDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
  scene?: PromptBlockScene;
}

export interface PromptPolicyViewModel {
  contract: {
    name: "prompt-policy";
    version: 1;
    boundary: "scene-runtime-contract";
  };
  routes: {
    htmlPath: string;
    viewModelJsonPath: string;
    saveBlockPath: string;
    resetBlockPath: string;
    saveTemplatePath: string;
    resetTemplatePath: string;
  };
  config: PromptBlocksConfig;
  templates: PromptPolicyTemplateViewModel[];
  scenes: PromptPolicySceneViewModel[];
  availableBlocks: PromptPolicyBlockViewModel[];
  diagnostics: {
    errors: PromptPolicyDiagnostic[];
    warnings: PromptPolicyDiagnostic[];
    unmountedBlocks: AvailablePromptBlock[];
  };
}

export interface PromptPolicyCompanyOptions {
  companyId: string;
}

export const SCENES: PromptBlockScene[] = ["dm_thread", "channel_thread", "intake_event", "work_run_execution"];
export const TEMPLATE_IDS: PromptPolicyTemplateId[] = ["base-system-prompt", "runtime-prompt-template"];
export const DEFAULT_PROMPT_BLOCKS_BY_SCENE: Record<PromptBlockScene, string> = {
  dm_thread: "dm-scene",
  channel_thread: "channel-scene",
  intake_event: "intake-event",
  work_run_execution: "workrun-scene",
};
export const DEFAULT_PROMPT_POLICY_BLOCKS: Record<string, { title: string; content: string }> = {
  "channel-scene": {
    title: "Channel Scene",
    content: [
      "# Channel Scene",
      "",
      "You are replying in a channel thread.",
      "",
      "Write the visible assistant reply as normal assistant text.",
      "During this channel turn, call `handoff_topic_turn` exactly once.",
      "Do not skip this handoff, and do not call it more than once.",
      "Set `toId` to exactly one participant id; do not include multiple ids, names, or explanatory text.",
      "Choose `toId` from the Handoff candidates using the current topic, roles, and recent messages.",
      "Do not put the visible reply text in tool arguments.",
    ].join("\r\n"),
  },
  "dm-scene": {
    title: "DM Scene",
    content: "# DM Scene\r\n\r\nYou are replying in a direct-message thread.",
  },
  "intake-event": {
    title: "Intake Scene",
    content: [
      "# Intake Scene",
      "",
      "You are handling an external intake event.",
      "",
      "Finish the intake turn by calling `finish_intake_turn` with the triage outcome.",
      "Use the tool result to create work or record the operating event according to the intake content.",
    ].join("\r\n"),
  },
  "workrun-scene": {
    title: "WorkRun Scene",
    content: [
      "# WorkRun Scene",
      "",
      "You are executing a background WorkRun.",
      "",
      "Finish each WorkRun turn by calling `finish_work_turn`.",
      "Runtime binds the current WorkRun from the session; do not repeat the bound object id.",
      "Use `complete` only after acceptanceCriteria is satisfied and concrete evidence is available.",
      "Use `blocked` when outside input, approval, material, or a decision is needed.",
      "Use `failed` only when the WorkRun cannot be completed.",
    ].join("\r\n"),
  },
};
export const DEFAULT_BASE_SYSTEM_PROMPT_TEMPLATE = [
  "You are an employee in TinyOffice, working inside the company's collaboration and operations system.",
  "",
  "Identity:",
  "- Employee id: {employeeId}",
  "- Display name: {displayName}",
  "- Role: {role}",
  "",
  "Core behavior:",
  "- Act as the current employee, not as a generic assistant.",
  "- Use the current user-visible language unless the runtime provides a different preferred language.",
  "- Prefer direct answers, concrete progress, and useful next steps.",
  "- Do useful work before replying when the request requires investigation, files, tools, or decisions.",
  "",
  "Work boundaries:",
  "- Do not claim work is complete until it has actually been completed or checked.",
  "- If an action requires approval, request approval before performing it and explain the specific action that needs approval.",
].join("\n");
export const DEFAULT_RUNTIME_PROMPT_TEMPLATE = [
  "Runtime Context:",
  "Scene: {sceneType}",
  "",
  "{promptBlocks}",
  "",
  "{contextBlocks}",
  "",
  "User Message:",
  "{userMessage}",
].join("\n");
export const DEFAULT_PROMPT_POLICY_TEMPLATES: Record<
  PromptPolicyTemplateId,
  Omit<PromptPolicyTemplateViewModel, "content" | "defaultContent"> & { content: string }
> = {
  "base-system-prompt": {
    id: "base-system-prompt",
    label: "Base System Prompt",
    description: "Stable employee identity and behavior text used as the base system prompt.",
    variableHints: ["{employeeId}", "{displayName}", "{role}"],
    content: DEFAULT_BASE_SYSTEM_PROMPT_TEMPLATE,
  },
  "runtime-prompt-template": {
    id: "runtime-prompt-template",
    label: "Runtime Prompt Template",
    description: "Wrapper used to assemble scene, runtime context blocks, and the user message.",
    variableHints: ["{sceneType}", "{promptBlocks}", "{contextBlocks}", "{userMessage}"],
    content: DEFAULT_RUNTIME_PROMPT_TEMPLATE,
  },
};
export const SCENE_LABELS: Record<PromptBlockScene, string> = {
  dm_thread: "DM Thread",
  channel_thread: "Channel Thread",
  intake_event: "Intake Event",
  work_run_execution: "WorkRun Execution",
};
export const SCENE_PURPOSES: Record<PromptBlockScene, string> = {
  dm_thread: "Direct employee replies in TinyOffice DM conversations.",
  channel_thread: "Multi-participant TinyOffice Channel/Topic collaboration.",
  intake_event: "External intake triage before planning work.",
  work_run_execution: "Queued WorkRun execution and finish_work_turn completion.",
};

export function emptyPromptBlocksConfig(): PromptBlocksConfig {
  return {
    version: 1,
    always: [],
    scenes: {
      dm_thread: [],
      channel_thread: [],
      intake_event: [],
      work_run_execution: [],
    },
  };
}

export function getDefaultPromptPolicyTemplateContent(templateId: PromptPolicyTemplateId): string {
  return DEFAULT_PROMPT_POLICY_TEMPLATES[templateId].content;
}
