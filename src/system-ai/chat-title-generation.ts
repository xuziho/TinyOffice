import { randomUUID } from "node:crypto";

import type { ConversationDto } from "../collaboration/contracts/conversation-message-contract.js";
import type { TinyOfficeRealtimePublisher } from "../collaboration/contracts/tinyoffice-realtime-contract.js";
import {
  SYSTEM_AI_CHAT_TITLE_CAPABILITY,
  type SystemAiAuditProviderReference,
  type SystemAiAuditRepository,
  type SystemAiAuditSource,
  type SystemAiAuditStatus,
  type SystemAiProviderConfigRecord,
  type SystemAiProviderConfigResolver,
  type SystemAiProviderKind,
} from "./provider-config.js";

export type SystemAiChatTitleActorContext =
  | {
      actorKind: "employee";
      employeeId: string;
      displayName?: string;
    }
  | {
      actorKind: "company_member";
      memberId: string;
      displayName?: string;
    };

export interface SystemAiChatTitleGenerationRequest {
  companyId: string;
  chatEntryId: string;
  roomId: string;
  currentTitle: string;
  sourceMessage: {
    messageId: string;
    body: string;
  };
  actor: SystemAiChatTitleActorContext;
}

export interface SystemAiChatTitleGenerationProvider {
  providerKind: SystemAiProviderKind;
  generateTitle(
    request: SystemAiChatTitleGenerationRequest,
    providerConfig: SystemAiProviderConfigRecord,
  ): Promise<{ title: string }>;
}

export interface SystemAiChatTitleStore {
  updateConversationTitle(
    companyId: string,
    conversationId: string,
    input: {
      title?: string;
      titleStatus: "generated" | "failed";
      titleSourceMessageId?: string;
      titleFailureReason?: string;
    },
  ): Promise<ConversationDto>;
}

export interface SystemAiChatTitleGenerationObserver {
  titleGenerated?(request: SystemAiChatTitleGenerationRequest, conversation: ConversationDto): void;
  titleFailed?(request: SystemAiChatTitleGenerationRequest, error: Error, conversation?: ConversationDto): void;
}

function trimRequired(value: string | undefined, fieldName: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function normalizeRequest(input: SystemAiChatTitleGenerationRequest): SystemAiChatTitleGenerationRequest {
  return {
    companyId: trimRequired(input.companyId, "companyId"),
    chatEntryId: trimRequired(input.chatEntryId, "chatEntryId"),
    roomId: trimRequired(input.roomId, "roomId"),
    currentTitle: trimRequired(input.currentTitle, "currentTitle"),
    sourceMessage: {
      messageId: trimRequired(input.sourceMessage?.messageId, "sourceMessage.messageId"),
      body: trimRequired(input.sourceMessage?.body, "sourceMessage.body"),
    },
    actor: input.actor.actorKind === "company_member"
      ? {
        actorKind: "company_member",
        memberId: trimRequired(input.actor.memberId, "actor.memberId"),
        displayName: input.actor.displayName?.trim() || undefined,
      }
      : {
        actorKind: "employee",
        employeeId: trimRequired(input.actor.employeeId, "actor.employeeId"),
        displayName: input.actor.displayName?.trim() || undefined,
      },
  };
}

function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() || "System AI title generation failed";
}

export class SystemAiChatTitleGenerationService {
  private readonly providers: Map<SystemAiProviderKind, SystemAiChatTitleGenerationProvider>;
  private readonly providerConfigService: SystemAiProviderConfigResolver;
  private readonly auditRepository: SystemAiAuditRepository;
  private readonly store: SystemAiChatTitleStore;
  private readonly observer: SystemAiChatTitleGenerationObserver | undefined;
  private readonly createRequestId: () => string;
  private readonly createAuditEventId: () => string;
  private readonly now: () => string;
  private readonly queue: Array<{ requestId: string; request: SystemAiChatTitleGenerationRequest }> = [];

  constructor(config: {
    providers: SystemAiChatTitleGenerationProvider[];
    providerConfigService: SystemAiProviderConfigResolver;
    auditRepository: SystemAiAuditRepository;
    createRequestId?: () => string;
    createAuditEventId?: () => string;
    now?: () => string;
    store: SystemAiChatTitleStore;
    observer?: SystemAiChatTitleGenerationObserver;
  }) {
    this.providers = new Map(config.providers.map((provider) => [provider.providerKind, provider]));
    this.providerConfigService = config.providerConfigService;
    this.auditRepository = config.auditRepository;
    this.createRequestId = config.createRequestId || (() => `system-ai-request-${randomUUID()}`);
    this.createAuditEventId = config.createAuditEventId || (() => `system-ai-audit-${randomUUID()}`);
    this.now = config.now || (() => new Date().toISOString());
    this.store = config.store;
    this.observer = config.observer;
  }

  requestChatEntryTitleGeneration(request: SystemAiChatTitleGenerationRequest): void {
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
      const request = this.queue.shift();
      if (!request) {
        continue;
      }
      await this.process(request.requestId, request.request);
    }
  }

  private async process(requestId: string, request: SystemAiChatTitleGenerationRequest): Promise<void> {
    let providerConfig: SystemAiProviderConfigRecord | undefined;
    let requestedRecorded = false;
    try {
      providerConfig = await this.providerConfigService.requireEnabledProviderConfig({
        companyId: request.companyId,
        capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
      });
      await this.recordAuditEvent(requestId, request, "requested", providerConfig);
      requestedRecorded = true;
      const provider = this.providerFor(providerConfig.providerKind);
      const generated = await provider.generateTitle(request, providerConfig);
      const title = trimRequired(generated.title, "generated title");
      const conversation = await this.store.updateConversationTitle(request.companyId, request.roomId, {
        title,
        titleStatus: "generated",
        titleSourceMessageId: request.sourceMessage.messageId,
      });
      await this.recordAuditEvent(requestId, request, "generated", providerConfig);
      this.observer?.titleGenerated?.(request, conversation);
    } catch (error) {
      if (!requestedRecorded) {
        await this.recordAuditEvent(requestId, request, "requested", providerConfig);
      }
      let conversation: ConversationDto | undefined;
      try {
        conversation = await this.store.updateConversationTitle(request.companyId, request.roomId, {
          titleStatus: "failed",
          titleSourceMessageId: request.sourceMessage.messageId,
          titleFailureReason: failureReason(error),
        });
      } catch {
        conversation = undefined;
      }
      await this.recordAuditEvent(requestId, request, "failed", providerConfig, failureReason(error));
      this.observer?.titleFailed?.(request, error instanceof Error ? error : new Error(String(error)), conversation);
    }
  }

  private providerFor(providerKind: SystemAiProviderKind): SystemAiChatTitleGenerationProvider {
    const provider = this.providers.get(providerKind);
    if (!provider) {
      throw new Error(`System AI provider is not registered for ${providerKind}`);
    }
    return provider;
  }

  private async recordAuditEvent(
    requestId: string,
    request: SystemAiChatTitleGenerationRequest,
    status: SystemAiAuditStatus,
    providerConfig?: SystemAiProviderConfigRecord,
    errorReason?: string,
  ): Promise<void> {
    await this.auditRepository.recordEvent({
      eventId: trimRequired(this.createAuditEventId(), "auditEventId"),
      companyId: request.companyId,
      capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
      requestId,
      source: auditSource(request),
      provider: providerConfig ? auditProvider(providerConfig) : undefined,
      status,
      errorReason,
      occurredAt: this.now(),
    });
  }
}

export class DeterministicChatTitleGenerationProvider implements SystemAiChatTitleGenerationProvider {
  readonly providerKind = "test_deterministic" as const;

  async generateTitle(request: SystemAiChatTitleGenerationRequest): Promise<{ title: string }> {
    const words = request.sourceMessage.body
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean)
      .slice(0, 6);
    return { title: words.length > 0 ? words.join(" ") : request.currentTitle };
  }
}

function auditSource(request: SystemAiChatTitleGenerationRequest): SystemAiAuditSource {
  return {
    objectKind: "chat_entry",
    objectId: request.chatEntryId,
    roomId: request.roomId,
    evidence: [{
      objectKind: "message",
      objectId: request.sourceMessage.messageId,
    }],
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

export class ChatTitleGenerationRealtimeObserver implements SystemAiChatTitleGenerationObserver {
  constructor(private readonly publisher: TinyOfficeRealtimePublisher) {}

  titleGenerated(request: SystemAiChatTitleGenerationRequest, conversation: ConversationDto): void {
    this.publishProjectionChanged(request, conversation);
  }

  titleFailed(request: SystemAiChatTitleGenerationRequest, _error: Error, conversation?: ConversationDto): void {
    this.publishProjectionChanged(request, conversation);
  }

  private publishProjectionChanged(request: SystemAiChatTitleGenerationRequest, conversation?: ConversationDto): void {
    const published = new Set<string>();
    for (const participant of conversation?.participants || []) {
      if (participant.memberId) {
        this.publishMember(request.companyId, participant.memberId, published);
      }
    }
    if (published.size > 0) {
      return;
    }
    if (request.actor.actorKind === "company_member") {
      this.publishMember(request.companyId, request.actor.memberId, published);
      return;
    }
  }

  private publishMember(companyId: string, memberId: string, published: Set<string>): void {
    const key = `member:${memberId}`;
    if (published.has(key)) {
      return;
    }
    published.add(key);
    this.publisher.publish({
      type: "chat.projection.changed",
      companyId,
      viewerMemberId: memberId,
    });
  }

}
