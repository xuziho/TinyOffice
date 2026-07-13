import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ChatCreateEntryService } from "../../src/collaboration/chat/chat-create-entry-service.js";
import { channelContainerId, ChatProjectionService } from "../../src/collaboration/chat/chat-projection-service.js";
import { ChannelService, InMemoryChannelRepository } from "../../src/collaboration/channel/channel-service.js";
import { InMemoryMessageRepository } from "../../src/collaboration/message/message-repository.js";
import { MessageService } from "../../src/collaboration/message/message-service.js";
import {
  ChatTitleGenerationRealtimeObserver,
  DeterministicChatTitleGenerationProvider,
  SystemAiChatTitleGenerationService,
  type SystemAiChatTitleGenerationProvider,
} from "../../src/system-ai/chat-title-generation.js";
import {
  InMemorySystemAiAuditRepository,
  InMemorySystemAiProviderConfigRepository,
  SYSTEM_AI_CHAT_TITLE_CAPABILITY,
  SystemAiProviderConfigService,
} from "../../src/system-ai/provider-config.js";
import type { TinyOfficeRealtimeEvent, TinyOfficeRealtimeEventPayload, TinyOfficeRealtimePublisher } from "../../src/collaboration/contracts/tinyoffice-realtime-contract.js";

const fixedNow = () => "2026-06-23T06:00:00.000Z";
const chatCreateEntryServiceUrl = new URL("../../src/collaboration/chat/chat-create-entry-service.ts", import.meta.url);

function deterministicIds() {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  };
}

function makeStack(
  memberEligibilityResolver: (input: { companyId: string; memberIds: string[] }) => Promise<string[]> | string[] =
    ({ memberIds }) => memberIds,
) {
  const repository = new InMemoryMessageRepository();
  const channelRepository = new InMemoryChannelRepository();
  const channelService = new ChannelService(channelRepository);
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: fixedNow,
    repository,
  });
  const projectionService = new ChatProjectionService({
    conversationSource: messageService,
    channelSource: channelService,
  });
  return {
    repository,
    channelService,
    messageService,
    service: new ChatCreateEntryService({
      messageService,
      channelService,
      projectionService,
      memberEligibilityResolver,
    }),
    projectionService,
  };
}

class CapturingRealtimePublisher implements TinyOfficeRealtimePublisher {
  readonly events: TinyOfficeRealtimeEventPayload[] = [];

  publish(event: TinyOfficeRealtimeEventPayload): TinyOfficeRealtimeEvent {
    this.events.push(event);
    return {
      schema: "tinyoffice-realtime-event",
      version: 1,
      eventId: `event-${this.events.length}`,
      occurredAt: fixedNow(),
      sequence: this.events.length,
      ...event,
    };
  }
}

async function createChannelTopic(service: ChatCreateEntryService, channelService: ChannelService) {
  const channel = await channelService.createChannel({
    companyId: "acme",
    title: "Ops",
    actor: {
      participantKind: "company_member",
      memberId: "iris-growth",
      displayName: "Iris",
    },
    members: [{
      memberId: "nora-automation",
      displayName: "Nora",
      hasRuntimeProfile: true,
    }],
  });
  return await service.createEntry({
    companyId: "acme",
    containerId: channelContainerId(channel.chatChannelId),
    actorMemberId: "iris-growth",
    actorDisplayName: "Iris",
    firstMessage: {
      body: "Nora, please draft the rollout checklist before launch.",
      mentionedMemberIds: ["nora-automation"],
    },
  });
}

async function makeTitleGenerationService(config: {
  provider?: SystemAiChatTitleGenerationProvider;
  store: MessageService;
  publisher: TinyOfficeRealtimePublisher;
  auditRepository?: InMemorySystemAiAuditRepository;
}) {
  const providerConfigService = new SystemAiProviderConfigService({
    repository: new InMemorySystemAiProviderConfigRepository(),
    now: fixedNow,
  });
  await providerConfigService.saveProviderConfig({
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    providerKind: "test_deterministic",
    enabled: true,
    configRef: "system-ai/chat-title/test-enabled",
    modelRef: "deterministic-title-v1",
  });
  const auditRepository = config.auditRepository ?? new InMemorySystemAiAuditRepository();
  return {
    auditRepository,
    titleGenerationService: new SystemAiChatTitleGenerationService({
      providers: [config.provider ?? new DeterministicChatTitleGenerationProvider()],
      providerConfigService,
      auditRepository,
      createRequestId: () => "system-ai-request-1",
      createAuditEventId: (() => {
        let next = 0;
        return () => `system-ai-audit-${++next}`;
      })(),
      now: fixedNow,
      store: config.store,
      observer: new ChatTitleGenerationRealtimeObserver(config.publisher),
    }),
  };
}

test("chat create-entry service creates channel topic entries and returns projection-shaped DTOs", async () => {
  const { repository, service, projectionService, channelService } = makeStack();
  const channel = await channelService.createChannel({
    companyId: "acme",
    title: "Ops",
    actor: {
      participantKind: "company_member",
      memberId: "iris-growth",
      displayName: "Iris",
    },
    members: [{
      memberId: "nora-automation",
      displayName: "Nora",
      hasRuntimeProfile: true,
    }],
  });

  const response = await service.createEntry({
    companyId: "acme",
    containerId: channelContainerId(channel.chatChannelId),
    actorMemberId: "iris-growth",
    actorDisplayName: "Iris",
    memberDisplayNames: {
      "iris-growth": "Iris",
      "nora-automation": "Nora",
    },
    firstMessage: {
      body: "Nora, please draft the rollout checklist.",
      mentionedMemberIds: ["nora-automation"],
      runtimeLinks: [{
        linkId: "runtime-link-workrun",
        targetKind: "work_run",
        targetId: "workrun-chat-create-1",
        label: "Implementation work",
      }],
    },
  });

  assert.equal(response.schema, "chat-create-entry-result");
  assert.equal(response.companyId, "acme");
  assert.equal(response.container.containerId, channelContainerId(channel.chatChannelId));
  assert.equal(response.container.kind, "channel");
  assert.equal(response.container.members?.length, 2);
  assert.equal(response.entry.kind, "channel_topic");
  assert.equal(response.entry.parentContainerId, channelContainerId(channel.chatChannelId));
  assert.equal(response.entry.title, "Nora, please draft the rollout checklist");
  assert.equal(response.entry.titleStatus, "generated");
  assert.equal(response.entry.openTarget.kind, "topic_room");
  assert.equal(response.entry.openTarget.roomId, "conversation-1");
  assert.equal(response.firstMessageId, "message-1");
  assert.deepEqual(response.entry.runtimeLinks.map((link) => [link.targetKind, link.targetId, link.sourceMessageId]), [
    ["work_run", "workrun-chat-create-1", undefined],
  ]);
  assert.doesNotMatch(JSON.stringify(response), /\b(teamId|team_id|channelId|channel_id|postId|post_id|userId|user_id)\b/);

  const noraProjection = await projectionService.listChatProjection("acme", { participantKind: "company_member", memberId: "nora-automation" });
  assert.equal(noraProjection.entries[0]?.entryId, response.entry.entryId);
  assert.equal(noraProjection.entries[0]?.mentionCount, 1);
  const createdConversation = await repository.getConversation("acme", "conversation-1");
  assert.equal(createdConversation?.conversation.conversationId, "conversation-1");
  assert.equal(createdConversation?.conversation.topic?.chatChannelId, channel.chatChannelId);
  assert.equal(createdConversation?.conversation.title, "Nora, please draft the rollout checklist");
});

test("chat create-entry service creates DM session entries without channel topic identity", async () => {
  const { service, projectionService } = makeStack();

  const response = await service.createEntry({
    companyId: "acme",
    containerId: "chat-container-member-dm-nora-automation",
    actorMemberId: "iris-growth",
    actorDisplayName: "Iris",
    memberDisplayNames: {
      "iris-growth": "Iris",
      "nora-automation": "Nora",
    },
    firstMessage: {
      body: "Can you review the new Chat write API?",
    },
  });

  assert.equal(response.container.kind, "member_dm");
  assert.equal(response.container.containerId, "chat-container-member-dm-nora-automation");
  assert.equal(response.entry.kind, "dm_session_entry");
  assert.equal(response.entry.parentContainerId, response.container.containerId);
  assert.equal(response.entry.title, "Can you review the new Chat write API");
  assert.equal(response.entry.titleStatus, "generated");
  assert.equal(response.entry.openTarget.kind, "dm_session_entry_room");
  assert.notEqual(response.entry.kind, "channel_topic");
  assert.notEqual(response.entry.openTarget.kind, "topic_room");

  const projection = await projectionService.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });
  assert.equal(projection.entries[0]?.kind, "dm_session_entry");
  assert.equal(projection.entries[0]?.openTarget.roomId, "conversation-1");
});

test("chat create-entry service rejects inactive or unavailable DM peers at the backend boundary", async () => {
  const { service } = makeStack(() => []);

  await assert.rejects(
    () => service.createEntry({
      companyId: "acme",
      containerId: "chat-container-member-dm-inactive-analyst",
      actorMemberId: "xuziho",
      actorDisplayName: "Xuziho",
      memberDisplayNames: { "inactive-analyst": "Inactive Analyst" },
      firstMessage: { body: "This forged DM target must be rejected." },
    }),
    /inactive-analyst is not active or is not available/,
  );
});

test("chat create-entry service requires member DM containers and actor member identity", async () => {
  const { service } = makeStack();

  await assert.rejects(
    () =>
      service.createEntry({
        companyId: "acme",
        containerId: "chat-container-employee-dm-nora-automation",
        actorMemberId: "iris-growth",
        actorDisplayName: "Iris",
        firstMessage: {
          body: "This should use member identity.",
        },
      }),
    /unsupported Chat containerId/,
  );

  await assert.rejects(
    () =>
      service.createEntry({
        companyId: "acme",
        containerId: "chat-container-member-dm-nora-automation",
        actorDisplayName: "Iris",
        firstMessage: {
          body: "This should require actorMemberId.",
        },
      }),
    /actorMemberId is required/,
  );
});

test("chat create-entry service input contract exposes member identity only", async () => {
  const source = await readFile(chatCreateEntryServiceUrl, "utf8");
  const inputBlock = source.match(/export interface ChatCreateEntryInput \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(inputBlock, /actorEmployeeId/);
  assert.match(inputBlock, /actorMemberId\?: string/);
});

test("chat create-entry service requires explicit display names instead of memberId fallbacks", async () => {
  const { service } = makeStack();

  await assert.rejects(
    () =>
      service.createEntry({
        companyId: "acme",
        containerId: "chat-container-member-dm-nora-automation",
        actorMemberId: "iris-growth",
        memberDisplayNames: {
          "nora-automation": "Nora",
        },
        firstMessage: {
          body: "This should not persist Iris as a memberId label.",
        },
      }),
    /actorDisplayName is required/,
  );

  await assert.rejects(
    () =>
      service.createEntry({
        companyId: "acme",
        containerId: "chat-container-member-dm-nora-automation",
        actorMemberId: "iris-growth",
        actorDisplayName: "Iris",
        firstMessage: {
          body: "This should not persist Nora as a memberId label.",
        },
      }),
    /memberDisplayNames\.nora-automation is required/,
  );
});

test("chat create-entry service uses first message title for member-created DM entries without System AI", async () => {
  const { service, projectionService } = makeStack();

  const response = await service.createEntry({
    companyId: "acme",
    containerId: "chat-container-member-dm-aster",
    actorMemberId: "xuziho",
    actorDisplayName: "Xuziho",
    memberDisplayNames: {
      aster: "Aster",
    },
    firstMessage: {
      body: "你好，请问你是谁",
    },
  });

  assert.equal(response.entry.kind, "dm_session_entry");
  assert.equal(response.entry.title, "你好，请问你是谁");
  assert.equal(response.entry.titleStatus, "generated");
  assert.notEqual(response.entry.title, "aster");

  const projection = await projectionService.listChatProjection("acme", { participantKind: "company_member", memberId: "xuziho" });
  assert.equal(projection.entries[0]?.title, "你好，请问你是谁");
});

test("chat create-entry service validates required context and rejects carrier vocabulary", async () => {
  const { service, channelService } = makeStack();
  const channel = await channelService.createChannel({
    companyId: "acme",
    title: "Ops",
    actor: {
      participantKind: "company_member",
      memberId: "iris-growth",
      displayName: "Iris",
    },
  });

  await assert.rejects(
    () =>
      service.createEntry({
        companyId: "",
        containerId: channelContainerId(channel.chatChannelId),
        actorMemberId: "iris-growth",
        title: "No company",
        firstMessage: { body: "Missing context." },
      }),
    /explicit companyId is required/,
  );
  await assert.rejects(
    () =>
      service.createEntry({
        companyId: "acme",
        containerId: "chat-container-member-dm-iris-growth",
        actorMemberId: "iris-growth",
        actorDisplayName: "Iris",
        firstMessage: { body: "Self DM should not create an entry." },
      }),
    /peer member distinct/,
  );
  await assert.rejects(
    () =>
      service.createEntry({
        companyId: "acme",
        containerId: channelContainerId(channel.chatChannelId),
        actorMemberId: "iris-growth",
        title: "Carrier leak",
        firstMessage: { body: "No carrier fields." },
        channelId: "mattermost-channel",
      } as never),
    /forbidden carrier field: channelId/,
  );
});

test("chat create-entry service requests backend System AI title generation without waiting for refinement", async () => {
  const { repository, messageService, projectionService, channelService } = makeStack();
  const publisher = new CapturingRealtimePublisher();
  const { titleGenerationService, auditRepository } = await makeTitleGenerationService({
    store: messageService,
    publisher,
  });
  const service = new ChatCreateEntryService({
    messageService,
    projectionService,
    channelService,
    titleGenerationService,
  });

  const response = await createChannelTopic(service, channelService);

  assert.equal(response.entry.title, "Nora, please draft the rollout checklist before launch");
  assert.equal(response.entry.titleStatus, "placeholder");
  assert.equal(response.entry.titleSourceMessageId, undefined);
  assert.equal(response.firstMessageId, "message-1");
  assert.equal(titleGenerationService.pendingCount(), 1);
  assert.equal((await repository.getConversation("acme", response.openTarget.roomId))?.conversation.titleStatus, "placeholder");

  await titleGenerationService.drain();

  const projection = await projectionService.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });
  assert.equal(projection.entries[0]?.title, "Nora please draft the rollout checklist");
  assert.equal(projection.entries[0]?.titleStatus, "generated");
  assert.equal(projection.entries[0]?.titleSourceMessageId, "message-1");
  assert.deepEqual(publisher.events, [
    {
      type: "chat.projection.changed",
      companyId: "acme",
      viewerMemberId: "iris-growth",
    },
    {
      type: "chat.projection.changed",
      companyId: "acme",
      viewerMemberId: "nora-automation",
    },
  ]);
  assert.deepEqual((await messageService.listMessages("acme", response.openTarget.roomId)).messages.map((item) => item.messageId), [
    "message-1",
  ]);
  const auditEvents = await auditRepository.listEvents({
    companyId: "acme",
    requestId: "system-ai-request-1",
  });
  assert.deepEqual(auditEvents.map((event) => event.status), ["requested", "generated"]);
  assert.deepEqual(auditEvents.map((event) => event.provider?.providerKind), ["test_deterministic", "test_deterministic"]);
  assert.equal(auditEvents[0]?.source.objectKind, "chat_entry");
  assert.equal(auditEvents[0]?.source.objectId, response.entry.entryId);
  assert.equal(auditEvents[0]?.source.roomId, response.openTarget.roomId);
  assert.equal(auditEvents[0]?.source.evidence[0]?.objectKind, "message");
  assert.equal(auditEvents[0]?.source.evidence[0]?.objectId, "message-1");
  assert.doesNotMatch(JSON.stringify(auditEvents), /\b(sessionId|workRunId|pi|openai|claude|codex)\b/i);
});

test("System AI title generation failure records failed state without fake Chat messages", async () => {
  const { repository, messageService, projectionService, channelService } = makeStack();
  const failingProvider: SystemAiChatTitleGenerationProvider = {
    providerKind: "test_deterministic",
    async generateTitle() {
      throw new Error("deterministic provider failure");
    },
  };
  const publisher = new CapturingRealtimePublisher();
  const { titleGenerationService, auditRepository } = await makeTitleGenerationService({
    provider: failingProvider,
    store: messageService,
    publisher,
  });
  const service = new ChatCreateEntryService({
    messageService,
    projectionService,
    channelService,
    titleGenerationService,
  });

  const response = await createChannelTopic(service, channelService);
  await titleGenerationService.drain();

  const conversation = (await repository.getConversation("acme", response.openTarget.roomId))?.conversation;
  assert.equal(conversation?.title, "Nora, please draft the rollout checklist before launch");
  assert.equal(conversation?.titleStatus, "failed");
  assert.equal(conversation?.titleSourceMessageId, "message-1");
  assert.equal(conversation?.titleFailureReason, "deterministic provider failure");

  const projection = await projectionService.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });
  assert.equal(projection.entries[0]?.title, "Nora, please draft the rollout checklist before launch");
  assert.equal(projection.entries[0]?.titleStatus, "failed");
  assert.equal(projection.entries[0]?.titleSourceMessageId, "message-1");
  assert.deepEqual((await messageService.listMessages("acme", response.openTarget.roomId)).messages.map((item) => item.messageId), [
    "message-1",
  ]);
  assert.deepEqual(publisher.events.map((event) => event.type), ["chat.projection.changed", "chat.projection.changed"]);
  const auditEvents = await auditRepository.listEvents({
    companyId: "acme",
    requestId: "system-ai-request-1",
  });
  assert.deepEqual(auditEvents.map((event) => event.status), ["requested", "failed"]);
  assert.equal(auditEvents[1]?.errorReason, "deterministic provider failure");
  assert.equal(auditEvents[1]?.provider?.configRef, "system-ai/chat-title/test-enabled");
});

test("manual title edits are not overwritten by pending System AI title generation", async () => {
  const { messageService, projectionService, channelService } = makeStack();
  const publisher = new CapturingRealtimePublisher();
  const { titleGenerationService } = await makeTitleGenerationService({
    store: messageService,
    publisher,
  });
  const service = new ChatCreateEntryService({
    messageService,
    projectionService,
    channelService,
    titleGenerationService,
  });

  const response = await createChannelTopic(service, channelService);
  await messageService.updateConversationTitle("acme", response.openTarget.roomId, {
    title: "Manual launch title",
    titleStatus: "manual",
  });
  await titleGenerationService.drain();

  const conversation = await messageService.getConversation("acme", response.openTarget.roomId);
  assert.equal(conversation?.title, "Manual launch title");
  assert.equal(conversation?.titleStatus, "manual");
  const projection = await projectionService.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });
  assert.equal(projection.entries[0]?.title, "Manual launch title");
  assert.equal(projection.entries[0]?.titleStatus, "manual");
});
