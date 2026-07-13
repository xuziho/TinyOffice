import path from "node:path";

import {
  AuthStorage,
  createAgentSession,
  DEFAULT_HTTP_IDLE_TIMEOUT_MS,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "../runtime/pi/pi-coding-agent-sdk.js";
import type {
  SystemAiChatTitleGenerationProvider,
  SystemAiChatTitleGenerationRequest,
} from "./chat-title-generation.js";
import type { SystemAiProviderConfigRecord } from "./provider-config.js";

export interface PiChatTitlePromptInput {
  modelProvider: string;
  modelId: string;
  prompt: string;
  tools: string[];
}

export interface PiChatTitleGenerationProviderConfig {
  modelRef?: string;
  repoRoot?: string;
  runPrompt?: (input: PiChatTitlePromptInput) => Promise<string>;
}

const TITLE_SYSTEM_PROMPT = [
  "You are TinyOffice's system-level chat title generator.",
  "Only output the title. Do not explain, add quotes, or output Markdown.",
  "Generate a short, specific, readable topic title from the user's first message.",
  "Prefer the same language as the user's message.",
  "Do not use employee names, channel names, or participant names as title prefixes.",
  "Preserve important product names, file names, error codes, and technical terms.",
  "Keep the title under 30 Chinese characters or 50 English characters.",
].join("\n");

function parseModelRef(modelRef: string): { provider: string; id: string } {
  const [provider, ...idParts] = modelRef.trim().split("/");
  const id = idParts.join("/");
  if (!provider || !id) {
    throw new Error("System AI PI modelRef must use provider/model format.");
  }
  return { provider, id };
}

function cleanGeneratedTitle(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, "")
    .trim();
  if (!trimmed) {
    throw new Error("System AI PI title provider returned an empty title.");
  }
  return trimmed.slice(0, 80);
}

function buildPrompt(request: SystemAiChatTitleGenerationRequest): string {
  return [
    TITLE_SYSTEM_PROMPT,
    "",
    "User's first message:",
    request.sourceMessage.body,
    "",
    "Current placeholder title:",
    request.currentTitle,
  ].join("\n");
}

async function runPiPrompt(input: PiChatTitlePromptInput & { repoRoot?: string }): Promise<string> {
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, path.join(agentDir, "models.json"));
  const model = modelRegistry.find(input.modelProvider, input.modelId);
  if (!model) {
    throw new Error(
      `System AI title model ${input.modelProvider}/${input.modelId} is not available in the local PI configuration.`,
    );
  }
  const cwd = input.repoRoot || process.cwd();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noSkills: true,
    systemPromptOverride: () => TITLE_SYSTEM_PROMPT,
  });
  await resourceLoader.reload();
  const settingsManager = SettingsManager.inMemory({
    httpIdleTimeoutMs: DEFAULT_HTTP_IDLE_TIMEOUT_MS,
  });
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    model,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.continueRecent(cwd, path.join(cwd, ".scratch", "system-ai-title-sessions")),
    tools: input.tools,
  });
  let reply = "";
  const unsubscribe = session.subscribe((event: {
    type?: string;
    assistantMessageEvent?: {
      type?: string;
      delta?: string;
    };
  }) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      reply += event.assistantMessageEvent.delta || "";
    }
  });
  try {
    await session.prompt(input.prompt);
  } finally {
    unsubscribe();
  }
  return reply;
}

export class PiChatTitleGenerationProvider implements SystemAiChatTitleGenerationProvider {
  readonly providerKind = "pi_model" as const;

  private readonly defaultModelRef: string | undefined;
  private readonly repoRoot: string | undefined;
  private readonly runPrompt: (input: PiChatTitlePromptInput) => Promise<string>;

  constructor(config: PiChatTitleGenerationProviderConfig) {
    this.defaultModelRef = config.modelRef?.trim() || undefined;
    if (this.defaultModelRef) {
      parseModelRef(this.defaultModelRef);
    }
    this.repoRoot = config.repoRoot;
    this.runPrompt = config.runPrompt || ((input) => runPiPrompt({ ...input, repoRoot: this.repoRoot }));
  }

  async generateTitle(
    request: SystemAiChatTitleGenerationRequest,
    providerConfig?: SystemAiProviderConfigRecord,
  ): Promise<{ title: string }> {
    const model = parseModelRef(providerConfig?.modelRef || this.defaultModelRef || "");
    const output = await this.runPrompt({
      modelProvider: model.provider,
      modelId: model.id,
      prompt: buildPrompt(request),
      tools: [],
    });
    return { title: cleanGeneratedTitle(output) };
  }
}
