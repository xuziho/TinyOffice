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
  SystemAiChatTopicSummaryGenerationProvider,
  SystemAiChatTopicSummaryGenerationRequest,
} from "./chat-topic-summary-generation.js";
import type { SystemAiProviderConfigRecord } from "./provider-config.js";

export interface PiChatTopicSummaryPromptInput {
  modelProvider: string;
  modelId: string;
  systemPrompt: string;
  prompt: string;
  tools: string[];
}

export interface PiChatTopicSummaryGenerationProviderConfig {
  modelRef?: string;
  repoRoot?: string;
  runPrompt?: (input: PiChatTopicSummaryPromptInput) => Promise<string>;
}

const TOPIC_SUMMARY_SYSTEM_PROMPT = [
  "You are TinyOffice's system-level Chat topic summarizer.",
  "Only output the updated topic summary.",
  "Do not explain, do not add markdown, and do not invent facts.",
  "Summarize the durable collaboration state, decisions, open questions, owners, and next handoff context.",
  "Prefer the same language as the topic messages.",
  "Keep the summary concise enough to prepend before the latest raw messages in a future AI turn.",
].join("\n");

function parseModelRef(modelRef: string): { provider: string; id: string } {
  const [provider, ...idParts] = modelRef.trim().split("/");
  const id = idParts.join("/");
  if (!provider || !id) {
    throw new Error("System AI PI modelRef must use provider/model format.");
  }
  return { provider, id };
}

function cleanGeneratedSummary(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("System AI PI topic summary provider returned an empty summary.");
  }
  return trimmed.slice(0, 2400);
}

function buildPrompt(request: SystemAiChatTopicSummaryGenerationRequest): string {
  const messageLines = request.sourceMessages.map((message) =>
    [
      `- messageId: ${message.messageId}`,
      `  createdAt: ${message.createdAt}`,
      `  sender: ${message.senderDisplayName || "unknown"}`,
      `  body: ${message.body}`,
    ].join("\n")
  );
  return [
    "Existing topic summary:",
    request.existingSummary || "(none)",
    "",
    "Latest raw messages:",
    ...messageLines,
  ].join("\n");
}

async function runPiPrompt(input: PiChatTopicSummaryPromptInput & { repoRoot?: string }): Promise<string> {
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, path.join(agentDir, "models.json"));
  const model = modelRegistry.find(input.modelProvider, input.modelId);
  if (!model) {
    throw new Error(
      `System AI topic summary model ${input.modelProvider}/${input.modelId} is not available in the local PI configuration.`,
    );
  }
  const cwd = input.repoRoot || process.cwd();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noContextFiles: true,
    noSkills: true,
    systemPromptOverride: () => input.systemPrompt,
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
    sessionManager: SessionManager.inMemory(cwd),
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

export class PiChatTopicSummaryGenerationProvider implements SystemAiChatTopicSummaryGenerationProvider {
  readonly providerKind = "pi_model" as const;

  private readonly defaultModelRef: string | undefined;
  private readonly repoRoot: string | undefined;
  private readonly runPrompt: (input: PiChatTopicSummaryPromptInput) => Promise<string>;

  constructor(config: PiChatTopicSummaryGenerationProviderConfig) {
    this.defaultModelRef = config.modelRef?.trim() || undefined;
    if (this.defaultModelRef) {
      parseModelRef(this.defaultModelRef);
    }
    this.repoRoot = config.repoRoot;
    this.runPrompt = config.runPrompt || ((input) => runPiPrompt({ ...input, repoRoot: this.repoRoot }));
  }

  async generateSummary(
    request: SystemAiChatTopicSummaryGenerationRequest,
    providerConfig?: SystemAiProviderConfigRecord,
  ): Promise<{ summary: string }> {
    const model = parseModelRef(providerConfig?.modelRef || this.defaultModelRef || "");
    const output = await this.runPrompt({
      modelProvider: model.provider,
      modelId: model.id,
      systemPrompt: TOPIC_SUMMARY_SYSTEM_PROMPT,
      prompt: buildPrompt(request),
      tools: [],
    });
    return { summary: cleanGeneratedSummary(output) };
  }
}
