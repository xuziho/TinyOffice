import { randomUUID } from "node:crypto";

import type { ConversationDto } from "../collaboration/contracts/conversation-message-contract.js";
import {
  SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
  type SystemAiAuditProviderReference,
  type SystemAiAuditRepository,
  type SystemAiAuditSource,
  type SystemAiAuditStatus,
  type SystemAiProviderConfigRecord,
  type SystemAiProviderConfigResolver,
  type SystemAiProviderKind,
} from "./provider-config.js";

export interface SystemAiChatTopicSummarySourceMessage {
  messageId: string;
  senderDisplayName?: string;
  body: string;
  createdAt: string;
}

export interface SystemAiChatTopicSummaryGenerationRequest {
  companyId: string;
  topicId: string;
  roomId: string;
  sourceMessages: SystemAiChatTopicSummarySourceMessage[];
  existingSummary?: string;
}

export interface SystemAiChatTopicSummaryGenerationProvider {
  providerKind: SystemAiProviderKind;
  generateSummary(
    request: SystemAiChatTopicSummaryGenerationRequest,
    providerConfig: SystemAiProviderConfigRecord,
  ): Promise<{ summary: string }>;
}

export interface SystemAiChatTopicSummaryStore {
  updateConversationTopicSummary(
    companyId: string,
    conversationId: string,
    input: {
      text: string;
      sourceMessageId?: string;
    },
  ): Promise<ConversationDto>;
}

function trimRequired(value: string | undefined, fieldName: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function normalizeRequest(input: SystemAiChatTopicSummaryGenerationRequest): SystemAiChatTopicSummaryGenerationRequest {
  const sourceMessages = input.sourceMessages.map((message, index) => ({
    messageId: trimRequired(message.messageId, `sourceMessages[${index}].messageId`),
    senderDisplayName: message.senderDisplayName?.trim() || undefined,
    body: trimRequired(message.body, `sourceMessages[${index}].body`),
    createdAt: trimRequired(message.createdAt, `sourceMessages[${index}].createdAt`),
  }));
  if (sourceMessages.length === 0) {
    throw new Error("sourceMessages is required");
  }
  return {
    companyId: trimRequired(input.companyId, "companyId"),
    topicId: trimRequired(input.topicId, "topicId"),
    roomId: trimRequired(input.roomId, "roomId"),
    sourceMessages,
    existingSummary: input.existingSummary?.trim() || undefined,
  };
}

function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() || "System AI topic summary generation failed";
}

export class SystemAiChatTopicSummaryGenerationService {
  private readonly providers: Map<SystemAiProviderKind, SystemAiChatTopicSummaryGenerationProvider>;
  private readonly providerConfigService: SystemAiProviderConfigResolver;
  private readonly auditRepository: SystemAiAuditRepository;
  private readonly store: SystemAiChatTopicSummaryStore;
  private readonly createRequestId: () => string;
  private readonly createAuditEventId: () => string;
  private readonly now: () => string;
  private readonly queue: Array<{ requestId: string; request: SystemAiChatTopicSummaryGenerationRequest }> = [];

  constructor(config: {
    providers: SystemAiChatTopicSummaryGenerationProvider[];
    providerConfigService: SystemAiProviderConfigResolver;
    auditRepository: SystemAiAuditRepository;
    createRequestId?: () => string;
    createAuditEventId?: () => string;
    now?: () => string;
    store: SystemAiChatTopicSummaryStore;
  }) {
    this.providers = new Map(config.providers.map((provider) => [provider.providerKind, provider]));
    this.providerConfigService = config.providerConfigService;
    this.auditRepository = config.auditRepository;
    this.createRequestId = config.createRequestId || (() => `system-ai-request-${randomUUID()}`);
    this.createAuditEventId = config.createAuditEventId || (() => `system-ai-audit-${randomUUID()}`);
    this.now = config.now || (() => new Date().toISOString());
    this.store = config.store;
  }

  requestTopicSummaryGeneration(request: SystemAiChatTopicSummaryGenerationRequest): void {
    this.queue.push({
      requestId: trimRequired(this.createRequestId(), "requestId"),
      request: normalizeRequest(request),
    });
  }

  pendingCount(): number {
    return this.queue.length;
  }

  async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) {
        continue;
      }
      await this.process(item.requestId, item.request);
    }
  }

  private async process(requestId: string, request: SystemAiChatTopicSummaryGenerationRequest): Promise<void> {
    let providerConfig: SystemAiProviderConfigRecord | undefined;
    let requestedRecorded = false;
    try {
      providerConfig = await this.providerConfigService.requireEnabledProviderConfig({
        companyId: request.companyId,
        capability: SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
      });
      await this.recordAuditEvent(requestId, request, "requested", providerConfig);
      requestedRecorded = true;
      const generated = await this.providerFor(providerConfig.providerKind).generateSummary(request, providerConfig);
      const summary = trimRequired(generated.summary, "generated summary");
      await this.store.updateConversationTopicSummary(request.companyId, request.roomId, {
        text: summary,
        sourceMessageId: request.sourceMessages.at(-1)?.messageId,
      });
      await this.recordAuditEvent(requestId, request, "generated", providerConfig);
    } catch (error) {
      if (!requestedRecorded) {
        await this.recordAuditEvent(requestId, request, "requested", providerConfig);
      }
      await this.recordAuditEvent(requestId, request, "failed", providerConfig, failureReason(error));
    }
  }

  private providerFor(providerKind: SystemAiProviderKind): SystemAiChatTopicSummaryGenerationProvider {
    const provider = this.providers.get(providerKind);
    if (!provider) {
      throw new Error(`System AI provider is not registered for ${providerKind}`);
    }
    return provider;
  }

  private async recordAuditEvent(
    requestId: string,
    request: SystemAiChatTopicSummaryGenerationRequest,
    status: SystemAiAuditStatus,
    providerConfig?: SystemAiProviderConfigRecord,
    errorReason?: string,
  ): Promise<void> {
    await this.auditRepository.recordEvent({
      eventId: trimRequired(this.createAuditEventId(), "auditEventId"),
      companyId: request.companyId,
      capability: SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
      requestId,
      source: auditSource(request),
      provider: providerConfig ? auditProvider(providerConfig) : undefined,
      status,
      errorReason,
      occurredAt: this.now(),
    });
  }
}

export class DeterministicChatTopicSummaryGenerationProvider implements SystemAiChatTopicSummaryGenerationProvider {
  readonly providerKind = "test_deterministic" as const;

  async generateSummary(request: SystemAiChatTopicSummaryGenerationRequest): Promise<{ summary: string }> {
    const text = request.sourceMessages
      .map((message) => message.body.replace(/[^\p{L}\p{N}\s.!?-]/gu, " "))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    return { summary: text };
  }
}

function auditSource(request: SystemAiChatTopicSummaryGenerationRequest): SystemAiAuditSource {
  return {
    objectKind: "conversation_topic",
    objectId: request.topicId,
    roomId: request.roomId,
    evidence: request.sourceMessages.map((message) => ({
      objectKind: "message",
      objectId: message.messageId,
    })),
  };
}

function auditProvider(config: SystemAiProviderConfigRecord): SystemAiAuditProviderReference {
  return {
    providerKind: config.providerKind,
    configRef: config.configRef,
    modelRef: config.modelRef,
    configVersion: config.configVersion,
  };
}
