import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryMessageRepository } from "../../src/collaboration/message/message-repository.js";
import { MessageService } from "../../src/collaboration/message/message-service.js";
import {
  DeterministicChatTopicSummaryGenerationProvider,
  SystemAiChatTopicSummaryGenerationService,
  type SystemAiChatTopicSummaryGenerationProvider,
} from "../../src/system-ai/chat-topic-summary-generation.js";
import {
  InMemorySystemAiAuditRepository,
  InMemorySystemAiProviderConfigRepository,
  SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
  SystemAiProviderConfigService,
} from "../../src/system-ai/provider-config.js";

const fixedNow = () => "2026-07-02T08:00:00.000Z";

function deterministicIds() {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  };
}

async function makeStack(provider?: SystemAiChatTopicSummaryGenerationProvider) {
  const messageService = new MessageService({
    repository: new InMemoryMessageRepository(),
    createId: deterministicIds(),
    now: fixedNow,
  });
  const providerConfigService = new SystemAiProviderConfigService({
    repository: new InMemorySystemAiProviderConfigRepository(),
    now: fixedNow,
  });
  await providerConfigService.saveProviderConfig({
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
    providerKind: "test_deterministic",
    enabled: true,
    configRef: "system-ai/chat-topic-summary/test-enabled",
    modelRef: "deterministic-summary-v1",
  });
  const auditRepository = new InMemorySystemAiAuditRepository();
  const summaryGenerationService = new SystemAiChatTopicSummaryGenerationService({
    providers: [provider ?? new DeterministicChatTopicSummaryGenerationProvider()],
    providerConfigService,
    auditRepository,
    store: messageService,
    createRequestId: () => "system-ai-summary-request-1",
    createAuditEventId: (() => {
      let next = 0;
      return () => `system-ai-summary-audit-${++next}`;
    })(),
    now: fixedNow,
  });
  const created = await messageService.createConversationWithFirstMessage("acme", {
    conversation: {
      title: "Launch coordination",
      conversationKind: "topic",
      topic: {
        title: "Launch coordination",
        chatChannelId: "chat-channel-1",
      },
      participants: [
        { participantKind: "company_member", memberId: "iris-growth", displayName: "Iris" },
        { participantKind: "company_member", memberId: "nora-automation", displayName: "Nora" },
      ],
    },
    firstMessage: {
      sender: { participantKind: "company_member", memberId: "iris-growth" },
      body: "Nora, please own the launch checklist.",
    },
  });
  await messageService.sendMessage(
    "acme",
    created.conversation.conversationId,
    { participantKind: "company_member", memberId: "nora-automation" },
    "I will draft it and hand it back.",
  );
  const messages = (await messageService.listRecentMessages("acme", created.conversation.conversationId, { limit: 10 })).messages;
  return {
    auditRepository,
    created,
    messages,
    messageService,
    summaryGenerationService,
  };
}

test("System AI topic summary generation writes a persisted topic summary", async () => {
  const { auditRepository, created, messages, messageService, summaryGenerationService } = await makeStack();

  summaryGenerationService.requestTopicSummaryGeneration({
    companyId: "acme",
    topicId: created.conversation.topic?.topicId || "topic-1",
    roomId: created.conversation.conversationId,
    sourceMessages: messages.map((message) => ({
      messageId: message.messageId,
      senderDisplayName: message.sender.displayName,
      body: message.body,
      createdAt: message.createdAt,
    })),
  });

  assert.equal(summaryGenerationService.pendingCount(), 1);
  await summaryGenerationService.drain();

  const conversation = await messageService.getConversation("acme", created.conversation.conversationId);
  assert.equal(
    conversation?.topic?.summary?.text,
    "Nora please own the launch checklist. I will draft it and hand it back.",
  );
  assert.equal(conversation?.topic?.summary?.sourceMessageId, "message-2");
  assert.equal(conversation?.topic?.summary?.updatedAt, fixedNow());

  const auditEvents = await auditRepository.listEvents({
    companyId: "acme",
    requestId: "system-ai-summary-request-1",
  });
  assert.deepEqual(auditEvents.map((event) => event.status), ["requested", "generated"]);
  assert.deepEqual(auditEvents.map((event) => event.capability), [
    SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
    SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
  ]);
  assert.equal(auditEvents[0]?.source.objectKind, "conversation_topic");
  assert.equal(auditEvents[0]?.source.roomId, created.conversation.conversationId);
  assert.deepEqual(auditEvents[0]?.source.evidence.map((item) => item.objectId), ["message-1", "message-2"]);
});

test("System AI topic summary generation records failure without fake summary text", async () => {
  const failingProvider: SystemAiChatTopicSummaryGenerationProvider = {
    providerKind: "test_deterministic",
    async generateSummary() {
      throw new Error("summary provider failed");
    },
  };
  const { auditRepository, created, messages, messageService, summaryGenerationService } = await makeStack(failingProvider);

  summaryGenerationService.requestTopicSummaryGeneration({
    companyId: "acme",
    topicId: created.conversation.topic?.topicId || "topic-1",
    roomId: created.conversation.conversationId,
    sourceMessages: messages.map((message) => ({
      messageId: message.messageId,
      senderDisplayName: message.sender.displayName,
      body: message.body,
      createdAt: message.createdAt,
    })),
  });
  await summaryGenerationService.drain();

  const conversation = await messageService.getConversation("acme", created.conversation.conversationId);
  assert.equal(conversation?.topic?.summary, undefined);
  const auditEvents = await auditRepository.listEvents({
    companyId: "acme",
    requestId: "system-ai-summary-request-1",
  });
  assert.deepEqual(auditEvents.map((event) => event.status), ["requested", "failed"]);
  assert.equal(auditEvents[1]?.errorReason, "summary provider failed");
});
