import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import {
  CHAT_ENTRY_CONTRACT_VERSION,
  type ChatContainerDto,
  type ChatEntryDto,
} from "../../src/collaboration/contracts/chat-entry-contract.js";
import {
  CONVERSATION_DTO_SCHEMA,
  CONVERSATION_MESSAGE_CONTRACT_VERSION,
  CONVERSATION_MESSAGE_REALTIME_EVENT_SCHEMA,
  MESSAGE_DTO_SCHEMA,
  PARTICIPANT_DTO_SCHEMA,
  type ConversationDto,
  type MarkConversationReadResult,
  type MessageDto,
  type SendMessageResult,
} from "../../src/collaboration/contracts/conversation-message-contract.js";
import {
  handleChatProjectionApiRequest,
  type ChatDispatchApiEvent,
  type ChatDispatchApiSink,
  type ChatCreateEntryApiService,
  type ChatProjectionApiService,
  type ChatRoomMessageApiService,
} from "../../src/collaboration/api/chat-projection-api-routes.js";
import {
  ChatCreateEntryService,
  type ChatCreateEntryInput,
  type ChatCreateEntryResponse,
} from "../../src/collaboration/chat/chat-create-entry-service.js";
import {
  channelContainerId,
  ChatProjectionService,
  type ChatViewerIdentity,
} from "../../src/collaboration/chat/chat-projection-service.js";
import { ChannelService, InMemoryChannelRepository } from "../../src/collaboration/channel/channel-service.js";
import { InMemoryMessageRepository } from "../../src/collaboration/message/message-repository.js";
import {
  MessageService,
  type MessageServiceParticipantSelector,
} from "../../src/collaboration/message/message-service.js";
import type {
  TinyOfficeRealtimeEvent,
  TinyOfficeRealtimeEventPayload,
  TinyOfficeRealtimePublisher,
} from "../../src/collaboration/contracts/tinyoffice-realtime-contract.js";

const fixedNow = "2026-06-23T05:20:00.000Z";
const TEST_CHANNEL_ID = "ops";
const TEST_CHANNEL_CONTAINER_ID = channelContainerId(TEST_CHANNEL_ID);

function channelMembers(companyId: string) {
  return [{
    schema: "chat-channel-member" as const,
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId,
    chatChannelId: TEST_CHANNEL_ID,
    memberId: "iris-growth",
    displayName: "Iris",
    hasRuntimeProfile: true,
    joinedAt: fixedNow,
  }, {
    schema: "chat-channel-member" as const,
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId,
    chatChannelId: TEST_CHANNEL_ID,
    memberId: "nora-automation",
    displayName: "Nora",
    hasRuntimeProfile: true,
    joinedAt: fixedNow,
  }];
}

class FakeChatProjectionApiService implements ChatProjectionApiService {
  readonly calls: Array<{ companyId: string; viewer: ChatViewerIdentity; cursor?: { cursor?: string; limit?: number } }> = [];

  constructor(private readonly malicious = false) {}

  async listChatProjection(companyId: string, viewer: ChatViewerIdentity, cursor?: { cursor?: string; limit?: number }) {
    this.calls.push({ companyId, viewer, cursor });
    const container: ChatContainerDto = {
      schema: "chat-container",
      version: CHAT_ENTRY_CONTRACT_VERSION,
      companyId,
      containerId: TEST_CHANNEL_CONTAINER_ID,
      chatChannelId: TEST_CHANNEL_ID,
      kind: "channel",
      title: "Channel topics",
      unreadCount: 1,
      mentionCount: 1,
      entryCount: 1,
      runtimeLinks: [],
      members: channelMembers(companyId),
    };
    const entry: ChatEntryDto = {
      schema: "chat-entry",
      version: CHAT_ENTRY_CONTRACT_VERSION,
      companyId,
      entryId: "chat-entry-channel-topic-launch",
      kind: "channel_topic",
      parentContainerId: container.containerId,
      title: "Launch topic",
      titleStatus: "manual",
      unreadCount: 1,
      mentionCount: 1,
      openTarget: {
        kind: "topic_room",
        roomId: "conversation-topic-1",
      },
      runtimeLinks: [],
      updatedAt: fixedNow,
    };
    if (this.malicious) {
      return {
        containers: [container],
        entries: [{ ...entry, channelId: "carrier-channel" } as unknown as ChatEntryDto],
      };
    }
    return {
      containers: [container],
      entries: [entry],
    };
  }
}

class FakeChatCreateEntryApiService implements ChatCreateEntryApiService {
  readonly calls: ChatCreateEntryInput[] = [];

  constructor(private readonly createError?: Error) {}

  async createEntry(input: ChatCreateEntryInput): Promise<ChatCreateEntryResponse> {
    this.calls.push(input);
    if (this.createError) {
      throw this.createError;
    }
    const container: ChatContainerDto = {
      schema: "chat-container",
      version: CHAT_ENTRY_CONTRACT_VERSION,
      companyId: input.companyId,
      containerId: input.containerId,
      kind: input.containerId.startsWith("chat-container-member-dm-") ? "member_dm" : "channel",
      ...(input.containerId.startsWith("chat-container-member-dm-") ? {} : { chatChannelId: TEST_CHANNEL_ID }),
      title: "Channel topics",
      unreadCount: 0,
      mentionCount: 0,
      entryCount: 1,
      runtimeLinks: [],
      ...(input.containerId.startsWith("chat-container-member-dm-")
        ? {}
        : { members: channelMembers(input.companyId) }),
    };
    const entry: ChatEntryDto = {
      schema: "chat-entry",
      version: CHAT_ENTRY_CONTRACT_VERSION,
      companyId: input.companyId,
      entryId: "chat-entry-channel-topic-topic-1",
      kind: "channel_topic",
      parentContainerId: input.containerId,
      title: input.title || "Nora",
      titleStatus: "manual",
      unreadCount: 0,
      mentionCount: 0,
      openTarget: {
        kind: "topic_room",
        roomId: "conversation-1",
      },
      runtimeLinks: [],
      updatedAt: fixedNow,
    };
    return {
      schema: "chat-create-entry-result",
      version: CHAT_ENTRY_CONTRACT_VERSION,
      companyId: input.companyId,
      container,
      entry,
      openTarget: entry.openTarget,
      firstMessageId: "message-1",
    };
  }
}

function participant(companyId: string, conversationId: string, employeeId: string) {
  return {
    schema: PARTICIPANT_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    participantId: `participant-${employeeId}`,
    participantKind: "employee" as const,
    employeeId,
    displayName: employeeId,
    joinedAt: fixedNow,
  };
}

function memberParticipant(companyId: string, conversationId: string, memberId: string) {
  return {
    schema: PARTICIPANT_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    participantId: `participant-member-${memberId}`,
    participantKind: "company_member" as const,
    memberId,
    displayName: memberId,
    joinedAt: fixedNow,
  };
}

function conversation(companyId: string, conversationId = "conversation-topic-1"): ConversationDto {
  return {
    schema: CONVERSATION_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    title: "Launch topic",
    conversationKind: "topic",
    topic: {
      schema: "conversation-topic-state",
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId,
      conversationId,
      topicId: "topic-launch",
      title: "Launch topic",
      status: "open",
        participantIds: ["participant-member-xuziho", "participant-member-nora-automation"],
      createdAt: fixedNow,
      updatedAt: fixedNow,
    },
    participants: [
      memberParticipant(companyId, conversationId, "xuziho"),
      memberParticipant(companyId, conversationId, "nora-automation"),
    ],
    participantStates: [
      {
        schema: "conversation-participant-state",
        version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
        companyId,
        conversationId,
        participantId: "participant-member-xuziho",
        memberId: "xuziho",
        lastReadMessageId: "message-1",
        unreadCount: 0,
        mentionCount: 0,
        updatedAt: fixedNow,
      },
      {
        schema: "conversation-participant-state",
        version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
        companyId,
        conversationId,
        participantId: "participant-member-nora-automation",
        memberId: "nora-automation",
        unreadCount: 1,
        mentionCount: 0,
        updatedAt: fixedNow,
      },
    ],
    lastMessageId: "message-1",
    runtimeLinks: [],
    realtimeSequence: 1,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  };
}

function message(companyId: string, conversationId = "conversation-topic-1", messageId = "message-1"): MessageDto {
  return {
    schema: MESSAGE_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    messageId,
    sender: {
      participantId: "participant-iris-growth",
      participantKind: "employee",
      employeeId: "iris-growth",
      displayName: "Iris",
    },
    body: "Ready for QA.",
    mentions: [],
    attachments: [],
    runtimeLinks: [],
    createdAt: fixedNow,
    updatedAt: fixedNow,
    deliveryState: "sent",
  };
}

function selectorEmployeeId(selector: MessageServiceParticipantSelector): string | undefined {
  return typeof selector === "string" ? selector : selector.employeeId;
}

function selectorMemberId(selector: MessageServiceParticipantSelector): string | undefined {
  return typeof selector === "string" ? undefined : selector.memberId;
}

function participantForSelector(conversation: ConversationDto, selector: MessageServiceParticipantSelector) {
  const employeeId = typeof selector === "string" ? selector : selector.employeeId;
  const memberId = typeof selector === "string" ? undefined : selector.memberId;
  const participantId = typeof selector === "string" ? undefined : selector.participantId;
  const participant = conversation.participants.find((candidate) =>
    (participantId !== undefined && candidate.participantId === participantId) ||
    (employeeId !== undefined && candidate.employeeId === employeeId) ||
    (memberId !== undefined && candidate.memberId === memberId)
  );
  assert(participant);
  return participant;
}

class FakeChatRoomMessageApiService implements ChatRoomMessageApiService {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  private readonly conversations = new Map<string, ConversationDto>();
  private readonly messages = new Map<string, MessageDto[]>();

  constructor() {
    const seeded = conversation("acme");
    this.conversations.set(`${seeded.companyId}:${seeded.conversationId}`, seeded);
    this.messages.set(`${seeded.companyId}:${seeded.conversationId}`, [message("acme")]);
  }

  async getConversation(companyId: string, conversationId: string) {
    this.calls.push({ method: "getConversation", args: [companyId, conversationId] });
    return this.conversations.get(`${companyId}:${conversationId}`);
  }

  async listMessages(companyId: string, conversationId: string, cursor?: { cursor?: string; limit?: number }) {
    this.calls.push({ method: "listMessages", args: [companyId, conversationId, cursor] });
    return {
      messages: this.messages.get(`${companyId}:${conversationId}`) || [],
    };
  }

  async sendMessage(
    companyId: string,
    conversationId: string,
    sender: MessageServiceParticipantSelector,
    body: string,
    options?: Parameters<ChatRoomMessageApiService["sendMessage"]>[4],
  ): Promise<SendMessageResult> {
    this.calls.push({ method: "sendMessage", args: [companyId, conversationId, sender, body, options] });
    const senderParticipant = participantForSelector(conversation(companyId, conversationId), sender);
    const sent = {
      ...message(companyId, conversationId, "message-2"),
      sender: {
        participantId: senderParticipant.participantId,
        participantKind: senderParticipant.participantKind,
        employeeId: senderParticipant.employeeId,
        memberId: senderParticipant.memberId,
        displayName: senderParticipant.displayName,
      },
      body,
    };
    return {
      message: sent,
      realtimeEvent: {
        schema: CONVERSATION_MESSAGE_REALTIME_EVENT_SCHEMA,
        version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
        eventId: "event-message",
        type: "message.created",
        occurredAt: fixedNow,
        sequence: 2,
        companyId,
        conversationId,
        messageId: sent.messageId,
        actorMemberId: selectorMemberId(sender),
        payload: {
          deliveryState: "sent",
        },
      },
      conversation: {
        ...conversation(companyId, conversationId),
        lastMessageId: sent.messageId,
        realtimeSequence: 2,
      },
    };
  }

  async markConversationRead(
    companyId: string,
    conversationId: string,
    viewer: MessageServiceParticipantSelector,
    lastReadMessageId?: string,
  ): Promise<MarkConversationReadResult> {
    this.calls.push({ method: "markConversationRead", args: [companyId, conversationId, viewer, lastReadMessageId] });
    const current = conversation(companyId, conversationId);
    const participant = participantForSelector(current, viewer);
    const next = {
      ...current,
      participantStates: current.participantStates.map((state) =>
        state.participantId === participant.participantId
          ? { ...state, lastReadMessageId: lastReadMessageId || current.lastMessageId, unreadCount: 0, mentionCount: 0 }
          : state
      ),
      realtimeSequence: 2,
    };
    return {
      conversation: next,
      realtimeEvent: {
        schema: CONVERSATION_MESSAGE_REALTIME_EVENT_SCHEMA,
        version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
        eventId: "event-read",
        type: "participant.read_state.updated",
        occurredAt: fixedNow,
        sequence: 2,
        companyId,
        conversationId,
        actorMemberId: selectorMemberId(viewer),
        payload: {
          participantId: participant.participantId,
          unreadCount: 0,
          mentionCount: 0,
        },
      },
    };
  }

  async updateConversationTitle(
    companyId: string,
    conversationId: string,
    input: { title: string; titleStatus: "manual" },
  ): Promise<ConversationDto> {
    this.calls.push({ method: "updateConversationTitle", args: [companyId, conversationId, input] });
    const current = this.conversations.get(`${companyId}:${conversationId}`);
    if (!current) {
      throw new Error(`conversation not found: ${conversationId}`);
    }
    const next: ConversationDto = {
      ...current,
      title: input.title,
      titleStatus: input.titleStatus,
      titleSourceMessageId: undefined,
      titleFailureReason: undefined,
      topic: current.topic
        ? {
          ...current.topic,
          title: input.title,
          updatedAt: fixedNow,
        }
        : undefined,
      updatedAt: fixedNow,
    };
    this.conversations.set(`${companyId}:${conversationId}`, next);
    return next;
  }

  async archiveConversationTopic(
    companyId: string,
    conversationId: string,
    actor: MessageServiceParticipantSelector,
  ): Promise<ConversationDto> {
    this.calls.push({ method: "archiveConversationTopic", args: [companyId, conversationId, actor] });
    const current = this.conversations.get(`${companyId}:${conversationId}`);
    if (!current) {
      throw new Error(`conversation not found: ${conversationId}`);
    }
    const next: ConversationDto = {
      ...current,
      topic: current.topic
        ? {
          ...current.topic,
          status: "archived",
          updatedAt: fixedNow,
        }
        : undefined,
      updatedAt: fixedNow,
      realtimeSequence: current.realtimeSequence + 1,
    };
    this.conversations.set(`${companyId}:${conversationId}`, next);
    return next;
  }

  async restoreConversationTopic(
    companyId: string,
    conversationId: string,
    actor: MessageServiceParticipantSelector,
  ): Promise<ConversationDto> {
    this.calls.push({ method: "restoreConversationTopic", args: [companyId, conversationId, actor] });
    const current = this.conversations.get(`${companyId}:${conversationId}`);
    if (!current) {
      throw new Error(`conversation not found: ${conversationId}`);
    }
    const next: ConversationDto = {
      ...current,
      topic: current.topic
        ? {
          ...current.topic,
          status: "open",
          updatedAt: fixedNow,
        }
        : undefined,
      updatedAt: fixedNow,
      realtimeSequence: current.realtimeSequence + 1,
    };
    this.conversations.set(`${companyId}:${conversationId}`, next);
    return next;
  }
}

class CapturingRealtimePublisher implements TinyOfficeRealtimePublisher {
  readonly events: TinyOfficeRealtimeEventPayload[] = [];

  publish(event: TinyOfficeRealtimeEventPayload): TinyOfficeRealtimeEvent {
    this.events.push(event);
    return {
      schema: "tinyoffice-realtime-event",
      version: 1,
      eventId: `event-${this.events.length}`,
      occurredAt: fixedNow,
      sequence: this.events.length,
      ...event,
    };
  }
}

function deterministicIds() {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  };
}

async function makeStandaloneChatStack() {
  const repository = new InMemoryMessageRepository();
  const channelRepository = new InMemoryChannelRepository();
  const channelService = new ChannelService(channelRepository);
  await channelRepository.upsertChannel({
    companyId: "acme",
    chatChannelId: TEST_CHANNEL_ID,
    title: "Ops",
    summary: "Operations Channel",
    members: channelMembers("acme"),
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository,
  });
  const projectionService = new ChatProjectionService({
    conversationSource: messageService,
    channelSource: channelService,
  });
  const createEntryService = new ChatCreateEntryService({
    messageService,
    channelService,
    projectionService,
  });
  return {
    createEntryService,
    messageService,
    projectionService,
    repository,
    channelService,
  };
}

async function withServer(
  service: ChatProjectionApiService,
  run: (
    baseUrl: string,
    createService: FakeChatCreateEntryApiService,
    roomService: FakeChatRoomMessageApiService,
  ) => Promise<void>,
  createService = new FakeChatCreateEntryApiService(),
  roomService = new FakeChatRoomMessageApiService(),
  realtimePublisher?: TinyOfficeRealtimePublisher,
  chatDispatchSink?: ChatDispatchApiSink,
) {
  const server = http.createServer(async (req, res) => {
    const handled = await handleChatProjectionApiRequest(req, res, {
      chatProjectionService: service,
      chatCreateEntryService: createService,
      chatRoomMessageService: roomService,
      realtimePublisher,
      chatDispatchSink,
    });
    if (!handled) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`, createService, roomService);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("chat projection API exposes read-only container and entry projection", async () => {
  const service = new FakeChatProjectionApiService();
  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat?viewerMemberId=xuziho&cursor=2&limit=10`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    const body = await response.json() as { containers: ChatContainerDto[]; entries: ChatEntryDto[] };

    assert.equal(body.containers[0]?.kind, "channel");
    assert.equal(body.entries[0]?.kind, "channel_topic");
    assert.deepEqual(service.calls, [{
      companyId: "acme",
      viewer: { participantKind: "company_member", memberId: "xuziho" },
      cursor: { cursor: "2", limit: 10 },
    }]);
    assert.doesNotMatch(JSON.stringify(body), /\b(teamId|team_id|channelId|channel_id|postId|post_id|rootPostId|root_id|userId|user_id)\b/);
  });
});

test("chat projection API requires company and viewer context", async () => {
  await withServer(new FakeChatProjectionApiService(), async (baseUrl) => {
    const missingCompany = await fetch(`${baseUrl}/api/companies/%20/chat?viewerMemberId=iris-growth`);
    assert.equal(missingCompany.status, 400);
    assert.match(JSON.stringify(await missingCompany.json()), /explicit companyId is required/);

    const missingViewer = await fetch(`${baseUrl}/api/companies/acme/chat`);
    assert.equal(missingViewer.status, 400);
    assert.match(JSON.stringify(await missingViewer.json()), /viewer identity is required/);
  });
});

test("chat projection API rejects public carrier vocabulary in payloads", async () => {
  await withServer(new FakeChatProjectionApiService(true), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat?viewerMemberId=xuziho`);
    assert.equal(response.status, 400);
    assert.match(JSON.stringify(await response.json()), /forbidden carrier field: channelId/);
  });
});

test("chat create-entry API validates request context and returns created entry open target", async () => {
  await withServer(new FakeChatProjectionApiService(), async (baseUrl, createService) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        containerId: TEST_CHANNEL_CONTAINER_ID,
        actorMemberId: "iris-growth",
        actorDisplayName: "Iris",
        title: "Launch checklist",
        firstMessage: {
          body: "Nora, please draft the checklist.",
          mentionedMemberIds: ["nora-automation"],
          runtimeLinks: [{
            linkId: "runtime-link-workrun",
            targetKind: "work_run",
            targetId: "workrun-chat-create-1",
          }],
        },
      }),
    });

    assert.equal(response.status, 201);
    const body = await response.json() as ChatCreateEntryResponse;
    assert.equal(body.schema, "chat-create-entry-result");
    assert.equal(body.entry.kind, "channel_topic");
    assert.equal(body.openTarget.kind, "topic_room");
    assert.equal(body.openTarget.roomId, "conversation-1");
    assert.equal(body.firstMessageId, "message-1");
    assert.deepEqual(createService.calls, [{
      companyId: "acme",
      containerId: TEST_CHANNEL_CONTAINER_ID,
      actorMemberId: "iris-growth",
      actorDisplayName: "Iris",
      title: "Launch checklist",
      memberDisplayNames: undefined,
      firstMessage: {
        body: "Nora, please draft the checklist.",
        mentionedMemberIds: ["nora-automation"],
        runtimeLinks: [{
          linkId: "runtime-link-workrun",
          targetKind: "work_run",
          targetId: "workrun-chat-create-1",
          label: undefined,
          sourceMessageId: undefined,
          createdAt: undefined,
        }],
      },
    }]);
    assert.doesNotMatch(JSON.stringify(body), /\b(teamId|team_id|channelId|channel_id|postId|post_id|userId|user_id)\b/);
  });
});

test("chat room API reads room messages and appends replies through openTarget room ids", async () => {
  await withServer(new FakeChatProjectionApiService(), async (baseUrl, _createService, roomService) => {
    const roomResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1`);
    assert.equal(roomResponse.status, 200);
    const room = await roomResponse.json() as ConversationDto;
    assert.equal(room.schema, "conversation");
    assert.equal(room.conversationId, "conversation-topic-1");

    const messagesResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/messages?cursor=1&limit=25`);
    assert.equal(messagesResponse.status, 200);
    const messages = await messagesResponse.json() as { messages: MessageDto[] };
    assert.deepEqual(messages.messages.map((item) => item.messageId), ["message-1"]);

    const sendResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "nora-automation",
        body: "Reply from the owned Chat room API.",
        mentionedMemberIds: ["iris-growth"],
        runtimeLinks: [{
          linkId: "runtime-link-session",
          targetKind: "session",
          targetId: "session-chat-room",
        }],
      }),
    });
    assert.equal(sendResponse.status, 201);
    const sent = await sendResponse.json() as SendMessageResult;
    assert.equal(sent.message.messageId, "message-2");
    assert.equal(sent.message.conversationId, "conversation-topic-1");
    assert.equal(sent.realtimeEvent.type, "message.created");
    assert.doesNotMatch(JSON.stringify(sent), /\b(teamId|team_id|channelId|channel_id|postId|post_id|rootPostId|root_id|userId|user_id)\b/);

    const readResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        viewerMemberId: "nora-automation",
        lastReadMessageId: "message-2",
      }),
    });
    assert.equal(readResponse.status, 200);
    const read = await readResponse.json() as MarkConversationReadResult;
    assert.equal(read.realtimeEvent.type, "participant.read_state.updated");
    assert.equal(
      read.conversation.participantStates.find((state) => state.memberId === "nora-automation")?.lastReadMessageId,
      "message-2",
    );

    assert.deepEqual(roomService.calls.map((call) => call.method), [
      "getConversation",
      "listMessages",
      "sendMessage",
      "markConversationRead",
    ]);
    assert.deepEqual(roomService.calls[2]?.args, [
      "acme",
      "conversation-topic-1",
      { participantKind: "company_member", memberId: "nora-automation" },
      "Reply from the owned Chat room API.",
      {
        attachmentIds: undefined,
        attachments: undefined,

        mentionedMemberIds: ["iris-growth"],
        runtimeLinks: [{
          linkId: "runtime-link-session",
          targetKind: "session",
          targetId: "session-chat-room",
          label: undefined,
          sourceMessageId: undefined,
          createdAt: undefined,
        }],
      },
    ]);
  });
});

test("chat room API lets users manually rename a room title and marks it manual", async () => {
  const publisher = new CapturingRealtimePublisher();
  await withServer(
    new FakeChatProjectionApiService(),
    async (baseUrl, _createService, roomService) => {
      const response = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/title`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "xuziho",
          title: "Website analytics employee setup",
        }),
      });

      assert.equal(response.status, 200, await response.clone().text());
      const renamed = await response.json() as ConversationDto;
      assert.equal(renamed.title, "Website analytics employee setup");
      assert.equal(renamed.titleStatus, "manual");
      assert.equal(renamed.titleSourceMessageId, undefined);
      assert.equal(renamed.topic?.title, "Website analytics employee setup");
      assert.deepEqual(roomService.calls.at(-1), {
        method: "updateConversationTitle",
        args: [
          "acme",
          "conversation-topic-1",
          {
            title: "Website analytics employee setup",
            titleStatus: "manual",
          },
        ],
      });
      assert.deepEqual(
        publisher.events.filter((event) => event.type === "chat.projection.changed"),
        [
          { type: "chat.projection.changed", companyId: "acme", viewerMemberId: "xuziho" },
          { type: "chat.projection.changed", companyId: "acme", viewerMemberId: "nora-automation" },
        ],
      );
    },
    new FakeChatCreateEntryApiService(),
    new FakeChatRoomMessageApiService(),
    publisher,
  );
});

test("chat room API archives topic rooms and publishes active projection changes", async () => {
  const publisher = new CapturingRealtimePublisher();
  await withServer(
    new FakeChatProjectionApiService(),
    async (baseUrl, _createService, roomService) => {
      const response = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "xuziho",
          confirmation: "ARCHIVE",
        }),
      });

      assert.equal(response.status, 200, await response.clone().text());
      const archived = await response.json() as ConversationDto;
      assert.equal(archived.topic?.status, "archived");
      assert.equal(archived.realtimeSequence, 2);
      assert.deepEqual(roomService.calls.at(-1), {
        method: "archiveConversationTopic",
        args: [
          "acme",
          "conversation-topic-1",
          { participantKind: "company_member", memberId: "xuziho" },
        ],
      });
      assert.deepEqual(
        publisher.events.filter((event) => event.type === "chat.projection.changed"),
        [
          { type: "chat.projection.changed", companyId: "acme", viewerMemberId: "xuziho" },
          { type: "chat.projection.changed", companyId: "acme", viewerMemberId: "nora-automation" },
        ],
      );
    },
    new FakeChatCreateEntryApiService(),
    new FakeChatRoomMessageApiService(),
    publisher,
  );
});

test("chat room API restores archived topic rooms and publishes active projection changes", async () => {
  const publisher = new CapturingRealtimePublisher();
  await withServer(
    new FakeChatProjectionApiService(),
    async (baseUrl, _createService, roomService) => {
      await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "xuziho",
          confirmation: "ARCHIVE",
        }),
      });

      const response = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "xuziho",
          confirmation: "RESTORE",
        }),
      });

      assert.equal(response.status, 200, await response.clone().text());
      const restored = await response.json() as ConversationDto;
      assert.equal(restored.topic?.status, "open");
      assert.equal(restored.realtimeSequence, 3);
      assert.deepEqual(roomService.calls.at(-1), {
        method: "restoreConversationTopic",
        args: [
          "acme",
          "conversation-topic-1",
          { participantKind: "company_member", memberId: "xuziho" },
        ],
      });
      assert.deepEqual(
        publisher.events.filter((event) => event.type === "chat.projection.changed"),
        [
          { type: "chat.projection.changed", companyId: "acme", viewerMemberId: "xuziho" },
          { type: "chat.projection.changed", companyId: "acme", viewerMemberId: "nora-automation" },
          { type: "chat.projection.changed", companyId: "acme", viewerMemberId: "xuziho" },
          { type: "chat.projection.changed", companyId: "acme", viewerMemberId: "nora-automation" },
        ],
      );
    },
    new FakeChatCreateEntryApiService(),
    new FakeChatRoomMessageApiService(),
    publisher,
  );
});

test("chat mutation API publishes TinyOffice realtime events for entry, message, read, and projection changes", async () => {
  const publisher = new CapturingRealtimePublisher();
  await withServer(
    new FakeChatProjectionApiService(),
    async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/companies/acme/chat/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          containerId: TEST_CHANNEL_CONTAINER_ID,
          actorMemberId: "iris-growth",
          title: "Launch checklist",
          firstMessage: { body: "Create the checklist." },
        }),
      });
      assert.equal(createResponse.status, 201, await createResponse.clone().text());

      const sendResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "nora-automation",
          body: "Reply from another client.",
        }),
      });
      assert.equal(sendResponse.status, 201);

      const readResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          viewerMemberId: "nora-automation",
          lastReadMessageId: "message-2",
        }),
      });
      assert.equal(readResponse.status, 200);

      assert.deepEqual(publisher.events.map((event) => event.type), [
        "chat.entry.created",
        "chat.message.created",
        "chat.projection.changed",
        "chat.message.created",
        "chat.projection.changed",
        "chat.projection.changed",
        "chat.read_state.updated",
        "chat.projection.changed",
      ]);
      assert.deepEqual(publisher.events[0], {
        type: "chat.entry.created",
        companyId: "acme",
        containerId: TEST_CHANNEL_CONTAINER_ID,
        entryId: "chat-entry-channel-topic-topic-1",
        roomId: "conversation-1",
      });
      assert.deepEqual(publisher.events[3], {
        type: "chat.message.created",
        companyId: "acme",
        conversationId: "conversation-topic-1",
        roomId: "conversation-topic-1",
        messageId: "message-2",
      });
      assert.deepEqual(publisher.events[6], {
        type: "chat.read_state.updated",
        companyId: "acme",
        roomId: "conversation-topic-1",
        memberId: "nora-automation",
      });
    },
    new FakeChatCreateEntryApiService(),
    new FakeChatRoomMessageApiService(),
    publisher,
  );
});

test("chat mutation API creates entries and replies without legacy Mattermost projection accounts", async () => {
  const stack = await makeStandaloneChatStack();
  await withServer(
    stack.projectionService,
    async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/companies/acme/chat/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          containerId: TEST_CHANNEL_CONTAINER_ID,
          actorMemberId: "iris-growth",
          actorDisplayName: "Iris",
          title: "Standalone Chat topic",
          firstMessage: { body: "Create through standalone Chat without Mattermost projection." },
        }),
      });
      assert.equal(createResponse.status, 201, await createResponse.clone().text());
      const created = await createResponse.json() as ChatCreateEntryResponse;
      assert.equal(created.firstMessageId, "message-1");
      assert.equal(created.openTarget.roomId, "conversation-1");

      const replyResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/${created.openTarget.roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "iris-growth",
          body: "Reply through standalone Chat without Mattermost projection.",
        }),
      });
      assert.equal(replyResponse.status, 201);
      const reply = await replyResponse.json() as SendMessageResult;
      assert.equal(reply.message.messageId, "message-2");
      assert.equal(reply.conversation.lastMessageId, "message-2");

      const conversationRecord = await stack.repository.getConversation("acme", created.openTarget.roomId);
      assert.equal(conversationRecord?.conversation.lastMessageId, "message-2");
      assert.deepEqual((await stack.messageService.listMessages("acme", created.openTarget.roomId)).messages.map((item) => item.messageId), [
        "message-1",
        "message-2",
      ]);

      assert.doesNotMatch(JSON.stringify(created), /\b(teamId|team_id|channelId|channel_id|postId|post_id|userId|user_id)\b/);
      assert.doesNotMatch(JSON.stringify(reply), /\b(teamId|team_id|channelId|channel_id|postId|post_id|userId|user_id)\b/);
    },
    stack.createEntryService,
    stack.messageService,
  );
});

test("chat APIs list, send, read, and publish projection changes for Company Member viewers", async () => {
  const stack = await makeStandaloneChatStack();
  const publisher = new CapturingRealtimePublisher();
  const memberChannel = await stack.channelService.createChannel({
    companyId: "acme",
    title: "Boss channel",
    actor: {
      participantKind: "company_member",
      memberId: "xuziho",
      displayName: "Xu Ziho",
    },
    members: [{
      memberId: "nora-automation",
      displayName: "Nora",
      hasRuntimeProfile: true,
    }],
  });
  await stack.messageService.createConversation("acme", {
    title: "Boss and automation topic",
    conversationKind: "topic",
    topic: {
      topicId: "topic-boss-automation",
      chatChannelId: memberChannel.chatChannelId,
      title: "Boss and automation topic",
    },
    participants: [
      {
        participantKind: "company_member",
        memberId: "xuziho",
        displayName: "Xu Ziho",
        role: "boss",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
      },
    ],
  });
  await stack.messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "nora-automation" },
    "Status is ready.",
  );

  await withServer(
    stack.projectionService,
    async (baseUrl) => {
      const projectionResponse = await fetch(`${baseUrl}/api/companies/acme/chat?viewerMemberId=xuziho`);
      assert.equal(projectionResponse.status, 200, await projectionResponse.clone().text());
      const projection = await projectionResponse.json() as { entries: ChatEntryDto[] };
      assert.equal(projection.entries[0]?.openTarget.roomId, "conversation-1");
      assert.equal(projection.entries[0]?.unreadCount, 1);

      const sendResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "xuziho",
          body: "Thanks Nora. Please keep watching this.",
          mentionedMemberIds: ["nora-automation"],
        }),
      });
      assert.equal(sendResponse.status, 201, await sendResponse.clone().text());
      const sent = await sendResponse.json() as SendMessageResult;
      assert.equal(sent.message.sender.participantKind, "company_member");
      assert.equal(sent.message.sender.memberId, "xuziho");
      assert.equal(sent.message.sender.employeeId, undefined);
      assert.equal(sent.realtimeEvent.actorMemberId, "xuziho");

      const readResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          viewerMemberId: "xuziho",
          lastReadMessageId: sent.message.messageId,
        }),
      });
      assert.equal(readResponse.status, 200, await readResponse.clone().text());
      const read = await readResponse.json() as MarkConversationReadResult;
      const memberState = read.conversation.participantStates.find((state) => state.memberId === "xuziho");
      assert.equal(memberState?.lastReadMessageId, sent.message.messageId);
      assert.equal(memberState?.unreadCount, 0);
      assert.equal(read.realtimeEvent.actorMemberId, "xuziho");

      assert.deepEqual(
        publisher.events.filter((event) => event.type === "chat.projection.changed" && "viewerMemberId" in event),
        [
          { type: "chat.projection.changed", companyId: "acme", viewerMemberId: "xuziho" },
          { type: "chat.projection.changed", companyId: "acme", viewerMemberId: "nora-automation" },
          { type: "chat.projection.changed", companyId: "acme", viewerMemberId: "xuziho" },
        ],
      );
      assert.deepEqual(
        publisher.events.find((event) => event.type === "chat.read_state.updated"),
        { type: "chat.read_state.updated", companyId: "acme", roomId: "conversation-1", memberId: "xuziho" },
      );

    },
    stack.createEntryService,
    stack.messageService,
    publisher,
  );
});

test("chat room API rejects missing context, company mismatch, and carrier fields", async () => {
  await withServer(new FakeChatProjectionApiService(), async (baseUrl) => {
    const missingCompany = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorMemberId: "iris-growth",
        body: "No body company.",
      }),
    });
    assert.equal(missingCompany.status, 400);
    assert.match(JSON.stringify(await missingCompany.json()), /companyId is required/);

    const mismatch = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "other-company",
        viewerMemberId: "iris-growth",
      }),
    });
    assert.equal(mismatch.status, 403);
    assert.match(JSON.stringify(await mismatch.json()), /companyId mismatch/);

    const carrierField = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "iris-growth",
        body: "Carrier leak.",
        postId: "carrier-post",
      }),
    });
    assert.equal(carrierField.status, 400);
    assert.match(JSON.stringify(await carrierField.json()), /forbidden carrier field: postId/);

    const missingRoom = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/missing-room`);
    assert.equal(missingRoom.status, 404);
    assert.match(JSON.stringify(await missingRoom.json()), /chat room not found/);
  });
});

test("chat mutation API forwards carrier-free events to the TinyOffice dispatch sink", async () => {
  const dispatchEvents: ChatDispatchApiEvent[] = [];
  const sink: ChatDispatchApiSink = {
    handleChatDispatchEvent(event) {
      dispatchEvents.push(event);
    },
  };
  await withServer(
    new FakeChatProjectionApiService(),
    async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/companies/acme/chat/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          containerId: TEST_CHANNEL_CONTAINER_ID,
          actorMemberId: "iris-growth",
          title: "Launch checklist",
          firstMessage: {
            body: "Nora, please draft the checklist.",
            mentionedMemberIds: ["nora-automation"],
          },
        }),
      });
      assert.equal(createResponse.status, 201);

      const sendResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "nora-automation",
          body: "Iris, ready for review.",
          mentionedMemberIds: ["iris-growth"],
        }),
      });
      assert.equal(sendResponse.status, 201);

      assert.deepEqual(dispatchEvents, [
        {
          source: "chat_entry",
          companyId: "acme",
          roomId: "conversation-1",
          actorMemberId: "iris-growth",
          messageId: "message-1",
          body: "Nora, please draft the checklist.",
          mentionedMemberIds: ["nora-automation"],
          containerId: TEST_CHANNEL_CONTAINER_ID,
          entryId: "chat-entry-channel-topic-topic-1",
          openTargetKind: "topic_room",
        },
        {
          source: "chat_room_message",
          companyId: "acme",
          roomId: "conversation-topic-1",
          actorMemberId: "nora-automation",
          messageId: "message-2",
          body: "Iris, ready for review.",
          mentionedMemberIds: ["iris-growth"],
        },
      ]);
      assert.doesNotMatch(JSON.stringify(dispatchEvents), /\b(teamId|team_id|channelId|channel_id|postId|post_id|rootPostId|root_id|userId|user_id)\b/);
    },
    new FakeChatCreateEntryApiService(),
    new FakeChatRoomMessageApiService(),
    undefined,
    sink,
  );
});

test("chat mutation API does not wait for runtime dispatch before returning saved messages", async () => {
  let releaseDispatch: (() => void) | undefined;
  let resolveDispatchStarted: (event: ChatDispatchApiEvent) => void = () => undefined;
  const dispatchStarted = new Promise<ChatDispatchApiEvent>((resolve) => {
    resolveDispatchStarted = resolve;
  });
  const sink: ChatDispatchApiSink = {
    async handleChatDispatchEvent(event) {
      resolveDispatchStarted(event);
      await new Promise<void>((resolve) => {
        releaseDispatch = resolve;
      });
    },
  };

  const serverDone = withServer(
    new FakeChatProjectionApiService(),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-topic-1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "nora-automation",
          body: "Iris, ready for review.",
          mentionedMemberIds: ["iris-growth"],
        }),
      });
      assert.equal(response.status, 201);
      const body = await response.json() as SendMessageResult;
      assert.equal(body.message.messageId, "message-2");
      releaseDispatch?.();
    },
    new FakeChatCreateEntryApiService(),
    new FakeChatRoomMessageApiService(),
    undefined,
    sink,
  );

  const event = await dispatchStarted;
  await serverDone;
  assert.deepEqual(event, {
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-topic-1",
    actorMemberId: "nora-automation",
    messageId: "message-2",
    body: "Iris, ready for review.",
    mentionedMemberIds: ["iris-growth"],
  });
  assert.doesNotMatch(JSON.stringify(event), /\b(teamId|team_id|channelId|channel_id|postId|post_id|rootPostId|root_id|userId|user_id)\b/);
});

test("chat create-entry API rejects missing context, company mismatch, and carrier fields", async () => {
  await withServer(new FakeChatProjectionApiService(), async (baseUrl) => {
    const missingCompany = await fetch(`${baseUrl}/api/companies/acme/chat/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        containerId: TEST_CHANNEL_CONTAINER_ID,
          actorMemberId: "iris-growth",
        title: "Missing company",
        firstMessage: { body: "No body company." },
      }),
    });
    assert.equal(missingCompany.status, 400);
    assert.match(JSON.stringify(await missingCompany.json()), /companyId is required/);

    const mismatch = await fetch(`${baseUrl}/api/companies/acme/chat/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "other-company",
        containerId: TEST_CHANNEL_CONTAINER_ID,
          actorMemberId: "iris-growth",
        title: "Wrong company",
        firstMessage: { body: "Wrong company." },
      }),
    });
    assert.equal(mismatch.status, 403);
    assert.match(JSON.stringify(await mismatch.json()), /companyId mismatch/);

    const carrierField = await fetch(`${baseUrl}/api/companies/acme/chat/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        containerId: TEST_CHANNEL_CONTAINER_ID,
          actorMemberId: "iris-growth",
        title: "Carrier field",
        channelId: "carrier-channel",
        firstMessage: { body: "Carrier leak." },
      }),
    });
    assert.equal(carrierField.status, 400);
    assert.match(JSON.stringify(await carrierField.json()), /forbidden carrier field: channelId/);
  });
});

