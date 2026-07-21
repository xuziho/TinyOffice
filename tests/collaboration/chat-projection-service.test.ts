import assert from "node:assert/strict";
import test from "node:test";

import {
  CONVERSATION_DTO_SCHEMA,
  CONVERSATION_MESSAGE_CONTRACT_VERSION,
  CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA,
  CONVERSATION_RUNTIME_LINK_DTO_SCHEMA,
  CONVERSATION_TOPIC_STATE_DTO_SCHEMA,
  MESSAGE_DTO_SCHEMA,
  PARTICIPANT_DTO_SCHEMA,
  type ConversationDto,
  type MessagePage,
} from "../../src/collaboration/contracts/conversation-message-contract.js";
import { ChatProjectionService } from "../../src/collaboration/chat/chat-projection-service.js";
import type { ChatChannelRecord } from "../../src/collaboration/channel/channel-service.js";

const fixedNow = "2026-06-23T05:10:00.000Z";

function participant(companyId: string, conversationId: string, employeeId: string, displayName = employeeId) {
  return {
    schema: PARTICIPANT_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    participantId: `participant-${employeeId}`,
    participantKind: "employee" as const,
    employeeId,
    displayName,
    joinedAt: fixedNow,
  };
}

function memberParticipant(companyId: string, conversationId: string, memberId: string, displayName = memberId) {
  return {
    schema: PARTICIPANT_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    participantId: `participant-member-${memberId}`,
    participantKind: "company_member" as const,
    memberId,
    displayName,
    joinedAt: fixedNow,
  };
}

function state(companyId: string, conversationId: string, employeeId: string, unreadCount: number, mentionCount: number) {
  return {
    schema: CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    participantId: `participant-${employeeId}`,
    employeeId,
    unreadCount,
    mentionCount,
    updatedAt: fixedNow,
  };
}

function memberState(companyId: string, conversationId: string, memberId: string, unreadCount: number, mentionCount: number) {
  return {
    schema: CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    participantId: `participant-member-${memberId}`,
    memberId,
    unreadCount,
    mentionCount,
    updatedAt: fixedNow,
  };
}

function channel(input: {
  companyId?: string;
  chatChannelId?: string;
  ownerParticipantId?: string;
  title?: string;
  members?: ChatChannelRecord["members"];
} = {}): ChatChannelRecord {
  const companyId = input.companyId || "acme";
  const chatChannelId = input.chatChannelId || "ops";
  return {
    companyId,
    chatChannelId,
    title: input.title || "Ops",
    summary: "Operations Channel",
    members: input.members || [
      {
        schema: "chat-channel-member",
        version: 1,
        companyId,
        chatChannelId,
        memberId: "iris-growth",
        displayName: "Iris",
        role: "owner",
        hasRuntimeProfile: true,
        joinedAt: fixedNow,
      },
      {
        schema: "chat-channel-member",
        version: 1,
        companyId,
        chatChannelId,
        memberId: "nora-automation",
        displayName: "Nora",
        role: "member",
        hasRuntimeProfile: true,
        joinedAt: fixedNow,
      },
    ],
    createdAt: fixedNow,
    updatedAt: fixedNow,
  };
}

function conversation(input: {
  companyId?: string;
  conversationId: string;
  title: string;
  conversationKind: ConversationDto["conversationKind"];
  topicId?: string;
  chatChannelId?: string;
  participants?: ReturnType<typeof participant>[];
  participantStates?: ReturnType<typeof state>[];
  runtimeLinks?: ConversationDto["runtimeLinks"];
}): ConversationDto {
  const companyId = input.companyId || "acme";
  const participants = input.participants || [
    participant(companyId, input.conversationId, "iris-growth", "Iris"),
    participant(companyId, input.conversationId, "nora-automation", "Nora"),
  ];
  return {
    schema: CONVERSATION_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId: input.conversationId,
    title: input.title,
    conversationKind: input.conversationKind,
    topic: input.topicId
      ? {
        schema: CONVERSATION_TOPIC_STATE_DTO_SCHEMA,
        version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
        companyId,
        conversationId: input.conversationId,
        topicId: input.topicId,
        chatChannelId: input.chatChannelId,
        title: input.title,
        status: "open",
        ownerParticipantId: input.ownerParticipantId,
        participantIds: participants.map((item) => item.participantId),
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }
      : undefined,
    participants,
    participantStates: input.participantStates || [],
    lastMessageId: "message-latest",
    runtimeLinks: input.runtimeLinks || [],
    realtimeSequence: 2,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  };
}

function messagePage(companyId: string, conversationId: string, body: string): MessagePage {
  return {
    messages: [{
      schema: MESSAGE_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId,
      conversationId,
      messageId: `message-first-${conversationId}`,
      sender: {
        participantId: "participant-member-iris-growth",
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
      body,
      mentions: [],
      attachments: [],
      runtimeLinks: [],
      createdAt: fixedNow,
      deliveryState: "sent",
    }],
  };
}

function projectionService(
  conversations: ConversationDto[],
  channels: ChatChannelRecord[],
  firstMessageBodies = new Map<string, string>(),
) {
  return new ChatProjectionService({
    conversationSource: {
      async listConversations() {
        return { conversations };
      },
    },
    channelSource: {
      async listChannelsForViewer() {
        return channels;
      },
    },
    messageSource: {
      async listMessages(companyId, conversationId) {
        const body = firstMessageBodies.get(conversationId);
        return body ? messagePage(companyId, conversationId, body) : { messages: [] };
      },
    },
  });
}

test("chat projection lists channel topic entries under formal channel containers", async () => {
  const service = projectionService([
    conversation({
      conversationId: "conversation-topic-1",
      title: "Launch topic",
      conversationKind: "topic",
      topicId: "topic-launch",
      chatChannelId: "ops",
      participants: [
        memberParticipant("acme", "conversation-topic-1", "iris-growth", "Iris"),
        memberParticipant("acme", "conversation-topic-1", "nora-automation", "Nora"),
      ],
      participantStates: [
        memberState("acme", "conversation-topic-1", "iris-growth", 2, 1),
        memberState("acme", "conversation-topic-1", "nora-automation", 0, 0),
      ],
      runtimeLinks: [{
        schema: CONVERSATION_RUNTIME_LINK_DTO_SCHEMA,
        version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
        companyId: "acme",
        conversationId: "conversation-topic-1",
        linkId: "runtime-link-workrun",
        targetKind: "work_run",
        targetId: "workrun-123",
        label: "Implementation evidence",
        messageId: "message-evidence",
        createdAt: fixedNow,
      }],
    }),
    conversation({
      conversationId: "conversation-shared-standalone",
      title: "Shared standalone room",
      conversationKind: "shared",
      participantStates: [state("acme", "conversation-shared-standalone", "iris-growth", 9, 9)],
    }),
  ], [channel()]);

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });

  assert.deepEqual(page.containers.map((item) => [item.containerId, item.chatChannelId, item.kind, item.entryCount, item.members?.length, "viewerRole" in item]), [
    ["chat-container-channel-ops", "ops", "channel", 1, 2, false],
  ]);
  assert.deepEqual(page.entries.map((item) => [item.entryId, item.kind, item.parentContainerId]), [
    ["chat-entry-channel-topic-topic-launch", "channel_topic", "chat-container-channel-ops"],
  ]);
  assert.equal(page.entries[0]?.openTarget.kind, "topic_room");
  assert.equal(page.entries[0]?.openTarget.roomId, "conversation-topic-1");
  assert.equal(page.entries[0]?.unreadCount, 2);
  assert.equal(page.entries[0]?.mentionCount, 1);
  assert.deepEqual(page.entries[0]?.runtimeLinks.map((link) => [link.targetKind, link.targetId, link.sourceMessageId]), [
    ["work_run", "workrun-123", undefined],
  ]);
  assert.doesNotMatch(JSON.stringify(page.containers), /\b(openTarget|body|messages|participants|lastMessageId)\b/);
  assert.doesNotMatch(JSON.stringify(page), /\b(teamId|team_id|channelId|channel_id|postId|post_id|rootPostId|root_id|userId|user_id)\b/);
});

test("chat projection does not turn Topic ownership into a separate alert field", async () => {
  const conversationId = "conversation-topic-handoff";
  const service = projectionService([conversation({
    conversationId,
    title: "Launch decision",
    conversationKind: "topic",
    topicId: "topic-handoff",
    chatChannelId: "ops",
    ownerParticipantId: "participant-member-iris-growth",
    participants: [
      memberParticipant("acme", conversationId, "iris-growth", "Iris"),
      memberParticipant("acme", conversationId, "nora-automation", "Nora"),
    ],
    participantStates: [
      memberState("acme", conversationId, "iris-growth", 0, 0),
      memberState("acme", conversationId, "nora-automation", 0, 0),
    ],
  })], [channel()]);

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });
  assert.equal(page.entries[0]?.unreadCount, 0);
  assert.equal(page.entries[0]?.mentionCount, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(page.entries[0] as object, "attentionReason"), false);
});

test("chat projection uses the first message body as the entry preview", async () => {
  const service = projectionService([
    conversation({
      conversationId: "conversation-topic-preview",
      title: "Generated title",
      conversationKind: "topic",
      topicId: "topic-preview",
      chatChannelId: "ops",
      participants: [
        memberParticipant("acme", "conversation-topic-preview", "iris-growth", "Iris"),
        memberParticipant("acme", "conversation-topic-preview", "nora-automation", "Nora"),
      ],
    }),
    conversation({
      conversationId: "conversation-dm-preview",
      title: "Generated DM title",
      conversationKind: "direct",
      participants: [
        memberParticipant("acme", "conversation-dm-preview", "iris-growth", "Iris"),
        memberParticipant("acme", "conversation-dm-preview", "nora-automation", "Nora"),
      ],
    }),
  ], [channel()], new Map([
    ["conversation-topic-preview", "  @Nora   please report the launch blockers.\nThen hand off to Iris.  "],
    ["conversation-dm-preview", "Please check the automation workspace."],
  ]));

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });

  assert.equal(
    page.entries.find((entry) => entry.entryId === "chat-entry-channel-topic-topic-preview")?.summary,
    "@Nora please report the launch blockers. Then hand off to Iris.",
  );
  assert.equal(
    page.entries.find((entry) => entry.entryId === "chat-entry-dm-session-conversation-dm-preview")?.summary,
    "Please check the automation workspace.",
  );
  assert.equal(
    page.entries.find((entry) => entry.entryId === "chat-entry-channel-topic-topic-preview")?.title,
    "Generated title",
  );
});

test("chat projection serializes fallback preview reads on a shared message source", async () => {
  let activeReads = 0;
  let maxActiveReads = 0;
  const conversations = ["one", "two", "three"].map((suffix) => conversation({
    conversationId: `conversation-topic-${suffix}`,
    title: `Topic ${suffix}`,
    conversationKind: "topic",
    topicId: `topic-${suffix}`,
    chatChannelId: "ops",
    participants: [
      memberParticipant("acme", `conversation-topic-${suffix}`, "iris-growth", "Iris"),
      memberParticipant("acme", `conversation-topic-${suffix}`, "nora-automation", "Nora"),
    ],
  }));
  const service = new ChatProjectionService({
    conversationSource: {
      async listConversations() {
        return { conversations };
      },
    },
    channelSource: {
      async listChannelsForViewer() {
        return [channel()];
      },
    },
    messageSource: {
      async listMessages(companyId, conversationId) {
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeReads -= 1;
        return messagePage(companyId, conversationId, `Preview for ${conversationId}`);
      },
    },
  });

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });

  assert.equal(page.entries.length, 3);
  assert.equal(maxActiveReads, 1);
});

test("chat projection loads all visible entry previews through one batch read when supported", async () => {
  let batchReads = 0;
  const conversations = ["one", "two", "three"].map((suffix) => conversation({
    conversationId: `conversation-topic-${suffix}`,
    title: `Topic ${suffix}`,
    conversationKind: "topic",
    topicId: `topic-${suffix}`,
    chatChannelId: "ops",
    participants: [
      memberParticipant("acme", `conversation-topic-${suffix}`, "iris-growth", "Iris"),
      memberParticipant("acme", `conversation-topic-${suffix}`, "nora-automation", "Nora"),
    ],
  }));
  const service = new ChatProjectionService({
    conversationSource: {
      async listConversations() {
        return { conversations };
      },
    },
    channelSource: {
      async listChannelsForViewer() {
        return [channel()];
      },
    },
    messageSource: {
      async listFirstMessages(companyId, conversationIds) {
        batchReads += 1;
        return {
          messages: conversationIds.flatMap((conversationId) =>
            messagePage(companyId, conversationId, `Preview for ${conversationId}`).messages
          ),
        };
      },
      async listMessages() {
        throw new Error("per-conversation preview reads must not run when batch reads are available");
      },
    },
  });

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });

  assert.equal(page.entries.length, 3);
  assert.equal(batchReads, 1);
});

test("chat projection hides archived topic conversations from active entry lists", async () => {
  const archived = conversation({
    conversationId: "conversation-topic-archived",
    title: "Archived launch notes",
    conversationKind: "topic",
    topicId: "topic-archived",
    chatChannelId: "ops",
    participants: [
      memberParticipant("acme", "conversation-topic-archived", "iris-growth", "Iris"),
      memberParticipant("acme", "conversation-topic-archived", "nora-automation", "Nora"),
    ],
    participantStates: [
      memberState("acme", "conversation-topic-archived", "iris-growth", 7, 2),
    ],
  });
  const active = conversation({
    conversationId: "conversation-topic-active",
    title: "Active launch notes",
    conversationKind: "topic",
    topicId: "topic-active",
    chatChannelId: "ops",
    participants: [
      memberParticipant("acme", "conversation-topic-active", "iris-growth", "Iris"),
      memberParticipant("acme", "conversation-topic-active", "nora-automation", "Nora"),
    ],
    participantStates: [
      memberState("acme", "conversation-topic-active", "iris-growth", 1, 0),
    ],
  });
  const service = projectionService([
    {
      ...archived,
      topic: archived.topic ? { ...archived.topic, status: "archived" } : undefined,
    },
    active,
  ], [channel()]);

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });

  assert.deepEqual(page.entries.map((entry) => entry.title), ["Active launch notes"]);
  assert.deepEqual(page.archivedEntries.map((entry) => entry.title), ["Archived launch notes"]);
  assert.deepEqual(page.containers.map((container) => [
    container.containerId,
    container.entryCount,
    container.unreadCount,
    container.mentionCount,
  ]), [
    ["chat-container-channel-ops", 1, 1, 0],
  ]);
});

test("chat projection orders entries oldest first so newest topics stay at the bottom", async () => {
  const newest = conversation({
    conversationId: "conversation-newest",
    title: "Newest topic",
    conversationKind: "topic",
    topicId: "topic-newest",
    chatChannelId: "ops",
    participants: [
      memberParticipant("acme", "conversation-newest", "iris-growth", "Iris"),
      memberParticipant("acme", "conversation-newest", "nora-automation", "Nora"),
    ],
  });
  const oldest = {
    ...conversation({
      conversationId: "conversation-oldest",
      title: "Oldest topic",
      conversationKind: "topic",
      topicId: "topic-oldest",
      chatChannelId: "ops",
      participants: [
        memberParticipant("acme", "conversation-oldest", "iris-growth", "Iris"),
        memberParticipant("acme", "conversation-oldest", "nora-automation", "Nora"),
      ],
    }),
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
  const service = projectionService([newest, oldest], [channel()]);

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });

  assert.deepEqual(page.entries.map((entry) => entry.title), ["Oldest topic", "Newest topic"]);
});

test("topic conversations without formal channel ownership do not create fake channels", async () => {
  const service = projectionService([
    conversation({
      conversationId: "conversation-topic-orphan",
      title: "Orphan topic",
      conversationKind: "topic",
      topicId: "topic-orphan",
      participantStates: [state("acme", "conversation-topic-orphan", "iris-growth", 2, 0)],
    }),
  ], []);

  const page = await service.listChatProjection("acme", "iris-growth");

  assert.deepEqual(page.containers, []);
  assert.deepEqual(page.entries, []);
});

test("chat projection filters conversations the viewer is not allowed to access", async () => {
  const service = projectionService([
    conversation({
      conversationId: "conversation-topic-allowed",
      title: "Allowed topic",
      conversationKind: "topic",
      topicId: "topic-allowed",
      chatChannelId: "ops",
      participants: [
        memberParticipant("acme", "conversation-topic-allowed", "iris-growth", "Iris"),
        memberParticipant("acme", "conversation-topic-allowed", "nora-automation", "Nora"),
      ],
      participantStates: [
        memberState("acme", "conversation-topic-allowed", "iris-growth", 2, 0),
      ],
    }),
    conversation({
      conversationId: "conversation-topic-denied",
      title: "Denied topic",
      conversationKind: "topic",
      topicId: "topic-denied",
      chatChannelId: "ops",
      participants: [
        participant("acme", "conversation-topic-denied", "nora-automation", "Nora"),
      ],
      participantStates: [
        state("acme", "conversation-topic-denied", "nora-automation", 7, 3),
      ],
    }),
  ], [channel()]);

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });

  assert.deepEqual(page.entries.map((item) => item.openTarget.roomId), ["conversation-topic-allowed"]);
  assert.deepEqual(page.containers.map((item) => [item.containerId, item.entryCount, item.unreadCount, item.mentionCount]), [
    ["chat-container-channel-ops", 1, 2, 0],
  ]);
});

test("chat projection uses Company Member viewer state without employee fallback", async () => {
  const service = projectionService([
    conversation({
      conversationId: "conversation-member-topic",
      title: "Boss topic",
      conversationKind: "topic",
      topicId: "topic-boss",
      chatChannelId: "ops",
      participants: [
        memberParticipant("acme", "conversation-member-topic", "xuziho", "Xu Ziho"),
        participant("acme", "conversation-member-topic", "nora-automation", "Nora"),
      ],
      participantStates: [
        memberState("acme", "conversation-member-topic", "xuziho", 3, 1),
        state("acme", "conversation-member-topic", "nora-automation", 0, 0),
      ],
    }),
  ], [channel({
    members: [
      {
        schema: "chat-channel-member",
        version: 1,
        companyId: "acme",
        chatChannelId: "ops",
        memberId: "xuziho",
        displayName: "Xu Ziho",
        role: "owner",
        hasRuntimeProfile: false,
        joinedAt: fixedNow,
      },
      {
        schema: "chat-channel-member",
        version: 1,
        companyId: "acme",
        chatChannelId: "ops",
        memberId: "nora-automation",
        displayName: "Nora",
        role: "member",
        hasRuntimeProfile: true,
        joinedAt: fixedNow,
      },
    ],
  })]);

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "xuziho" });

  assert.equal(page.entries[0]?.unreadCount, 3);
  assert.equal(page.entries[0]?.mentionCount, 1);
});

test("chat projection exposes a real channel container before any topic exists", async () => {
  const service = projectionService([], [channel({ title: "Channel topics", chatChannelId: "channel-topics" })]);

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });

  assert.deepEqual(page.containers.map((item) => [
    item.containerId,
    item.kind,
    item.title,
    item.entryCount,
    item.unreadCount,
    item.mentionCount,
  ]), [
    ["chat-container-channel-channel-topics", "channel", "Channel topics", 0, 0, 0],
  ]);
  assert.deepEqual(page.entries, []);
  assert.doesNotMatch(JSON.stringify(page), /\b(teamId|team_id|channelId|channel_id|postId|post_id|rootPostId|root_id|userId|user_id)\b/);
});

test("chat projection does not expose Channels without persisted members", async () => {
  const service = projectionService([
    conversation({
      conversationId: "conversation-empty-channel-topic",
      title: "Empty Channel topic",
      conversationKind: "topic",
      topicId: "topic-empty-channel",
      chatChannelId: "empty-channel",
      participantStates: [state("acme", "conversation-empty-channel-topic", "iris-growth", 1, 1)],
    }),
  ], [channel({
    chatChannelId: "empty-channel",
    title: "Empty Channel",
    members: [],
  })]);

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });

  assert.deepEqual(page.containers, []);
  assert.deepEqual(page.entries, []);
});

test("chat projection lists member DM session entries without representing them as channel topics", async () => {
  const service = projectionService([
    conversation({
      conversationId: "conversation-dm-1",
      title: "Nora DM session",
      conversationKind: "direct",
      participants: [
        memberParticipant("acme", "conversation-dm-1", "iris-growth", "Iris"),
        memberParticipant("acme", "conversation-dm-1", "nora-automation", "Nora"),
      ],
      participantStates: [
        memberState("acme", "conversation-dm-1", "iris-growth", 1, 0),
        memberState("acme", "conversation-dm-1", "nora-automation", 0, 0),
      ],
      runtimeLinks: [{
        schema: CONVERSATION_RUNTIME_LINK_DTO_SCHEMA,
        version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
        companyId: "acme",
        conversationId: "conversation-dm-1",
        linkId: "runtime-link-session",
        targetKind: "session",
        targetId: "session-123",
        label: "DM work session",
        createdAt: fixedNow,
      }],
    }),
  ], []);

  const page = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "iris-growth" });
  const container = page.containers.find((item) => item.containerId === "chat-container-member-dm-nora-automation");
  const entry = page.entries[0];

  assert.equal(page.containers.some((item) => item.kind === "channel"), false);
  assert.equal(container?.kind, "member_dm");
  assert.equal(container?.containerId, "chat-container-member-dm-nora-automation");
  assert.equal(container?.entryCount, 1);
  assert.equal(entry?.kind, "dm_session_entry");
  assert.equal(entry?.parentContainerId, container?.containerId);
  assert.equal(entry?.openTarget.kind, "dm_session_entry_room");
  assert.notEqual(entry?.kind, "channel_topic");
  assert.notEqual(entry?.openTarget.kind, "topic_room");
  assert.deepEqual(entry?.runtimeLinks.map((link) => [link.targetKind, link.targetId]), [["session", "session-123"]]);
  assert.doesNotMatch(JSON.stringify(page), /\b(sessionId|workRunId|processTraceId|traceId|attachmentId)\b/);
});

test("chat projection moves personally archived DM entries out of the active list", async () => {
  const service = projectionService([
    conversation({
      conversationId: "conversation-dm-archived",
      title: "Archived Avery DM",
      conversationKind: "direct",
      participants: [
        memberParticipant("acme", "conversation-dm-archived", "xuziho", "Xu"),
        memberParticipant("acme", "conversation-dm-archived", "avery", "Avery"),
      ],
      participantStates: [
        { ...memberState("acme", "conversation-dm-archived", "xuziho", 0, 0), archivedAt: fixedNow },
        memberState("acme", "conversation-dm-archived", "avery", 0, 0),
      ],
    }),
  ], []);

  const xuPage = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "xuziho" });
  assert.equal(xuPage.entries.length, 0);
  assert.deepEqual(xuPage.archivedEntries.map((entry) => entry.title), ["Archived Avery DM"]);

  const averyPage = await service.listChatProjection("acme", { participantKind: "company_member", memberId: "avery" });
  assert.deepEqual(averyPage.entries.map((entry) => entry.title), ["Archived Avery DM"]);
  assert.equal(averyPage.archivedEntries.length, 0);
});
