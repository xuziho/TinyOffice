export type RuntimePromptSceneType =
  | "dm_thread"
  | "channel_thread"
  | "intake_event"
  | "work_run_execution"
  | string;

export type RuntimePromptSemanticRole =
  | "user_visible_message"
  | "runtime_context"
  | "channel_thread_context"
  | "intake_event_context"
  | "work_run_context"
  | "system_prompt"
  | "runtime_prompt_package"
  | "tool_policy";

export type RuntimePromptSectionVisibility = "model_input" | "diagnostic";

export interface RuntimePromptBlockSnapshot {
  path: string;
  content: string;
}

export interface RuntimePromptContextBlockInput {
  role: Extract<RuntimePromptSemanticRole, "runtime_context" | "channel_thread_context" | "intake_event_context" | "work_run_context">;
  source: string;
  label: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimePromptToolPolicyInput {
  source: string;
  activeToolNames: string[];
}

export interface RuntimePromptSection {
  semanticRole: RuntimePromptSemanticRole;
  source: string;
  label: string;
  visibility: RuntimePromptSectionVisibility;
  text?: string;
  data?: Record<string, unknown>;
}

export interface CompileRuntimePromptInput {
  sceneType: RuntimePromptSceneType;
  sessionKey: string;
  userVisibleMessage: string;
  runtimePromptTemplate?: string;
  systemPromptAppend?: string;
  promptBlocks?: RuntimePromptBlockSnapshot[];
  contextBlocks?: RuntimePromptContextBlockInput[];
  toolPolicy?: RuntimePromptToolPolicyInput;
}

export interface CompiledRuntimePrompt {
  sceneType: RuntimePromptSceneType;
  sessionKey: string;
  userVisibleMessage: string;
  userPrompt: string;
  systemPromptAppend: string;
  promptBlocks: RuntimePromptBlockSnapshot[];
  activeToolNames: string[];
  sections: RuntimePromptSection[];
  audit: {
    sectionRoles: RuntimePromptSemanticRole[];
    promptBlockPaths: string[];
    activeToolNames: string[];
  };
}

export function compileRuntimePrompt(input: CompileRuntimePromptInput): CompiledRuntimePrompt {
  const systemPromptAppend = input.systemPromptAppend ?? "";
  const promptBlocks = input.promptBlocks ?? [];
  const contextBlocks = input.contextBlocks ?? [];
  const activeToolNames = input.toolPolicy?.activeToolNames ?? [];
  const sections: RuntimePromptSection[] = [];

  if (systemPromptAppend.trim()) {
    sections.push({
      semanticRole: "system_prompt",
      source: "runtime.system_prompt_append",
      label: "System prompt append",
      visibility: "model_input",
      text: systemPromptAppend,
    });
  }

  if (promptBlocks.length > 0) {
    sections.push({
      semanticRole: "runtime_prompt_package",
      source: "runtime.prompt_blocks",
      label: "Runtime prompt package",
      visibility: "model_input",
      data: {
        promptBlockPaths: promptBlocks.map((block) => block.path),
        promptBlockCount: promptBlocks.length,
      },
    });
  }

  if (input.toolPolicy) {
    sections.push({
      semanticRole: "tool_policy",
      source: input.toolPolicy.source,
      label: "Tool policy",
      visibility: "model_input",
      data: { activeToolNames },
    });
  }

  for (const block of contextBlocks) {
    sections.push({
      semanticRole: block.role,
      source: block.source,
      label: block.label,
      visibility: "model_input",
      text: block.text,
      data: block.metadata,
    });
  }

  sections.push({
    semanticRole: "user_visible_message",
    source: "collaboration_surface.user_message",
    label: "User visible message",
    visibility: "model_input",
    text: input.userVisibleMessage,
  });

  return {
    sceneType: input.sceneType,
    sessionKey: input.sessionKey,
    userVisibleMessage: input.userVisibleMessage,
    userPrompt: buildRuntimeUserPrompt(
      input.sceneType,
      promptBlocks,
      contextBlocks,
      input.userVisibleMessage,
      input.runtimePromptTemplate,
    ),
    systemPromptAppend,
    promptBlocks,
    activeToolNames,
    sections,
    audit: {
      sectionRoles: sections.map((section) => section.semanticRole),
      promptBlockPaths: promptBlocks.map((block) => block.path),
      activeToolNames,
    },
  };
}

function buildRuntimeUserPrompt(
  sceneType: RuntimePromptSceneType,
  promptBlocks: RuntimePromptBlockSnapshot[],
  contextBlocks: RuntimePromptContextBlockInput[],
  userVisibleMessage: string,
  runtimePromptTemplate?: string,
): string {
  if (runtimePromptTemplate?.trim()) {
    return renderRuntimePromptTemplate({
      template: runtimePromptTemplate,
      sceneType,
      promptBlocks,
      contextBlocks,
      userVisibleMessage,
    });
  }

  const lines = ["Runtime Context:", `Scene: ${sceneType}`];

  for (const block of promptBlocks) {
    lines.push("", `Prompt Policy: ${block.path}:`, block.content);
  }

  for (const block of contextBlocks) {
    lines.push("", `${block.label}:`, block.text);
  }

  lines.push("", "User Message:", userVisibleMessage);
  return lines.join("\n");
}

function renderContextBlocksSlot(contextBlocks: RuntimePromptContextBlockInput[]): string {
  return contextBlocks
    .map((block) => [`${block.label}:`, block.text].join("\n"))
    .join("\n\n");
}

function renderPromptBlocksSlot(promptBlocks: RuntimePromptBlockSnapshot[]): string {
  return promptBlocks
    .map((block) => [`Prompt Policy: ${block.path}:`, block.content].join("\n"))
    .join("\n\n");
}

function renderRuntimePromptTemplate(input: {
  template: string;
  sceneType: RuntimePromptSceneType;
  promptBlocks: RuntimePromptBlockSnapshot[];
  contextBlocks: RuntimePromptContextBlockInput[];
  userVisibleMessage: string;
}): string {
  const promptBlocks = renderPromptBlocksSlot(input.promptBlocks);
  const rendered = input.template
    .replaceAll("{sceneType}", input.sceneType)
    .replaceAll("{promptBlocks}", promptBlocks)
    .replaceAll("{contextBlocks}", renderContextBlocksSlot(input.contextBlocks))
    .replaceAll("{userMessage}", input.userVisibleMessage)
    .trim();
  if (input.template.includes("{promptBlocks}") || !promptBlocks.trim()) {
    return rendered;
  }
  return [promptBlocks, rendered].join("\n\n").trim();
}
