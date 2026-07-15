import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assembleTinyOfficeChatRoomContext,
  buildNaturalLanguageInputFromTinyOfficeChatRoomContext,
  buildTinyOfficeChatStructuredHandoffDispatch,
  buildTinyOfficeChatTurnDispatches,
  executeTinyOfficeChatNaturalLanguageTurn,
  handleTinyOfficeChatExecutionDispatch,
  persistTinyOfficeChatNaturalLanguageReply,
  TinyOfficeChatTurnDispatchBoundary,
  updateTinyOfficeChatExecutionDispatchStatus,
} from "../../src/runtime/realtime/tinyoffice-chat-turn-dispatch.js";
import { createTinyOfficeChatRuntimeDispatchSink } from "../../src/runtime/chat/tinyoffice-chat-runtime-dispatch.js";
import { resolveChatTurnStateAction } from "../../src/runtime/realtime/chat-turn-state-action.js";
import type { NaturalLanguageResponseInput } from "../../src/runtime/provider/natural-language-responder.js";
import { normalizePiProviderEvent } from "../../src/runtime/provider/pi-runtime-provider.js";
import {
  CONVERSATION_DTO_SCHEMA,
  CONVERSATION_MESSAGE_CONTRACT_VERSION,
  MESSAGE_DTO_SCHEMA,
  PARTICIPANT_DTO_SCHEMA,
  type ConversationDto,
  type MessageDto,
} from "../../src/collaboration/contracts/conversation-message-contract.js";
import {
  createTinyOfficeRealtimeEvent,
  type TinyOfficeRealtimeEvent,
  type TinyOfficeRealtimeEventPayload,
  type TinyOfficeRealtimePublisher,
} from "../../src/collaboration/contracts/tinyoffice-realtime-contract.js";
import type { ProcessTraceEvent } from "../../src/runtime/contracts/process-trace-event.js";
import {
  type RuntimeSessionRecord,
  type RuntimeSessionEvent,
  type RuntimeSessionRepositoryLike,
} from "../../src/runtime/storage/runtime-session-repository.js";
import type { EmployeeHome } from "../../src/runtime/registry/employee-home.js";
import { MessageService } from "../../src/collaboration/message/message-service.js";
import { InMemoryMessageRepository } from "../../src/collaboration/message/message-repository.js";

const fixedNow = "2026-06-24T04:30:00.000Z";
const forbiddenCarrierFieldPattern =
  /\b(teamId|team_id|channelId|channel_id|postId|post_id|rootPostId|root_post_id|userId|user_id)\b/;

test("TinyOffice Chat turn dispatch public entry stays a thin runtime boundary", async () => {
  const source = await readFile("src/runtime/realtime/tinyoffice-chat-turn-dispatch.ts", "utf8");
  const lineCount = source.trimEnd().split(/\r?\n/).length;

  assert.ok(lineCount <= 180, `expected public entry to stay thin, got ${lineCount} lines`);
  assert.doesNotMatch(source, /generateNaturalLanguageEmployeeReply/);
  assert.doesNotMatch(source, /sendMessage\(/);
  assert.doesNotMatch(source, /appendSessionEvent\(/);
});

function emitPiTestProviderEvent(
  replyInput: { onProviderEvent?: (event: ReturnType<typeof normalizePiProviderEvent>) => void },
  event: unknown,
) {
  replyInput.onProviderEvent?.(normalizePiProviderEvent(replyInput as never, event));
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

function conversation(kind: ConversationDto["conversationKind"], conversationId = "conversation-1"): ConversationDto {
  return {
    schema: CONVERSATION_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId: "acme",
    conversationId,
    title: kind === "direct" ? "Iris and Nora" : "Launch topic",
    conversationKind: kind,
    topic: kind === "topic"
      ? {
          schema: "conversation-topic-state",
          version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
          companyId: "acme",
          conversationId,
          topicId: "topic-launch",
          title: "Launch topic",
          status: "open",
          participantIds: ["participant-member-iris-growth", "participant-member-nora-automation"],
          createdAt: fixedNow,
          updatedAt: fixedNow,
        }
      : undefined,
    participants: [
      memberParticipant("acme", conversationId, "iris-growth"),
      memberParticipant("acme", conversationId, "nora-automation"),
    ],
    participantStates: [],
    runtimeLinks: [],
    realtimeSequence: 1,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  };
}

function memberDirectConversation(conversationId = "conversation-dm-member"): ConversationDto {
  return {
    ...conversation("direct", conversationId),
    title: "Xu and Nora",
    participants: [
      memberParticipant("acme", conversationId, "xuziho"),
      memberParticipant("acme", conversationId, "nora-automation"),
    ],
  };
}

function memberTopicConversation(conversationId = "conversation-topic-member"): ConversationDto {
  return {
    ...conversation("topic", conversationId),
    participants: [
      memberParticipant("acme", conversationId, "xuziho"),
      memberParticipant("acme", conversationId, "iris-growth"),
      memberParticipant("acme", conversationId, "nora-automation"),
    ],
  };
}

function memberRuntimeTopicConversation(conversationId = "conversation-topic-member-runtime"): ConversationDto {
  return {
    ...conversation("topic", conversationId),
    participants: [
      memberParticipant("acme", conversationId, "xuziho"),
      memberParticipant("acme", conversationId, "nora-automation"),
    ],
  };
}

function memberRuntimeHandoffTopicConversation(conversationId = "conversation-topic-member-runtime-handoff"): ConversationDto {
  return {
    ...conversation("topic", conversationId),
    participants: [
      memberParticipant("acme", conversationId, "xuziho"),
      memberParticipant("acme", conversationId, "nora-automation"),
      memberParticipant("acme", conversationId, "iris"),
    ],
  };
}

function message(input: {
  conversationId?: string;
  messageId: string;
  senderMemberId: string;
  body: string;
  createdAt: string;
  mentionedMemberIds?: string[];
  attachments?: MessageDto["attachments"];
}): MessageDto {
  const conversationId = input.conversationId || "conversation-1";
  return {
    schema: MESSAGE_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId: "acme",
    conversationId,
    messageId: input.messageId,
    sender: {
      participantId: `participant-member-${input.senderMemberId}`,
      participantKind: "company_member",
      memberId: input.senderMemberId,
      displayName: input.senderMemberId,
    },
    body: input.body,
    mentions: (input.mentionedMemberIds || []).map((memberId) => ({
      schema: "message-mention",
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId: "acme",
      conversationId,
      messageId: input.messageId,
      participantId: `participant-member-${memberId}`,
      memberId,
      createdAt: input.createdAt,
    })),
    attachments: input.attachments ?? [],
    runtimeLinks: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    deliveryState: "sent",
  };
}

function employeeHome(employeeId = "nora-automation"): EmployeeHome {
  return {
    companyId: "acme",
    employeeId,
    homePath: `/tmp/tinyoffice/companies/acme/employees/${employeeId}`,
    workspacePath: `/tmp/tinyoffice/companies/acme/employees/${employeeId}/workspace`,
    profile: {
      employeeId,
      role: "automation",
      displayName: "Nora",
      presenceMode: "resident",
      mountedActions: [],
    },
    resourcePolicy: { version: 1, filesystem: {} },
  };
}

function emitHandoffTopicTurn(
  input: Parameters<NonNullable<NaturalLanguageResponseInput["runtimeProvider"]>["reply"]>[0],
  args: { toId: string },
): void {
  emitPiTestProviderEvent(input, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{
        type: "toolCall",
        name: "handoff_topic_turn",
        arguments: args,
      }],
    },
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: {
        name: "handoff_topic_turn",
        arguments: args,
      },
    },
    participantProfiles: [
      { id: "employee-hr", runtimeCapable: true },
      { id: "avery-webb", runtimeCapable: true },
    ],
  });
}

function conversationWithTopicSummary(conversationId = "conversation-1"): ConversationDto {
  const base = conversation("topic", conversationId);
  return {
    ...base,
    topic: base.topic
      ? {
        ...base.topic,
        summary: {
          text: "The team agreed to validate workspace files, then hand results to the web designer.",
          sourceMessageId: "message-21",
          updatedAt: "2026-06-24T04:50:00.000Z",
        },
      }
      : undefined,
  };
}

function emitStreamingHandoffTopicTurn(
  input: Parameters<NonNullable<NaturalLanguageResponseInput["runtimeProvider"]>["reply"]>[0],
  args: { toId: string },
): void {
  emitPiTestProviderEvent(input, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{
        type: "toolCall",
        name: "handoff_topic_turn",
        arguments: {},
      }],
    },
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 0,
      toolCall: {
        name: "handoff_topic_turn",
        arguments: {},
      },
    },
    participantProfiles: [
      { id: "employee-hr", runtimeCapable: true },
      { id: "avery-webb", runtimeCapable: true },
    ],
  });
  emitHandoffTopicTurn(input, args);
}

function memoryRuntimeSessionRepository(): {
  repository: RuntimeSessionRepositoryLike;
  records: RuntimeSessionRecord[];
  events: RuntimeSessionEvent[];
} {
  const records: RuntimeSessionRecord[] = [];
  const events: RuntimeSessionEvent[] = [];
  const repository = {
    upsertSessionRecord(input: Partial<RuntimeSessionRecord> & Pick<RuntimeSessionRecord, "id" | "employeeId" | "sessionKey" | "sessionId" | "sceneType" | "status" | "startedAt" | "updatedAt">) {
      const record = {
        eventCount: 0,
        userMessageCount: 0,
        assistantMessageCount: 0,
        toolCallCount: 0,
        toolResultCount: 0,
        tokenInputTotal: 0,
        tokenOutputTotal: 0,
        tokenCacheTotal: 0,
        byteSize: 0,
        truncated: false,
        ...input,
      } satisfies RuntimeSessionRecord;
      const index = records.findIndex((existing) => existing.id === record.id);
      if (index >= 0) {
        records[index] = record;
      } else {
        records.push(record);
      }
      return record;
    },
    appendSessionEvent(input: RuntimeSessionEvent) {
      events.push(input);
      return input;
    },
    getSessionRecord(id: string) {
      return records.find((record) => record.id === id);
    },
    getSessionDetail(id: string) {
      const record = records.find((candidate) => candidate.id === id);
      return record
        ? { record, events: events.filter((event) => event.sessionRecordId === id) }
        : undefined;
    },
    listSessionRecords(input?: { employeeId?: string; sessionKey?: string; limit?: number }) {
      const filtered = records
        .filter((record) => !input?.employeeId || record.employeeId === input.employeeId)
        .filter((record) => !input?.sessionKey || record.sessionKey === input.sessionKey)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
      return input?.limit ? filtered.slice(0, input.limit) : filtered;
    },
    listSessionEvents(sessionRecordId: string) {
      return events.filter((event) => event.sessionRecordId === sessionRecordId);
    },
    appendProcessTraceEvent(input: never) {
      return input;
    },
    listProcessTraceEvents() {
      return [];
    },
    appendCollaborationActionEvent(input: never) {
      return input;
    },
    listCollaborationActionEvents() {
      return [];
    },
    upsertMemorySummary(input: never) {
      return input;
    },
    listMemorySummaries() {
      return [];
    },
    upsertRetentionState(input: never) {
      return input;
    },
    getRetentionState() {
      return undefined;
    },
    cleanupRuntimeStorage() {
      return {
        state: {
          id: "memory",
          policy: { maxSessionRecords: 100, maxSessionEvents: 1000 },
          deletedSessionCount: 0,
          deletedEventCount: 0,
          updatedAt: fixedNow,
        },
        deletedSessionCount: 0,
        deletedEventCount: 0,
      };
    },
    async save() {},
    close() {},
  } as unknown as RuntimeSessionRepositoryLike;
  return { repository, records, events };
}

function deterministicIds() {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  };
}

class CapturingRealtimePublisher implements TinyOfficeRealtimePublisher {
  readonly payloads: TinyOfficeRealtimeEventPayload[] = [];
  readonly events: TinyOfficeRealtimeEvent[] = [];

  publish(payload: TinyOfficeRealtimeEventPayload): TinyOfficeRealtimeEvent {
    this.payloads.push(payload);
    const event = createTinyOfficeRealtimeEvent(payload, {
      eventId: `tinyoffice-realtime-event-${this.payloads.length}`,
      occurredAt: fixedNow,
      sequence: this.payloads.length,
    });
    this.events.push(event);
    return event;
  }
}

test("TinyOffice Chat turn dispatch routes topic messages by structured mentions", () => {
  const decisions = buildTinyOfficeChatTurnDispatches({
    source: "chat_entry",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-1",
    body: "Nora, please draft the checklist.",
    mentionedMemberIds: ["nora-automation"],
    conversation: conversation("topic"),
    employeeIds: ["iris-growth", "nora-automation"],
  });

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.kind, "routable");
  assert.deepEqual(decisions[0], {
    kind: "routable",
    source: "chat_entry",
    reason: "mentioned_member",
    eventKey: "tinyoffice_chat:chat_entry:acme:conversation-1:message-1:nora-automation",
    chainId: "tinyoffice_chat_chain:acme:conversation-1:message-1",
    companyId: "acme",
    roomId: "conversation-1",
    messageId: "message-1",
    actorMemberId: "iris-growth",
    targetMemberId: "nora-automation",
    normalizedMessage: "Nora, please draft the checklist.",
    preferredLanguage: "en-US",
    prefersChinese: false,
    sceneType: "chat_topic_room",
    sessionKey: "nora-automation|chat_topic_room|conversation-1",
  });
  assert.doesNotMatch(JSON.stringify(decisions), /\b(teamId|team_id|channelId|channel_id|postId|post_id|rootPostId|root_id|userId|user_id)\b/);
});

test("TinyOffice Chat turn dispatch routes direct rooms to the peer without Mattermost payloads", () => {
  const decisions = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-dm-1",
    actorMemberId: "iris-growth",
    messageId: "message-2",
    body: "Can you review this?",
    conversation: conversation("direct", "conversation-dm-1"),
    employeeIds: ["iris-growth", "nora-automation"],
  });

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.kind, "routable");
  assert.equal(decisions[0]?.targetMemberId, "nora-automation");
  assert.equal(decisions[0]?.reason, "direct_room_peer");
  assert.equal(decisions[0]?.sceneType, "chat_direct_room");
  assert.equal(decisions[0]?.sessionKey, "nora-automation|chat_direct_room|conversation-dm-1");
});

test("TinyOffice Chat turn dispatch fails closed for unsupported conversation kinds", () => {
  assert.throws(
    () => buildTinyOfficeChatTurnDispatches({
      source: "chat_room_message",
      companyId: "acme",
      roomId: "conversation-legacy-shared",
      actorMemberId: "iris-growth",
      messageId: "message-legacy-shared",
      body: "Nora, please inspect this.",
      mentionedMemberIds: ["nora-automation"],
      conversation: {
        ...conversation("topic", "conversation-legacy-shared"),
        conversationKind: "shared" as ConversationDto["conversationKind"],
      },
      employeeIds: ["iris-growth", "nora-automation"],
    }),
    /Unsupported Chat conversationKind: shared/,
  );
});

test("TinyOffice Chat turn dispatch chooses one stable runtime participant when a topic message has no mention", () => {
  const decisions = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-3",
    body: "General update for the room.",
    conversation: conversation("topic"),
    employeeIds: ["iris-growth", "nora-automation"],
  });

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.kind, "routable");
  assert.equal(decisions[0]?.reason, "stable_random_topic_member");
  assert.equal(decisions[0]?.targetMemberId, "nora-automation");
});

test("TinyOffice Chat turn dispatch routes member actors in direct rooms to the runtime peer", () => {
  const decisions = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-dm-member",
    actorMemberId: "xuziho",
    messageId: "message-member-dm",
    body: "HR, please respond here.",
    conversation: memberDirectConversation("conversation-dm-member"),
    employeeIds: ["nora-automation"],
  });

  assert.deepEqual(decisions, [{
    kind: "routable",
    source: "chat_room_message",
    reason: "direct_room_peer",
    eventKey: "tinyoffice_chat:chat_room_message:acme:conversation-dm-member:message-member-dm:nora-automation",
    chainId: "tinyoffice_chat_chain:acme:conversation-dm-member:message-member-dm",
    companyId: "acme",
    roomId: "conversation-dm-member",
    messageId: "message-member-dm",
    actorMemberId: "xuziho",
    targetMemberId: "nora-automation",
    normalizedMessage: "HR, please respond here.",
    preferredLanguage: "en-US",
    prefersChinese: false,
    sceneType: "chat_direct_room",
    sessionKey: "nora-automation|chat_direct_room|conversation-dm-member",
  }]);
  assert.equal("actorEmployeeId" in (decisions[0] || {}), false);
});

test("TinyOffice Chat turn dispatch routes member mentions only to the explicit employee target", () => {
  const decisions = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-topic-member",
    actorMemberId: "xuziho",
    messageId: "message-member-mention",
    body: "Nora, please handle this.",
    mentionedMemberIds: ["nora-automation"],
    conversation: memberTopicConversation("conversation-topic-member"),
    employeeIds: ["iris-growth", "nora-automation"],
  });

  assert.equal(decisions.length, 1);
  assert.deepEqual(decisions[0], {
    kind: "routable",
    source: "chat_room_message",
    reason: "mentioned_member",
    eventKey: "tinyoffice_chat:chat_room_message:acme:conversation-topic-member:message-member-mention:nora-automation",
    chainId: "tinyoffice_chat_chain:acme:conversation-topic-member:message-member-mention",
    companyId: "acme",
    roomId: "conversation-topic-member",
    messageId: "message-member-mention",
    actorMemberId: "xuziho",
    targetMemberId: "nora-automation",
    normalizedMessage: "Nora, please handle this.",
    preferredLanguage: "en-US",
    prefersChinese: false,
    sceneType: "chat_topic_room",
    sessionKey: "nora-automation|chat_topic_room|conversation-topic-member",
  });
  assert.equal("actorEmployeeId" in (decisions[0] || {}), false);
});

test("TinyOffice Chat room context allows runtime employee targets represented as member participants", async () => {
  const decision = buildTinyOfficeChatTurnDispatches({
    source: "chat_entry",
    companyId: "acme",
    roomId: "conversation-topic-member-runtime",
    actorMemberId: "xuziho",
    messageId: "message-member-runtime-mention",
    body: "@Nora can you confirm receipt?",
    mentionedMemberIds: ["nora-automation"],
    conversation: memberRuntimeTopicConversation("conversation-topic-member-runtime"),
    employeeIds: ["nora-automation"],
  })[0];
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }

  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return memberRuntimeTopicConversation("conversation-topic-member-runtime");
      },
      async listRecentMessages() {
        return { messages: [] };
      },
    },
    participantProfiles: [
      { id: "iris-growth", runtimeCapable: true },
      { id: "nora-automation", runtimeCapable: true },
    ],
  });

  assert.equal(context.targetMemberId, "nora-automation");
  assert.deepEqual(context.conversation.handoffCandidates.map((participant) => participant.id), ["xuziho"]);
});

test("TinyOffice Chat room context exposes handoff candidates without the current actor", async () => {
  const conversationWithRoles: ConversationDto = {
    ...memberTopicConversation("conversation-visible-participants"),
    participants: [
      {
        ...memberParticipant("acme", "conversation-visible-participants", "xuziho"),
        displayName: "Xuziho",
        role: "boss",
      },
      {
        ...memberParticipant("acme", "conversation-visible-participants", "employee-hr"),
        displayName: "Mira",
        role: "hr",
      },
      {
        ...memberParticipant("acme", "conversation-visible-participants", "avery-webb"),
        displayName: "Avery Webb",
        role: "admin",
      },
    ],
  };
  const decision = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-visible-participants",
    actorMemberId: "xuziho",
    messageId: "message-visible-participants",
    body: "@Mira who is in this channel?",
    mentionedMemberIds: ["employee-hr"],
    conversation: conversationWithRoles,
    employeeIds: ["employee-hr", "avery-webb"],
  })[0];
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }

  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversationWithRoles;
      },
      async listRecentMessages() {
        return {
          messages: [
            {
              ...message({
                conversationId: "conversation-visible-participants",
                messageId: "message-visible-participants",
                senderMemberId: "xuziho",
                body: "@Mira who is in this channel?",
                mentionedMemberIds: ["employee-hr"],
                createdAt: fixedNow,
              }),
              sender: {
                participantId: "participant-member-xuziho",
                participantKind: "company_member",
                memberId: "xuziho",
                displayName: "Xuziho",
              },
            },
          ],
        };
      },
    },
    participantProfiles: [
      { id: "employee-hr", runtimeCapable: true },
      { id: "avery-webb", runtimeCapable: true },
    ],
  });

  const naturalLanguageInput = buildNaturalLanguageInputFromTinyOfficeChatRoomContext({
    context,
    employee: employeeHome("employee-hr"),
  });
  const contextText = naturalLanguageInput.contextBlocks?.[0]?.text || "";
  assert.doesNotMatch(contextText, /Participants:/);
  assert.match(contextText, /Handoff candidates:/);
  assert.match(contextText, /id="xuziho"; displayName="Xuziho"; role="boss"/);
  assert.match(contextText, /id="avery-webb"; displayName="Avery Webb"; role="admin"/);
  assert.doesNotMatch(contextText, /id="employee-hr"; displayName="Mira"; role="hr"/);
  assert.doesNotMatch(contextText, /channelRole=/);
  assert.doesNotMatch(contextText, /kind=company_member/);
  assert.doesNotMatch(contextText, /kind=employee/);
  assert.doesNotMatch(contextText, /handoff=continues runtime/);
  assert.doesNotMatch(contextText, /handoff=returns to user/);
  assert.doesNotMatch(contextText, /Runtime handoff targets/);
  assert.doesNotMatch(contextText, /Human handoff targets/);
  assert.doesNotMatch(contextText, /runtime handoff target ids/);
  assert.deepEqual(naturalLanguageInput.reachableParticipants?.map((participant) => ({
    id: participant.id,
    role: participant.role,
    runtimeCapable: participant.runtimeCapable,
  })), [
    { id: "xuziho", role: "boss", runtimeCapable: false },
    { id: "avery-webb", role: "admin", runtimeCapable: true },
  ]);
});

test("TinyOffice Chat natural language input exposes image attachment inputs without filesystem paths", async () => {
  const decision = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-image",
    actorMemberId: "xuziho",
    messageId: "message-image",
    body: "@Nora please inspect this screenshot.",
    mentionedMemberIds: ["nora-automation"],
    conversation: memberDirectConversation("conversation-image"),
    employeeIds: ["nora-automation"],
  })[0];
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }

  const imageAttachment: MessageDto["attachments"][number] = {
    schema: "conversation-attachment",
    version: 1,
    companyId: "acme",
    conversationId: "conversation-image",
    messageId: "message-image",
    attachmentId: "att-screen",
    fileName: "screen.png",
    mimeType: "image/png",
    byteLength: 4,
    previewUrl: "/api/companies/acme/chat/attachments/att-screen/content",
    downloadUrl: "/api/companies/acme/chat/attachments/att-screen/content?download=1",
    storageKey: "companies/acme/chat-attachments/att-screen/original",
    contentSha256: "sha",
    createdAt: fixedNow,
  };
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return memberDirectConversation("conversation-image");
      },
      async listRecentMessages() {
        return {
          messages: [
            {
              ...message({
                conversationId: "conversation-image",
                messageId: "message-image",
                senderMemberId: "xuziho",
                body: "@Nora please inspect this screenshot.",
                mentionedMemberIds: ["nora-automation"],
                attachments: [imageAttachment],
                createdAt: fixedNow,
              }),
              sender: {
                participantId: "participant-member-xuziho",
                participantKind: "company_member",
                memberId: "xuziho",
                displayName: "Xuziho",
              },
            },
          ],
        };
      },
    },
    participantProfiles: [
      { id: "iris-growth", runtimeCapable: true },
      { id: "nora-automation", runtimeCapable: true },
    ],
  });

  const naturalLanguageInput = buildNaturalLanguageInputFromTinyOfficeChatRoomContext({
    context,
    employee: employeeHome("nora-automation"),
  });
  assert.deepEqual(naturalLanguageInput.contextBlocks || [], []);
  assert.deepEqual(naturalLanguageInput.imageInputs, [{
    attachmentId: "att-screen",
    fileName: "screen.png",
    mimeType: "image/png",
    byteLength: 4,
    previewUrl: "/api/companies/acme/chat/attachments/att-screen/content",
    downloadUrl: "/api/companies/acme/chat/attachments/att-screen/content?download=1",
    storageKey: "companies/acme/chat-attachments/att-screen/original",
    contentSha256: "sha",
  }]);
  assert.doesNotMatch(JSON.stringify(naturalLanguageInput.imageInputs), /localPath|D:\\|\/tmp\//);
});

test("TinyOffice Chat natural language input exposes direct message source context to runtime tools", async () => {
  const decision = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-direct-work",
    actorMemberId: "xuziho",
    messageId: "message-create-work",
    body: "Nora, create a background task from this confirmed discussion.",
    mentionedMemberIds: ["nora-automation"],
    conversation: memberDirectConversation("conversation-direct-work"),
    employeeIds: ["nora-automation"],
  })[0];
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }

  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return memberDirectConversation("conversation-direct-work");
      },
      async listRecentMessages() {
        return {
          messages: [
            {
              ...message({
                conversationId: "conversation-direct-work",
                messageId: "message-create-work",
                senderMemberId: "xuziho",
                body: "Nora, create a background task from this confirmed discussion.",
                mentionedMemberIds: ["nora-automation"],
                createdAt: fixedNow,
              }),
              sender: {
                participantId: "participant-member-xuziho",
                participantKind: "company_member",
                memberId: "xuziho",
                displayName: "Xu",
              },
            },
          ],
        };
      },
    },
    participantProfiles: [{ id: "nora-automation", runtimeCapable: true }],
  });

  const naturalLanguageInput = buildNaturalLanguageInputFromTinyOfficeChatRoomContext({
    context,
    employee: employeeHome("nora-automation"),
  });

  assert.equal(naturalLanguageInput.threadId, "conversation-direct-work");
  assert.equal(naturalLanguageInput.userMessagePayload?.conversationId, "conversation-direct-work");
  assert.equal(naturalLanguageInput.userMessagePayload?.messageId, "message-create-work");
});

test("TinyOffice Chat structured handoff inherits active turn image inputs", async () => {
  const room = memberRuntimeHandoffTopicConversation("conversation-topic-image-handoff");
  const imageAttachment: MessageDto["attachments"][number] = {
    schema: "conversation-attachment",
    version: 1,
    companyId: "acme",
    conversationId: room.conversationId,
    messageId: "message-image-source",
    attachmentId: "att-handoff-screen",
    fileName: "handoff-screen.png",
    mimeType: "image/png",
    byteLength: 12,
    previewUrl: "/api/companies/acme/chat/attachments/att-handoff-screen/content",
    downloadUrl: "/api/companies/acme/chat/attachments/att-handoff-screen/content?download=1",
    storageKey: "companies/acme/chat-attachments/att-handoff-screen/original",
    contentSha256: "handoff-sha",
    createdAt: fixedNow,
  };
  const sourceMessage = {
    ...message({
      conversationId: room.conversationId,
      messageId: "message-image-source",
      senderMemberId: "xuziho",
      body: "@Nora please ask Iris to inspect this screenshot.",
      mentionedMemberIds: ["nora-automation"],
      attachments: [imageAttachment],
      createdAt: "2026-06-24T04:35:00.000Z",
    }),
    sender: {
      participantId: "participant-member-xuziho",
      participantKind: "company_member" as const,
      memberId: "xuziho",
      displayName: "Xuziho",
    },
  };
  const noraReply = message({
    conversationId: room.conversationId,
    messageId: "message-nora-reply",
    senderMemberId: "nora-automation",
    body: "Iris should inspect the screenshot next.",
    createdAt: "2026-06-24T04:35:10.000Z",
  });
  const participantProfiles = [{
    id: "iris",
    displayName: "Iris",
    role: "image-review",
    runtimeCapable: true,
  }, {
    id: "nora-automation",
    displayName: "Nora Automation",
    role: "automation",
    runtimeCapable: true,
  }];
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: room.conversationId,
    actorMemberId: "xuziho",
    messageId: sourceMessage.messageId,
    body: sourceMessage.body,
    mentionedMemberIds: ["nora-automation"],
    conversation: room,
    employeeIds: ["nora-automation", "iris"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }

  const noraContext = await assembleTinyOfficeChatRoomContext({
    decision,
    participantProfiles,
    resolver: {
      async getConversation() {
        return room;
      },
      async listRecentMessages() {
        return { messages: [sourceMessage] };
      },
    },
  });
  const noraResult = await executeTinyOfficeChatNaturalLanguageTurn({
    context: noraContext,
    employee: employeeHome("nora-automation"),
    runtimeSessionRepository: memoryRuntimeSessionRepository().repository,
    runtimeProvider: {
      async reply(input) {
        emitHandoffTopicTurn(input, { toId: "iris" });
        return noraReply.body;
      },
    },
  });
  const irisDecision = buildTinyOfficeChatStructuredHandoffDispatch({
    priorDecision: decision,
    result: noraResult,
    replyMessageId: noraReply.messageId,
  });
  assert.equal(irisDecision?.kind, "routable");
  if (!irisDecision || irisDecision.kind !== "routable") {
    return;
  }

  const irisContext = await assembleTinyOfficeChatRoomContext({
    decision: irisDecision,
    participantProfiles,
    resolver: {
      async getConversation() {
        return room;
      },
      async listRecentMessages() {
        return { messages: [sourceMessage, noraReply] };
      },
    },
  });
  const irisInput = buildNaturalLanguageInputFromTinyOfficeChatRoomContext({
    context: irisContext,
    employee: employeeHome("iris"),
  });

  assert.equal(irisInput.message, noraReply.body);
  assert.deepEqual(irisInput.imageInputs, [{
    attachmentId: "att-handoff-screen",
    fileName: "handoff-screen.png",
    mimeType: "image/png",
    byteLength: 12,
    previewUrl: "/api/companies/acme/chat/attachments/att-handoff-screen/content",
    downloadUrl: "/api/companies/acme/chat/attachments/att-handoff-screen/content?download=1",
    storageKey: "companies/acme/chat-attachments/att-handoff-screen/original",
    contentSha256: "handoff-sha",
  }]);
});

test("TinyOffice Chat turn dispatch stably routes member topic messages without explicit runtime target", () => {
  const decisions = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-topic-member",
    actorMemberId: "xuziho",
    messageId: "message-member-no-target",
    body: "General update for the room.",
    conversation: memberTopicConversation("conversation-topic-member"),
    employeeIds: ["iris-growth", "nora-automation"],
  });

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.kind, "routable");
  assert.equal(decisions[0]?.reason, "stable_random_topic_member");
  assert.equal(decisions[0]?.targetMemberId, "iris-growth");
});

test("TinyOffice Chat turn dispatch selects only the first structured mention", () => {
  const decisions = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-topic-member",
    actorMemberId: "xuziho",
    messageId: "message-multiple-mentions",
    body: "@Nora and @Iris please coordinate.",
    mentionedMemberIds: ["nora-automation", "iris-growth"],
    conversation: memberTopicConversation("conversation-topic-member"),
    employeeIds: ["iris-growth", "nora-automation"],
  });

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.kind, "routable");
  assert.equal(decisions[0]?.targetMemberId, "nora-automation");
});

test("TinyOffice Chat turn dispatch treats literal @all as ordinary no-mention text", () => {
  const input = {
    source: "chat_room_message" as const,
    companyId: "acme",
    roomId: "conversation-topic-member",
    actorMemberId: "xuziho",
    messageId: "message-all",
    conversation: memberTopicConversation("conversation-topic-member"),
    employeeIds: ["iris-growth", "nora-automation"],
  };
  const literalAll = buildTinyOfficeChatTurnDispatches({ ...input, body: "@all please review." });
  const plain = buildTinyOfficeChatTurnDispatches({ ...input, body: "Please review." });

  assert.equal(literalAll[0]?.kind, "routable");
  assert.equal(literalAll[0]?.reason, "stable_random_topic_member");
  assert.equal(literalAll[0]?.targetMemberId, plain[0]?.targetMemberId);
});

test("TinyOffice Chat turn dispatch rejects carrier fields at the owned boundary", () => {
  assert.throws(
    () => buildTinyOfficeChatTurnDispatches({
      source: "chat_room_message",
      companyId: "acme",
      roomId: "conversation-1",
      actorMemberId: "iris-growth",
      messageId: "message-4",
      body: "Carrier leak.",
      mentionedMemberIds: ["nora-automation"],
      conversation: conversation("topic"),
      postId: "mattermost-post",
    } as unknown as Parameters<typeof buildTinyOfficeChatTurnDispatches>[0]),
    /forbidden carrier field: postId/,
  );
});

test("TinyOffice Chat runtime status realtime event validates owned status fields", () => {
  const event = createTinyOfficeRealtimeEvent({
    type: "chat.runtime_status.changed",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "conversation-1",
    sourceMessageId: "message-1",
    targetMemberId: "nora-automation",
    status: "thinking",
    runId: "tinyoffice_chat:chat_room_message:acme:conversation-1:message-1:nora-automation",
    sessionKey: "nora-automation|chat_direct_room|conversation-1",
    sessionRecordId: "runtime-session-1",
    runtimeProviderId: "provider-neutral-test",
  }, {
    eventId: "tinyoffice-realtime-event-runtime-status",
    occurredAt: fixedNow,
    sequence: 1,
  });

  assert.equal(event.type, "chat.runtime_status.changed");
  assert.equal(event.status, "thinking");
  assert.equal(event.runId, "tinyoffice_chat:chat_room_message:acme:conversation-1:message-1:nora-automation");
  assert.equal(event.sourceMessageId, "message-1");
  assert.doesNotMatch(JSON.stringify(event), forbiddenCarrierFieldPattern);
});

test("TinyOffice Chat turn dispatch boundary resolves conversations before deciding", async () => {
  const boundary = new TinyOfficeChatTurnDispatchBoundary({
    resolver: {
      async getConversation(companyId, roomId) {
        assert.equal(companyId, "acme");
        assert.equal(roomId, "conversation-1");
        return conversation("topic");
      },
    },
    employeeIds: ["iris-growth", "nora-automation"],
  });

  const decisions = await boundary.decide({
    source: "chat_entry",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-5",
    body: "Nora, handle this.",
    mentionedMemberIds: ["nora-automation"],
  });

  assert.equal(decisions[0]?.kind, "routable");
  assert.equal(decisions[0]?.targetMemberId, "nora-automation");
});

test("TinyOffice Chat execution dispatch records owned employee session intent", async () => {
  const decision = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-dm-1",
    actorMemberId: "iris-growth",
    messageId: "message-6",
    body: "Can you review this?",
    conversation: conversation("direct", "conversation-dm-1"),
    employeeIds: ["iris-growth", "nora-automation"],
  })[0];
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const records: RuntimeSessionRecord[] = [];
  const events: RuntimeSessionEvent[] = [];

  const result = await handleTinyOfficeChatExecutionDispatch({
    decision,
    now: () => fixedNow,
    repository: {
      upsertSessionRecord(input) {
        const record = {
          eventCount: 0,
          userMessageCount: 0,
          assistantMessageCount: 0,
          toolCallCount: 0,
          toolResultCount: 0,
          tokenInputTotal: 0,
          tokenOutputTotal: 0,
          tokenCacheTotal: 0,
          byteSize: 0,
          truncated: false,
          ...input,
        } satisfies RuntimeSessionRecord;
        records.push(record);
        return record;
      },
      appendSessionEvent(input) {
        const event = {
          byteSize: 0,
          truncated: false,
          ...input,
        } satisfies RuntimeSessionEvent;
        events.push(event);
        return event;
      },
    },
  });

  assert.equal(result.kind, "started");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.employeeId, "nora-automation");
  assert.equal(records[0]?.sessionId, records[0]?.id);
  assert.notEqual(records[0]?.sessionId, records[0]?.sessionKey);
  assert.equal(records[0]?.sessionKey, "nora-automation|chat_direct_room|conversation-dm-1");
  assert.equal(records[0]?.sceneType, "chat_direct_room");
  assert.equal(records[0]?.requesterId, "iris-growth");
  assert.equal(records[0]?.status, "running");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "owned_chat_execution_intent");
  assert.equal(events[0]?.role, "user");
  assert.equal(events[0]?.source, "tinyoffice.chat_dispatch");
  assert.equal(events[0]?.semanticRole, "user_message");
  assert.equal(events[0]?.payload?.companyId, "acme");
  assert.equal(events[0]?.payload?.roomId, "conversation-dm-1");
  assert.equal(events[0]?.payload?.messageId, "message-6");
  assert.equal(events[0]?.payload?.targetMemberId, "nora-automation");
  assert.doesNotMatch(JSON.stringify({ result, records, events }), /\b(teamId|team_id|channelId|channel_id|postId|post_id|rootPostId|root_id|userId|user_id)\b/);
});

test("TinyOffice Chat execution status update persists owned intent cancellation", async () => {
  const decision = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-dm-1",
    actorMemberId: "iris-growth",
    messageId: "message-6",
    body: "Can you review this?",
    conversation: conversation("direct", "conversation-dm-1"),
    employeeIds: ["iris-growth", "nora-automation"],
  })[0];
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const runtimeSessionRepository = memoryRuntimeSessionRepository();

  await handleTinyOfficeChatExecutionDispatch({
    decision,
    now: () => fixedNow,
    repository: runtimeSessionRepository.repository,
  });
  await updateTinyOfficeChatExecutionDispatchStatus({
    decision,
    now: () => "2026-06-24T04:31:00.000Z",
    repository: runtimeSessionRepository.repository,
    status: "canceled",
    summary: "User stopped the reply.",
  });

  const sessionRecordId = `tinyoffice-chat-session:${decision.eventKey}`;
  const record = runtimeSessionRepository.records.find((candidate) => candidate.id === sessionRecordId);
  assert.equal(record?.status, "canceled");
  assert.equal(record?.summary, "User stopped the reply.");
  const statusEvent = runtimeSessionRepository.events.find((event) =>
    event.sessionRecordId === sessionRecordId && event.kind === "owned_chat_execution_status"
  );
  assert.equal(statusEvent?.semanticRole, "cancellation");
  assert.equal(statusEvent?.payload?.status, "canceled");
});

test("TinyOffice Chat room context assembles recent owned messages without carrier payloads", async () => {
  const boundary = new TinyOfficeChatTurnDispatchBoundary({
    resolver: {
      async getConversation() {
        return conversation("topic");
      },
    },
    employeeIds: ["iris-growth", "nora-automation"],
  });
  const [decision] = await boundary.decide({
    source: "chat_entry",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-3",
    body: "Nora, please turn this into an execution checklist.",
    mentionedMemberIds: ["nora-automation"],
    entryId: "chat-entry-channel-topic-launch",
    containerId: "chat-container-channel-topics",
    openTargetKind: "conversation",
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }

  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    recentMessageLimit: 3,
    resolver: {
      async getConversation(companyId, roomId) {
        assert.equal(companyId, "acme");
        assert.equal(roomId, "conversation-1");
        return conversation("topic");
      },
      async listRecentMessages(companyId, roomId, cursor) {
        assert.equal(companyId, "acme");
        assert.equal(roomId, "conversation-1");
        assert.deepEqual(cursor, { limit: 3 });
        return {
          messages: [
            message({
              messageId: "message-2",
              senderMemberId: "nora-automation",
              body: "I can do it after the trace lands.",
              createdAt: "2026-06-24T04:31:00.000Z",
            }),
            message({
              messageId: "message-1",
              senderMemberId: "iris-growth",
              body: "Let's keep this on owned Chat data.",
              createdAt: "2026-06-24T04:30:00.000Z",
            }),
            message({
              messageId: "message-3",
              senderMemberId: "iris-growth",
              body: "Nora, please turn this into an execution checklist.",
              createdAt: "2026-06-24T04:31:00.000Z",
              mentionedMemberIds: ["nora-automation"],
            }),
          ],
        };
      },
    },
    participantProfiles: [
      { id: "iris-growth", runtimeCapable: true },
      { id: "nora-automation", runtimeCapable: true },
    ],
  });

  assert.equal(context.kind, "owned_chat_room_context");
  assert.equal(context.companyId, "acme");
  assert.equal(context.employeeId, "nora-automation");
  assert.equal(context.actorMemberId, "iris-growth");
  assert.equal(context.roomId, "conversation-1");
  assert.equal(context.conversation.conversationId, "conversation-1");
  assert.equal(context.entryId, "chat-entry-channel-topic-launch");
  assert.equal(context.executionState, "context_only");
  assert.equal(context.nonGoals.runsModelExecution, false);
  assert.equal(context.nonGoals.persistsEmployeeReply, false);
  assert.deepEqual(context.recentMessages.map((item) => item.messageId), ["message-1", "message-2", "message-3"]);
  assert.deepEqual(context.recentMessages.map((item) => item.senderMemberId), [
    "iris-growth",
    "nora-automation",
    "iris-growth",
  ]);
  assert.deepEqual(context.recentMessages[2]?.mentionedMemberIds, ["nora-automation"]);
  assert.doesNotMatch(
    JSON.stringify(context),
    /\b(teamId|team_id|channelId|channel_id|postId|post_id|rootPostId|root_post_id|userId|user_id)\b/,
  );
});

test("TinyOffice Chat room context rejects runtime access when actor or target is not allowed in the room", async () => {
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "outsider-ops",
    messageId: "message-denied",
    body: "Nora, read this room for me.",
    mentionedMemberIds: ["nora-automation"],
    conversation: conversation("topic"),
    employeeIds: ["nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  let listMessagesCalled = false;

  await assert.rejects(
    () => assembleTinyOfficeChatRoomContext({
      decision,
      resolver: {
        async getConversation() {
          return conversation("topic");
        },
        async listRecentMessages() {
          listMessagesCalled = true;
          return { messages: [] };
        },
      },
    }),
    /not allowed to access Chat room conversation-1/,
  );
  assert.equal(listMessagesCalled, false);
});

test("TinyOffice Chat room context becomes natural language execution input without carrier payloads", async () => {
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-8",
    body: "Nora, draft the owner checklist from this owned room.",
    mentionedMemberIds: ["nora-automation"],
    conversation: conversation("topic"),
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversation("topic");
      },
      async listRecentMessages() {
        return {
          messages: [
            message({
              messageId: "message-7",
              senderMemberId: "iris-growth",
              body: "Use the owned Chat context only.",
              createdAt: "2026-06-24T04:32:00.000Z",
            }),
            message({
              messageId: "message-8",
              senderMemberId: "iris-growth",
              body: "Nora, draft the owner checklist from this owned room.",
              mentionedMemberIds: ["nora-automation"],
              createdAt: "2026-06-24T04:33:00.000Z",
            }),
          ],
        };
      },
    },
    participantProfiles: [
      { id: "iris-growth", runtimeCapable: true },
      { id: "nora-automation", runtimeCapable: true },
    ],
  });

  const naturalLanguageInput = buildNaturalLanguageInputFromTinyOfficeChatRoomContext({
    context,
    employee: employeeHome(),
  });

  assert.equal(naturalLanguageInput.message, "Nora, draft the owner checklist from this owned room.");
  assert.equal(naturalLanguageInput.sessionKey, "nora-automation|chat_topic_room|conversation-1");
  assert.equal(naturalLanguageInput.threadId, "conversation-1");
  assert.equal(naturalLanguageInput.roomId, "conversation-1");
  assert.equal(naturalLanguageInput.conversationId, "conversation-1");
  assert.equal(naturalLanguageInput.messageId, "message-8");
  assert.equal(naturalLanguageInput.channelTopicId, undefined);
  assert.equal(naturalLanguageInput.userMessageSource, "tinyoffice.chat_room_message");
  assert.equal(naturalLanguageInput.userMessagePayload?.roomId, "conversation-1");
  assert.equal(naturalLanguageInput.userMessagePayload?.messageId, "message-8");
  assert.equal(naturalLanguageInput.contextBlocks?.[0]?.source, "tinyoffice.chat_topic_context");
  assert.equal(naturalLanguageInput.contextBlocks?.[0]?.label, "Topic context");
  assert.doesNotMatch(naturalLanguageInput.contextBlocks?.[0]?.text || "", /^Topic context:/);
  assert.match(naturalLanguageInput.contextBlocks?.[0]?.text || "", /Handoff candidates:/);
  assert.match(naturalLanguageInput.contextBlocks?.[0]?.text || "", /Use the owned Chat context only\./);
  assert.equal(Object.prototype.hasOwnProperty.call(naturalLanguageInput, "completionPolicy"), false);
  assert.equal(naturalLanguageInput.activeToolNames?.includes("handoff_topic_turn"), true);
  assert.doesNotMatch(JSON.stringify({
    userMessagePayload: naturalLanguageInput.userMessagePayload,
    contextBlocks: naturalLanguageInput.contextBlocks,
  }), forbiddenCarrierFieldPattern);
});

test("TinyOffice Chat channel context includes topic summary before latest raw messages", async () => {
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-22",
    body: "Nora, continue from the latest status.",
    mentionedMemberIds: ["nora-automation"],
    conversation: conversationWithTopicSummary(),
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const calls: Array<{ limit?: number }> = [];
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversationWithTopicSummary();
      },
      async listRecentMessages(_companyId, _roomId, cursor) {
        calls.push({ limit: cursor?.limit });
        return {
          messages: [
            message({
              messageId: "message-21",
              senderMemberId: "iris-growth",
              body: "I checked workspace files and found the current default set.",
              createdAt: "2026-06-24T04:50:00.000Z",
            }),
            message({
              messageId: "message-22",
              senderMemberId: "iris-growth",
              body: "Nora, continue from the latest status.",
              mentionedMemberIds: ["nora-automation"],
              createdAt: "2026-06-24T04:51:00.000Z",
            }),
          ],
        };
      },
    },
  });

  const naturalLanguageInput = buildNaturalLanguageInputFromTinyOfficeChatRoomContext({
    context,
    employee: employeeHome(),
  });
  const text = naturalLanguageInput.contextBlocks?.[0]?.text || "";

  assert.deepEqual(calls, [{ limit: 20 }]);
  assert.match(text, /Topic summary:/);
  assert.match(text, /The team agreed to validate workspace files/);
  assert.match(text, /Latest raw messages:/);
  assert.ok(text.indexOf("Topic summary:") < text.indexOf("Latest raw messages:"));
  assert.doesNotMatch(text, /Room\/Relay|contextMode|relay mode/i);
});

test("TinyOffice Chat channel context can render only messages after the previous topic context cursor", async () => {
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-4",
    body: "Nora, continue from the new blocker.",
    mentionedMemberIds: ["nora-automation"],
    conversation: conversationWithTopicSummary(),
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }

  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversationWithTopicSummary();
      },
      async listRecentMessages() {
        throw new Error("incremental context must not use the bounded recent-message query");
      },
      async listMessagesAfter(_companyId, _roomId, cursor) {
        assert.deepEqual(cursor, {
          messageId: "message-2",
          createdAt: "2026-06-24T04:41:00.000Z",
        });
        return {
          messages: [
            message({
              messageId: "message-3",
              senderMemberId: "iris-growth",
              body: "New blocker after the previous context.",
              createdAt: "2026-06-24T04:42:00.000Z",
            }),
            message({
              messageId: "message-4",
              senderMemberId: "iris-growth",
              body: "Nora, continue from the new blocker.",
              mentionedMemberIds: ["nora-automation"],
              createdAt: "2026-06-24T04:43:00.000Z",
            }),
          ],
        };
      },
    },
    priorTopicContextCursor: {
      messageId: "message-2",
      createdAt: "2026-06-24T04:41:00.000Z",
    },
  });

  const naturalLanguageInput = buildNaturalLanguageInputFromTinyOfficeChatRoomContext({
    context,
    employee: employeeHome(),
  });
  const block = naturalLanguageInput.contextBlocks?.[0];
  const text = block?.text || "";

  assert.equal(context.topicContextWindow.mode, "incremental");
  assert.equal(block?.metadata?.kind, "chat_topic_context_window");
  assert.equal(block?.metadata?.mode, "incremental");
  assert.equal(block?.metadata?.lastMessageId, "message-4");
  assert.match(text, /New raw messages since previous Topic context:/);
  assert.doesNotMatch(text, /Old discovery already sent/);
  assert.doesNotMatch(text, /Previous cursor message already sent/);
  assert.match(text, /New blocker after the previous context/);
  assert.match(text, /Nora, continue from the new blocker/);
});

test("TinyOffice Chat natural language execution returns a result before reply write-back", async () => {
  const runtimeSessionRepository = memoryRuntimeSessionRepository();
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-dm-1",
    actorMemberId: "iris-growth",
    messageId: "message-9",
    body: "Can you turn this into a brief action list?",
    conversation: conversation("direct", "conversation-dm-1"),
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversation("direct", "conversation-dm-1");
      },
      async listRecentMessages() {
        return {
          messages: [
            message({
              conversationId: "conversation-dm-1",
              messageId: "message-9",
              senderMemberId: "iris-growth",
              body: "Can you turn this into a brief action list?",
              createdAt: "2026-06-24T04:34:00.000Z",
            }),
          ],
        };
      },
    },
  });
  let capturedInput: Parameters<NonNullable<NaturalLanguageResponseInput["runtimeProvider"]>["reply"]>[0] | undefined;

  const result = await executeTinyOfficeChatNaturalLanguageTurn({
    context,
    employee: employeeHome(),
    runtimeSessionRepository: runtimeSessionRepository.repository,
    runtimeProvider: {
      async reply(input) {
        capturedInput = input;
        return "Action list: confirm owner, capture deadline, publish summary.";
      },
    },
  });
  const [session] = runtimeSessionRepository.repository.listSessionRecords({ employeeId: "nora-automation" });
  assert.ok(session);
  const detail = runtimeSessionRepository.repository.getSessionDetail(session.id);
  const userMessageEvent = detail?.events.find((event) => event.kind === "user_message");
  const promptPackageEvent = detail?.events.find((event) => event.kind === "prompt_input_package");

  assert.equal(result.kind, "executed");
  assert.equal(result.executionState, "natural_language_reply_ready");
  assert.deepEqual(result.chatOutput, {
    source: "assistant_message",
    message: "Action list: confirm owner, capture deadline, publish summary.",
  });
  assert.equal(result.stateAction, undefined);
  assert.equal(result.response.message, "Action list: confirm owner, capture deadline, publish summary.");
  assert.ok(result.runtimeEvidence);
  assert.match(result.runtimeEvidence.sessionRecordId, /^runtime-session-/);
  assert.ok(result.runtimeEvidence.appendedEventCount > 0);
  assert.equal(result.runtimeEvidence.processTraceId, undefined);
  assert.equal(result.runtimeEvidence.processTraceLabel, undefined);
  assert.equal(capturedInput?.message, "Can you turn this into a brief action list?");
  assert.equal(capturedInput?.sessionKey, "nora-automation|chat_direct_room|conversation-dm-1");
  assert.equal(capturedInput?.threadId, "conversation-dm-1");
  assert.equal(capturedInput?.roomId, "conversation-dm-1");
  assert.equal(capturedInput?.conversationId, "conversation-dm-1");
  assert.equal(capturedInput?.messageId, "message-9");
  assert.equal(capturedInput?.channelTopicId, undefined);
  assert.deepEqual(capturedInput?.contextBlocks || [], []);
  assert.equal(capturedInput?.reachableMemberIds, undefined);
  assert.equal(capturedInput?.reachableParticipants, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(capturedInput || {}, "completionPolicy"), false);
  assert.equal(capturedInput?.activeToolNames?.includes("handoff_topic_turn"), false);
  assert.equal(session.id, result.runtimeEvidence.sessionRecordId);
  assert.equal(session.sessionKey, "nora-automation|chat_direct_room|conversation-dm-1");
  assert.equal(session.sessionId, session.id);
  assert.notEqual(session.sessionId, capturedInput?.sessionKey);
  assert.equal(session.sceneType, "chat_direct_room");
  assert.equal(session.channelTopicId, undefined);
  assert.equal(userMessageEvent?.source, "tinyoffice.chat_room_message");
  assert.equal(userMessageEvent?.payload?.roomId, "conversation-dm-1");
  assert.equal(userMessageEvent?.payload?.messageId, "message-9");
  assert.equal(userMessageEvent?.payload?.threadId, "conversation-dm-1");
  assert.equal(userMessageEvent?.payload?.conversationId, "conversation-dm-1");
  assert.equal(userMessageEvent?.payload?.channelTopicId, undefined);
  assert.equal(promptPackageEvent?.source, "tinyoffice.prompt_input_package");
  assert.doesNotMatch(JSON.stringify({
    result,
    capturedInput: {
      message: capturedInput?.message,
      sessionKey: capturedInput?.sessionKey,
      contextBlocks: capturedInput?.contextBlocks,
      reachableMemberIds: capturedInput?.reachableMemberIds,
      reachableParticipants: capturedInput?.reachableParticipants,
    },
    userMessagePayload: userMessageEvent?.payload,
    promptContextBlocks: (promptPackageEvent?.payload as { contextBlocks?: unknown[] } | undefined)?.contextBlocks,
  }), forbiddenCarrierFieldPattern);
});

test("TinyOffice Chat process trace ids use provider stream emission keys", async () => {
  const runtimeSessionRepository = memoryRuntimeSessionRepository();
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-dm-trace",
    actorMemberId: "iris-growth",
    messageId: "message-trace",
    body: "Can you plan the next step?",
    conversation: conversation("direct", "conversation-dm-trace"),
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversation("direct", "conversation-dm-trace");
      },
      async listRecentMessages() {
        return {
          messages: [
            message({
              conversationId: "conversation-dm-trace",
              messageId: "message-trace",
              senderMemberId: "iris-growth",
              body: "Can you plan the next step?",
              createdAt: "2026-06-24T04:34:00.000Z",
            }),
          ],
        };
      },
    },
  });
  const processEvents: ProcessTraceEvent[] = [];

  await executeTinyOfficeChatNaturalLanguageTurn({
    context,
    employee: employeeHome(),
    runtimeSessionRepository: runtimeSessionRepository.repository,
    onProcessEvent: async (event) => {
      processEvents.push(event as ProcessTraceEvent);
    },
    runtimeProvider: {
      async reply(input) {
        input.onProviderEvent?.({
          processTraceEvents: [{
            timestamp: "2026-06-24T04:34:01.000Z",
            kind: "model_reasoning_observed",
            sessionKey: input.sessionKey,
            employeeId: input.employee.employeeId,
            title: "nora-automation is thinking",
            summary: "First trace chunk",
            status: "running",
            metadata: {
              streamEventKey: "stream:thinking:0",
              streamEventType: "thinking_delta",
              streamEventEmissionKey: "stream:thinking:0:delta",
            },
          }],
        });
        input.onProviderEvent?.({
          processTraceEvents: [{
            timestamp: "2026-06-24T04:34:02.000Z",
            kind: "model_reasoning_observed",
            sessionKey: input.sessionKey,
            employeeId: input.employee.employeeId,
            title: "nora-automation is thinking",
            summary: "Second trace chunk",
            status: "running",
            metadata: {
              streamEventKey: "stream:thinking:0",
              streamEventType: "thinking_delta",
              streamEventEmissionKey: "stream:thinking:0:delta",
            },
          }],
        });
        input.onProviderEvent?.({
          processTraceEvents: [{
            timestamp: "2026-06-24T04:34:03.000Z",
            kind: "model_reasoning_observed",
            sessionKey: input.sessionKey,
            employeeId: input.employee.employeeId,
            title: "nora-automation finished thinking",
            summary: "Final trace chunk",
            status: "succeeded",
            metadata: {
              streamEventKey: "stream:thinking:0",
              streamEventType: "thinking_end",
              streamEventEmissionKey: "stream:thinking:0:end",
            },
          }],
        });
        return "Action list: confirm owner, capture deadline, publish summary.";
      },
    },
  });

  const thinkingEvents = processEvents.filter((event) => event.kind === "model_reasoning_observed");
  assert.equal(thinkingEvents.length, 3);
  assert.equal(thinkingEvents[0]?.id, thinkingEvents[1]?.id);
  assert.notEqual(thinkingEvents[1]?.id, thinkingEvents[2]?.id);
  assert.match(thinkingEvents[0]?.id ?? "", /stream%3Athinking%3A0%3Adelta|stream:thinking:0:delta/);
  assert.match(thinkingEvents[2]?.id ?? "", /stream%3Athinking%3A0%3Aend|stream:thinking:0:end/);
});

test("HR Chat turns do not expose a dedicated recruit employee tool", async () => {
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-hr",
    actorMemberId: "xuziho",
    messageId: "message-hr-recruit",
    body: "Help me recruit a growth employee.",
    conversation: {
      ...conversation("direct", "conversation-hr"),
      title: "Xu and Mira",
      participants: [
        memberParticipant("acme", "conversation-hr", "xuziho"),
        memberParticipant("acme", "conversation-hr", "employee-hr"),
      ],
    },
    employeeIds: ["employee-hr", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }

  const context = await assembleTinyOfficeChatRoomContext({
    decision: {
      ...decision,
      targetMemberId: "employee-hr",
      sessionKey: "employee-hr|chat_direct_room|conversation-hr",
    },
    resolver: {
      async getConversation() {
        return {
          ...conversation("direct", "conversation-hr"),
          title: "Xu and Mira",
          participants: [
            memberParticipant("acme", "conversation-hr", "xuziho"),
            memberParticipant("acme", "conversation-hr", "employee-hr"),
          ],
        };
      },
      async listRecentMessages() {
        return {
          messages: [
            message({
              conversationId: "conversation-hr",
              messageId: "message-hr-recruit",
              senderMemberId: "employee-hr",
              body: "Help me recruit a growth employee.",
              createdAt: "2026-06-30T11:20:00.000Z",
            }),
          ],
        };
      },
    },
  });
  const employeeHrHome = employeeHome("employee-hr");
  const hrInput = buildNaturalLanguageInputFromTinyOfficeChatRoomContext({
    context,
    employee: {
      ...employeeHrHome,
      profile: {
        ...employeeHrHome.profile,
        role: "hr",
        displayName: "Mira",
      },
    },
  });
  assert.equal(hrInput.activeToolNames?.includes("recruit_employee"), false);
  assert.equal(hrInput.activeToolNames?.includes("tinyoffice_capability_call"), true);
  assert.equal(hrInput.activeToolNames?.includes("handoff_topic_turn"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(hrInput, "completionPolicy"), false);
});

test("TinyOffice Chat channel execution requires one structured handoff target", async () => {
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-10",
    body: "Nora, please hand this back when scoped.",
    mentionedMemberIds: ["nora-automation"],
    conversation: conversation("topic"),
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversation("topic");
      },
      async listRecentMessages() {
        return {
          messages: [
            message({
              messageId: "message-10",
              senderMemberId: "iris-growth",
              body: "Nora, please hand this back when scoped.",
              mentionedMemberIds: ["nora-automation"],
              createdAt: "2026-06-24T04:35:00.000Z",
            }),
          ],
        };
      },
    },
    participantProfiles: [
      { id: "iris-growth", runtimeCapable: true },
      { id: "nora-automation", runtimeCapable: true },
    ],
  });

  const result = await executeTinyOfficeChatNaturalLanguageTurn({
    context,
    employee: employeeHome(),
    runtimeSessionRepository: memoryRuntimeSessionRepository().repository,
    runtimeProvider: {
      async reply(input) {
        emitHandoffTopicTurn(input, {
          toId: "iris-growth",
        });
        return "Iris should review the scoped checklist next.";
      },
    },
  });
  const handoffDecision = buildTinyOfficeChatStructuredHandoffDispatch({
    priorDecision: decision,
    result,
    replyMessageId: "message-reply-1",
  });

  assert.deepEqual(result.chatOutput, {
    source: "assistant_message",
    message: "Iris should review the scoped checklist next.",
  });
  assert.equal(result.stateAction?.toolName, "handoff_topic_turn");
  assert.equal(result.stateAction?.recipientParticipantId, "iris-growth");
  assert.equal(result.stateAction?.targetMemberId, "iris-growth");
  assert.equal(result.response.message, "Iris should review the scoped checklist next.");
  assert.equal(handoffDecision?.kind, "routable");
  assert.equal(handoffDecision?.reason, "formal_structured_handoff");
  assert.equal(handoffDecision?.targetMemberId, "iris-growth");
  assert.equal(handoffDecision?.actorMemberId, "nora-automation");
  assert.equal(handoffDecision?.messageId, "message-reply-1");
  assert.doesNotMatch(JSON.stringify({ result, handoffDecision }), forbiddenCarrierFieldPattern);
});

test("TinyOffice Chat channel handoff can route to a member-backed runtime participant", async () => {
  const room = memberRuntimeHandoffTopicConversation();
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: room.conversationId,
    actorMemberId: "xuziho",
    messageId: "message-member-runtime-handoff",
    body: "Nora, ask Iris to review the image next.",
    mentionedMemberIds: ["nora-automation"],
    conversation: room,
    employeeIds: ["nora-automation", "iris"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    participantProfiles: [{
      id: "iris",
      displayName: "Iris",
      role: "image-review",
      runtimeCapable: true,
    }, {
      id: "nora-automation",
      displayName: "Nora Automation",
      role: "automation",
      runtimeCapable: true,
    }],
    resolver: {
      async getConversation() {
        return room;
      },
      async listRecentMessages() {
        return {
          messages: [
            message({
              conversationId: room.conversationId,
              messageId: "message-member-runtime-handoff",
              senderMemberId: "nora-automation",
              body: "Nora, ask Iris to review the image next.",
              mentionedMemberIds: ["nora-automation"],
              createdAt: "2026-06-24T04:35:00.000Z",
            }),
          ],
        };
      },
    },
  });

  const result = await executeTinyOfficeChatNaturalLanguageTurn({
    context,
    employee: employeeHome("nora-automation"),
    runtimeSessionRepository: memoryRuntimeSessionRepository().repository,
    runtimeProvider: {
      async reply(input) {
        emitHandoffTopicTurn(input, { toId: "iris" });
        return "Iris should review this next.";
      },
    },
  });
  const handoffDecision = buildTinyOfficeChatStructuredHandoffDispatch({
    priorDecision: decision,
    result,
    replyMessageId: "message-member-runtime-reply",
  });

  assert.equal(result.stateAction?.recipientParticipantId, "iris");
  assert.equal(result.stateAction?.targetMemberId, "iris");
  assert.equal(handoffDecision?.kind, "routable");
  assert.equal(handoffDecision?.targetMemberId, "iris");
  assert.equal(handoffDecision?.actorMemberId, "nora-automation");
});

test("TinyOffice Chat channel execution rejects multiple handoff_topic_turn calls", async () => {
  const runtimeSessions = memoryRuntimeSessionRepository();
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-10-multiple-handoff",
    body: "Nora, choose exactly one next owner.",
    mentionedMemberIds: ["nora-automation"],
    conversation: conversation("topic"),
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversation("topic");
      },
      async listRecentMessages() {
        return {
          messages: [
            message({
              messageId: "message-10-multiple-handoff",
              senderMemberId: "iris-growth",
              body: "Nora, choose exactly one next owner.",
              mentionedMemberIds: ["nora-automation"],
              createdAt: "2026-06-24T04:35:00.000Z",
            }),
          ],
        };
      },
    },
  });

  await assert.rejects(
    executeTinyOfficeChatNaturalLanguageTurn({
      context,
      employee: employeeHome(),
      runtimeSessionRepository: runtimeSessions.repository,
      runtimeProvider: {
        async reply(input) {
          emitHandoffTopicTurn(input, { toId: "iris-growth" });
          emitHandoffTopicTurn(input, { toId: "nora-automation" });
          return "I tried to hand this to two people.";
        },
      },
    }),
    /handoff_topic_turn must be called exactly once/,
  );
  const runtimeSession = runtimeSessions.records.find((record) =>
    record.employeeId === "nora-automation" && record.sceneType === "chat_topic_room"
  );
  assert.equal(runtimeSession?.status, "failed");
  assert.match(runtimeSession?.summary || "", /handoff_topic_turn must be called exactly once/);
});

test("TinyOffice Chat channel execution treats self handoff as a non-candidate target", async () => {
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-10-self-handoff",
    body: "Nora, choose the next owner.",
    mentionedMemberIds: ["nora-automation"],
    conversation: conversation("topic"),
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversation("topic");
      },
      async listRecentMessages() {
        return {
          messages: [
            message({
              messageId: "message-10-self-handoff",
              senderMemberId: "iris-growth",
              body: "Nora, choose the next owner.",
              mentionedMemberIds: ["nora-automation"],
              createdAt: "2026-06-24T04:35:00.000Z",
            }),
          ],
        };
      },
    },
  });

  await assert.rejects(
    executeTinyOfficeChatNaturalLanguageTurn({
      context,
      employee: employeeHome(),
      runtimeSessionRepository: memoryRuntimeSessionRepository().repository,
      runtimeProvider: {
        async reply(input) {
          emitHandoffTopicTurn(input, { toId: "nora-automation" });
          return "I will keep this myself.";
        },
      },
    }),
    /handoff target nora-automation is not reachable in this Topic/,
  );
});

test("TinyOffice Chat channel execution treats streamed handoff start and end as one tool call", async () => {
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-10-streamed-handoff",
    body: "Nora, choose the next owner after your reply.",
    mentionedMemberIds: ["nora-automation"],
    conversation: conversation("topic"),
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversation("topic");
      },
      async listRecentMessages() {
        return {
          messages: [
            message({
              messageId: "message-10-streamed-handoff",
              senderMemberId: "iris-growth",
              body: "Nora, choose the next owner after your reply.",
              mentionedMemberIds: ["nora-automation"],
              createdAt: "2026-06-24T04:35:00.000Z",
            }),
          ],
        };
      },
    },
    participantProfiles: [
      { id: "iris-growth", runtimeCapable: true },
      { id: "nora-automation", runtimeCapable: true },
    ],
  });

  const result = await executeTinyOfficeChatNaturalLanguageTurn({
    context,
    employee: employeeHome(),
    runtimeSessionRepository: memoryRuntimeSessionRepository().repository,
    runtimeProvider: {
      async reply(input) {
        emitStreamingHandoffTopicTurn(input, { toId: "iris-growth" });
        return "I checked this and Iris should own the next step.";
      },
    },
  });

  assert.equal(result.stateAction?.toolName, "handoff_topic_turn");
  assert.equal(result.stateAction?.targetMemberId, "iris-growth");
  assert.equal(result.chatOutput.message, "I checked this and Iris should own the next step.");
});

test("TinyOffice Chat state action ignores streamed handoff start placeholders", () => {
  const result = resolveChatTurnStateAction({
    sceneType: "channel",
    topicId: "topic-1",
    assistantMessage: "I checked this and Iris should own the next step.",
    reachableMemberIds: ["iris-growth", "nora-automation"],
    reachableParticipants: [
      { id: "iris-growth", displayName: "Iris", role: "growth" },
      { id: "nora-automation", displayName: "Nora", role: "automation" },
    ],
    events: [
      {
        kind: "model_tool_call",
        timestamp: "2026-06-24T04:35:01.000Z",
        status: "running",
        metadata: {
          toolName: "handoff_topic_turn",
          arguments: {},
          streamEventType: "toolcall_start",
          contentIndex: 1,
        },
      },
      {
        kind: "model_tool_call",
        timestamp: "2026-06-24T04:35:02.000Z",
        status: "succeeded",
        metadata: {
          toolName: "handoff_topic_turn",
          arguments: { toId: "iris-growth" },
          streamEventType: "toolcall_end",
          contentIndex: 1,
        },
      },
      {
        kind: "model_tool_result",
        timestamp: "2026-06-24T04:35:03.000Z",
        status: "succeeded",
        metadata: {
          toolName: "handoff_topic_turn",
          streamEventType: "toolcall_result",
          contentIndex: 1,
        },
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.stateAction?.targetMemberId : undefined, "iris-growth");
});

test("TinyOffice Chat state action accepts one corrected handoff after a failed target attempt", () => {
  const result = resolveChatTurnStateAction({
    sceneType: "channel",
    topicId: "topic-1",
    assistantMessage: "I finished my part and am returning the topic.",
    reachableParticipants: [
      { id: "lina", displayName: "Lina", role: "content" },
      { id: "owner", displayName: "Xu Ziho", role: "boss" },
    ],
    events: [
      {
        kind: "model_tool_call",
        timestamp: "2026-07-15T02:31:38.000Z",
        status: "succeeded",
        metadata: {
          toolName: "handoff_topic_turn",
          arguments: { toId: "xu-ziho" },
        },
      },
      {
        kind: "model_tool_result",
        timestamp: "2026-07-15T02:31:39.000Z",
        status: "failed",
        metadata: {
          toolName: "handoff_topic_turn",
        },
      },
      {
        kind: "model_tool_call",
        timestamp: "2026-07-15T02:31:40.000Z",
        status: "succeeded",
        metadata: {
          toolName: "handoff_topic_turn",
          arguments: { toId: "owner" },
        },
      },
      {
        kind: "model_tool_result",
        timestamp: "2026-07-15T02:31:41.000Z",
        status: "succeeded",
        metadata: {
          toolName: "handoff_topic_turn",
        },
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.stateAction?.recipientParticipantId : undefined, "owner");
});

test("TinyOffice Chat state action rejects a handoff whose tool execution failed", () => {
  const result = resolveChatTurnStateAction({
    sceneType: "channel",
    topicId: "topic-1",
    assistantMessage: "I attempted to return the topic.",
    reachableParticipants: [{ id: "owner", displayName: "Xu Ziho", role: "boss" }],
    events: [
      {
        kind: "model_tool_call",
        timestamp: "2026-07-15T02:31:38.000Z",
        status: "succeeded",
        metadata: {
          toolName: "handoff_topic_turn",
          arguments: { toId: "xu-ziho" },
        },
      },
      {
        kind: "model_tool_result",
        timestamp: "2026-07-15T02:31:39.000Z",
        status: "failed",
        metadata: {
          toolName: "handoff_topic_turn",
        },
      },
    ],
  });

  assert.deepEqual(result, {
    ok: false,
    error: "handoff_topic_turn must be called exactly once in every Channel Topic turn.",
  });
});

test("TinyOffice Chat DM execution accepts provider assistant text without a final tool", async () => {
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-dm-1",
    actorMemberId: "iris-growth",
    messageId: "message-11",
    body: "Can you reply using the formal protocol?",
    conversation: conversation("direct", "conversation-dm-1"),
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversation("direct", "conversation-dm-1");
      },
      async listRecentMessages() {
        return {
          messages: [
            message({
              conversationId: "conversation-dm-1",
              messageId: "message-11",
              senderMemberId: "iris-growth",
              body: "Can you reply using the formal protocol?",
              createdAt: "2026-06-24T04:36:00.000Z",
            }),
          ],
        };
      },
    },
  });

  const result = await executeTinyOfficeChatNaturalLanguageTurn({
    context,
    employee: employeeHome(),
    runtimeSessionRepository: memoryRuntimeSessionRepository().repository,
    runtimeProvider: {
      async reply() {
        return "This assistant text is the successful DM reply.";
      },
    },
  });

  assert.equal(result.response.message, "This assistant text is the successful DM reply.");
  assert.equal(result.stateAction, undefined);
  assert.equal(result.chatOutput.source, "assistant_message");
});

test("TinyOffice Chat natural language execution result persists as an owned Conversation message reply", async () => {
  const repository = new InMemoryMessageRepository();
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository,
  });
  await messageService.createConversation("acme", {
    title: "Owned Chat DM",
    conversationKind: "direct",
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
      },
    ],
  });
  const userMessage = await messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "iris-growth" },
    "Can you turn this into a brief action list?",
  );
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: userMessage.message.messageId,
    body: userMessage.message.body,
    conversation: await messageService.getConversation("acme", "conversation-1") as ConversationDto,
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: messageService,
  });
  const result = await executeTinyOfficeChatNaturalLanguageTurn({
    context,
    employee: employeeHome(),
    runtimeSessionRepository: memoryRuntimeSessionRepository().repository,
    runtimeProvider: {
      async reply() {
        return "Action list: confirm owner, capture deadline, publish summary.";
      },
    },
  });
  const realtimePublisher = new CapturingRealtimePublisher();
  assert.ok(result.runtimeEvidence);
  const sessionRecordId = result.runtimeEvidence.sessionRecordId;

  const persisted = await persistTinyOfficeChatNaturalLanguageReply({
    result,
    messageService,
    realtimePublisher,
  });
  const repeated = await persistTinyOfficeChatNaturalLanguageReply({
    result,
    messageService,
    realtimePublisher,
  });
  const messages = await messageService.listMessages("acme", "conversation-1");

  assert.equal(persisted.kind, "persisted");
  assert.equal(persisted.message.messageId, "message-2");
  assert.equal(persisted.message.companyId, "acme");
  assert.equal(persisted.message.conversationId, "conversation-1");
  assert.equal(persisted.message.sender.memberId, "nora-automation");
  assert.equal(result.chatOutput.source, "assistant_message");
  assert.equal(result.stateAction, undefined);
  assert.equal(persisted.message.body, "Action list: confirm owner, capture deadline, publish summary.");
  const sessionLink = persisted.message.runtimeLinks.find((link) => link.targetKind === "session");
  const processTraceLink = persisted.message.runtimeLinks.find((link) => link.targetKind === "process_trace");
  assert.equal(sessionLink?.targetId, sessionRecordId);
  assert.equal(sessionLink?.linkId, persisted.idempotencyKey);
  assert.equal(sessionLink?.sourceMessageId, result.messageId);
  assert.equal(processTraceLink, undefined);
  assert.equal(persisted.sendResult.realtimeEvent.type, "message.created");
  assert.equal(persisted.sendResult.realtimeEvent.actorMemberId, "nora-automation");
  assert.equal(persisted.sendResult.conversation.lastMessageId, "message-2");
  assert.deepEqual(realtimePublisher.payloads, [
    {
      type: "chat.message.created",
      companyId: "acme",
      conversationId: "conversation-1",
      roomId: "conversation-1",
      messageId: "message-2",
    },
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
  assert.deepEqual(persisted.realtimeEvents.map((event) => event.type), [
    "chat.message.created",
    "chat.projection.changed",
    "chat.projection.changed",
  ]);
  assert.equal(persisted.realtimeEvents[0]?.messageId, "message-2");
  assert.equal(persisted.realtimeEvents[0]?.conversationId, "conversation-1");
  assert.equal(repeated.kind, "already_persisted");
  assert.equal(repeated.message.messageId, "message-2");
  assert.deepEqual(messages.messages.map((item) => item.messageId), ["message-1", "message-2"]);
  assert.doesNotMatch(JSON.stringify({ persisted, repeated, messages, realtimeEvents: realtimePublisher.events }), forbiddenCarrierFieldPattern);
});

test("TinyOffice Chat reply persistence writes through the room participant identity for member-backed employees", async () => {
  const repository = new InMemoryMessageRepository();
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository,
  });
  const conversation = await messageService.createConversation("acme", {
    title: "Growth topic",
    conversationKind: "topic",
    topic: { title: "Growth topic", chatChannelId: "channel-growth" },
    participants: [
      {
        participantKind: "company_member",
        memberId: "xuziho",
        displayName: "Xu",
      },
      {
        participantKind: "company_member",
        memberId: "aster",
        displayName: "Aster",
      },
    ],
  });
  const userMessage = await messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "xuziho" },
    "@Aster please confirm the channel mention.",
    { mentionedMemberIds: ["aster"] },
  );
  const result = {
    kind: "executed" as const,
    executionState: "natural_language_reply_ready" as const,
    companyId: "acme",
    roomId: "conversation-1",
    conversationId: "conversation-1",
    messageId: userMessage.message.messageId,
    employeeId: "aster",
    actorMemberId: "xuziho",
    targetMemberId: "aster",
    sessionKey: "aster|chat_topic_room|conversation-1",
    runtimeEvidence: {
      sessionRecordId: "runtime-session-aster",
      appendedEventCount: 1,
      processTraceId: "process-trace-aster",
      processTraceLabel: "Worked for 1s",
    },
    chatOutput: {
      source: "assistant_message" as const,
      message: "Confirmed from the channel.",
    },
    stateAction: {
      toolName: "handoff_topic_turn" as const,
      recipientParticipantId: conversation.participants.find((participant) => participant.memberId === "xuziho")!.participantId,
      targetMemberId: "xuziho",
      handoff: {
        timestamp: fixedNow,
        channelTopicId: conversation.topic?.topicId,
        recipientParticipantId: conversation.participants.find((participant) => participant.memberId === "xuziho")!.participantId,
        targetMemberId: "xuziho",
        message: "Confirmed from the channel.",
      },
    },
    response: {
      message: "Confirmed from the channel.",
    },
  };

  const persisted = await persistTinyOfficeChatNaturalLanguageReply({
    result,
    messageService,
  });
  const repeated = await persistTinyOfficeChatNaturalLanguageReply({
    result,
    messageService,
  });
  const messages = await messageService.listMessages("acme", "conversation-1");
  const handedOffConversation = await messageService.getConversation("acme", "conversation-1");

  assert.equal(persisted.kind, "persisted");
  assert.equal(persisted.message.sender.participantKind, "company_member");
  assert.equal(persisted.message.sender.memberId, "aster");
  assert.equal(persisted.message.body, "Confirmed from the channel.");
  assert.equal(repeated.kind, "already_persisted");
  assert.equal(handedOffConversation?.topic?.ownerParticipantId, conversation.participants.find((participant) => participant.memberId === "xuziho")?.participantId);
  assert.deepEqual(messages.messages.map((message) => message.messageId), ["message-1", "message-2"]);
});

test("TinyOffice Chat reply persistence has no employee sender fallback", async () => {
  const source = await readFile("src/runtime/realtime/tinyoffice-chat-reply-persistence.ts", "utf8");

  assert.doesNotMatch(source, /candidate\.employeeId === targetMemberId/);
  assert.doesNotMatch(source, /participantKind: "employee"/);
  assert.match(source, /participantKind: "company_member"/);
});

test("TinyOffice Chat execution dispatch ignores non-routable decisions without session writes", async () => {
  const decision = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-7",
    body: "General update.",
    conversation: conversation("topic"),
    employeeIds: ["iris-growth"],
  })[0];
  assert.equal(decision?.kind, "ignored");
  if (!decision || decision.kind !== "ignored") {
    return;
  }
  let writeCount = 0;

  const result = await handleTinyOfficeChatExecutionDispatch({
    decision,
    now: () => fixedNow,
    repository: {
      upsertSessionRecord() {
        writeCount += 1;
        throw new Error("ignored decision should not create a session");
      },
      appendSessionEvent() {
        writeCount += 1;
        throw new Error("ignored decision should not append an event");
      },
    },
  });

  assert.deepEqual(result, {
    kind: "ignored",
    reason: "no_target_member",
    eventKey: "tinyoffice_chat:chat_room_message:acme:conversation-1:message-7:iris-growth",
  });
  assert.equal(writeCount, 0);
});

test("TinyOffice Chat runtime dispatch sink lets blocked WorkRun recovery consume linked DM replies first", async () => {
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository: new InMemoryMessageRepository(),
  });
  await messageService.createConversation("acme", {
    title: "Blocked Work DM",
    conversationKind: "direct",
    participants: [
      {
        participantKind: "company_member",
        memberId: "xuziho",
        displayName: "Xu",
      },
      {
        participantKind: "company_member",
        memberId: "avery",
        displayName: "Avery",
      },
    ],
  });
  const userMessage = await messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "xuziho" },
    "Use the approved campaign URL.",
  );
  const consumed: unknown[] = [];
  const sink = createTinyOfficeChatRuntimeDispatchSink({
    repoRoot: process.cwd(),
    serviceForCompany: async () => messageService,
    async runtimeForCompany() {
      throw new Error("normal DM runtime should not start for a consumed WorkRun recovery reply");
    },
    workBlockedRecoveryMessageHandler: {
      async handleParticipantMessage(event) {
        consumed.push(event);
        return true;
      },
    },
  });

  await sink.handleChatDispatchEvent({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "xuziho",
    messageId: userMessage.message.messageId,
    body: userMessage.message.body,
  });

  assert.equal(consumed.length, 1);
  assert.deepEqual(consumed[0], {
    companyId: "acme",
    conversationId: "conversation-1",
    messageId: userMessage.message.messageId,
    actorMemberId: "xuziho",
    body: "Use the approved campaign URL.",
  });
});

test("TinyOffice Chat runtime dispatch sink runs provider-neutral reply persistence and realtime publish", async () => {
  const repository = new InMemoryMessageRepository();
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository,
  });
  await messageService.createConversation("acme", {
    title: "Owned Chat DM",
    conversationKind: "direct",
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
      },
    ],
  });
  const userMessage = await messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "iris-growth" },
    "Can you turn this into a brief action list?",
  );
  const runtimeSessionRepository = memoryRuntimeSessionRepository();
  const realtimePublisher = new CapturingRealtimePublisher();
  const traces: Record<string, unknown>[] = [];
  const processTraceEvents: ProcessTraceEvent[] = [];
  let capturedInput: Parameters<NonNullable<NaturalLanguageResponseInput["runtimeProvider"]>["reply"]>[0] | undefined;
  const sink = createTinyOfficeChatRuntimeDispatchSink({
    repoRoot: process.cwd(),
    serviceForCompany: async () => messageService,
    realtimePublisher,
    async runtimeForCompany() {
      return {
        companyId: "acme",
        employeeHomesById: new Map([["nora-automation", employeeHome()]]),
        employeeIds: ["iris-growth", "nora-automation"],
        processTrace: {
          async publishProcessTrace(event) {
            const normalized = {
              ...event,
              id: event.id ?? `trace-${processTraceEvents.length + 1}`,
              timestamp: event.timestamp ?? fixedNow,
            } as ProcessTraceEvent;
            processTraceEvents.push(normalized);
            return normalized;
          },
          async publishProcessTraceEvent(event) {
            const normalized = {
              ...event,
              id: event.id ?? `trace-${processTraceEvents.length + 1}`,
              timestamp: event.timestamp ?? fixedNow,
            } as ProcessTraceEvent;
            processTraceEvents.push(normalized);
            return normalized;
          },
        },
      };
    },
    async runtimeSessionRepositoryForCompany() {
      return { repository: runtimeSessionRepository.repository };
    },
    runtimeProvider: {
      providerId: "provider-neutral-test",
      async warm() {},
      async reply(input) {
        capturedInput = input;
        input.onTextDelta?.("Action list: confirm owner");
        return "Action list: confirm owner, capture deadline, publish summary.";
      },
      async abortWhere() {
        return 0;
      },
      async reloadWhere() {
        return { reloadedCount: 0, sessionKeys: [] };
      },
    },
    trace(entry) {
      traces.push(entry);
    },
  });

  await sink.handleChatDispatchEvent({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: userMessage.message.messageId,
    body: userMessage.message.body,
  });

  const messages = await messageService.listMessages("acme", "conversation-1");
  const reply = messages.messages.find((item) => item.sender.memberId === "nora-automation");

  assert.ok(reply);
  assert.equal(reply.body, "Action list: confirm owner, capture deadline, publish summary.");
  assert.equal(reply.runtimeLinks.some((link) => link.targetKind === "session"), true);
  const processTraceLink = reply.runtimeLinks.find((link) => link.targetKind === "process_trace");
  assert.equal(processTraceLink, undefined);
  assert.equal(processTraceEvents.some((event) => event.kind === "turn_completed"), true);
  assert.equal(processTraceEvents.some((event) => event.kind === "model_text_delta"), false);
  const startedTrace = processTraceEvents.find((event) => event.kind === "employee_reply_started");
  assert.equal(startedTrace?.metadata?.sourceMessageId, userMessage.message.messageId);
  assert.equal(startedTrace?.metadata?.targetMemberId, "nora-automation");
  assert.equal(startedTrace?.metadata?.runId, "tinyoffice_chat:chat_room_message:acme:conversation-1:message-1:nora-automation");
  assert.equal(startedTrace?.status, "running");
  const completedTrace = processTraceEvents.find((event) => event.kind === "turn_completed");
  assert.equal(completedTrace?.metadata?.sourceMessageId, userMessage.message.messageId);
  assert.equal(completedTrace?.metadata?.replyMessageId, reply.messageId);
  assert.equal(completedTrace?.metadata?.targetMemberId, "nora-automation");
  assert.equal(completedTrace?.metadata?.runId, "tinyoffice_chat:chat_room_message:acme:conversation-1:message-1:nora-automation");
  const realtimeTraceEvents = realtimePublisher.payloads.filter((event) => event.type === "chat.process_trace.appended");
  assert.deepEqual(
    realtimeTraceEvents.map((event) => [
      event.sourceMessageId,
      event.targetMemberId,
      event.sessionKey,
      event.processTraceEvent.kind,
    ]),
    [
      [userMessage.message.messageId, "nora-automation", "nora-automation|chat_direct_room|conversation-1", "employee_reply_started"],
      [userMessage.message.messageId, "nora-automation", "nora-automation|chat_direct_room|conversation-1", "turn_completed"],
    ],
  );
  assert.equal(capturedInput?.message, "Can you turn this into a brief action list?");
  assert.equal(capturedInput?.sessionKey, "nora-automation|chat_direct_room|conversation-1");
  assert.equal(capturedInput?.threadId, "conversation-1");
  assert.equal(capturedInput?.roomId, "conversation-1");
  assert.equal(capturedInput?.conversationId, "conversation-1");
  assert.equal(capturedInput?.messageId, userMessage.message.messageId);
  assert.equal(capturedInput?.channelTopicId, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(capturedInput || {}, "completionPolicy"), false);
  const deltaEvents = realtimePublisher.payloads.filter((event) => event.type === "chat.reply.delta");
  assert.deepEqual(deltaEvents.map((event) => [
    event.runId,
    event.sourceMessageId,
    event.targetMemberId,
    event.delta,
    event.sequenceInRun,
  ]), [[
    "tinyoffice_chat:chat_room_message:acme:conversation-1:message-1:nora-automation",
    userMessage.message.messageId,
    "nora-automation",
    "Action list: confirm owner",
    1,
  ]]);
  const snapshotEvents = realtimePublisher.payloads.filter((event) => event.type === "chat.reply.snapshot");
  assert.deepEqual(snapshotEvents.map((event) => [
    event.runId,
    event.sourceMessageId,
    event.targetMemberId,
    event.content,
    event.sequenceInRun,
  ]), [[
    "tinyoffice_chat:chat_room_message:acme:conversation-1:message-1:nora-automation",
    userMessage.message.messageId,
    "nora-automation",
    "Action list: confirm owner, capture deadline, publish summary.",
    2,
  ]]);
  assert.deepEqual(realtimePublisher.payloads.map((event) => event.type), [
    "chat.runtime_status.changed",
    "chat.runtime_status.changed",
    "chat.runtime_status.changed",
    "chat.process_trace.appended",
    "chat.runtime_status.changed",
    "chat.reply.delta",
    "chat.reply.snapshot",
    "chat.runtime_status.changed",
    "chat.message.created",
    "chat.projection.changed",
    "chat.projection.changed",
    "chat.runtime_status.changed",
    "chat.process_trace.appended",
  ]);
  const firstTraceIndex = realtimePublisher.payloads.findIndex((event) => event.type === "chat.process_trace.appended");
  const firstVisibleReplyIndex = realtimePublisher.payloads.findIndex((event) =>
    event.type === "chat.reply.delta" || event.type === "chat.reply.snapshot"
  );
  assert.ok(firstTraceIndex >= 0);
  assert.ok(firstVisibleReplyIndex >= 0);
  assert.ok(firstTraceIndex < firstVisibleReplyIndex);
  assert.deepEqual(
    realtimePublisher.payloads
      .filter((event) => event.type === "chat.runtime_status.changed")
      .map((event) => [event.status, event.sourceMessageId, event.targetMemberId, event.sessionKey]),
    [
      ["queued", userMessage.message.messageId, "nora-automation", "nora-automation|chat_direct_room|conversation-1"],
      ["received", userMessage.message.messageId, "nora-automation", "nora-automation|chat_direct_room|conversation-1"],
      ["thinking", userMessage.message.messageId, "nora-automation", "nora-automation|chat_direct_room|conversation-1"],
      ["streaming", userMessage.message.messageId, "nora-automation", "nora-automation|chat_direct_room|conversation-1"],
      ["replying", userMessage.message.messageId, "nora-automation", "nora-automation|chat_direct_room|conversation-1"],
      ["completed", userMessage.message.messageId, "nora-automation", "nora-automation|chat_direct_room|conversation-1"],
    ],
  );
  const completedStatus = realtimePublisher.payloads.find((event) =>
    event.type === "chat.runtime_status.changed" && event.status === "completed"
  );
  assert.equal(completedStatus?.replyMessageId, reply.messageId);
  assert.equal(runtimeSessionRepository.records.some((record) => record.employeeId === "nora-automation"), true);
  const ownedChatIntentRecord = runtimeSessionRepository.records.find((record) =>
    record.id === "tinyoffice-chat-session:tinyoffice_chat:chat_room_message:acme:conversation-1:message-1:nora-automation"
  );
  assert.equal(ownedChatIntentRecord?.status, "completed");
  assert.equal(runtimeSessionRepository.events.some((event) => event.kind === "user_message"), true);
  assert.equal(traces.some((entry) => entry.phase === "tinyoffice_chat_runtime_execution.reply.persisted"), true);
  assert.doesNotMatch(JSON.stringify({ reply, capturedInput, realtimeEvents: realtimePublisher.events, traces }), forbiddenCarrierFieldPattern);
});

test("TinyOffice Chat runtime dispatch sink requests topic summary refresh after channel replies", async () => {
  const repository = new InMemoryMessageRepository();
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository,
  });
  await messageService.createConversation("acme", {
    title: "Launch topic",
    conversationKind: "topic",
    topic: {
      title: "Launch topic",
      chatChannelId: "chat-channel-1",
    },
    participants: [
      {
        participantKind: "company_member",
        memberId: "xuziho",
        displayName: "Xuziho",
      },
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
      },
    ],
  });
  await messageService.updateConversationTopicSummary("acme", "conversation-1", {
    text: "Iris is coordinating launch checklist ownership.",
    sourceMessageId: "message-existing",
  });
  const userMessage = await messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "xuziho" },
    "@Nora please update the checklist and keep the topic moving.",
    { mentionedMemberIds: ["nora-automation"] },
  );
  const runtimeSessionRepository = memoryRuntimeSessionRepository();
  const requests: Array<{
    companyId: string;
    topicId: string;
    roomId: string;
    existingSummary?: string;
    sourceMessages: Array<{ messageId: string; body: string }>;
  }> = [];
  const sink = createTinyOfficeChatRuntimeDispatchSink({
    repoRoot: process.cwd(),
    serviceForCompany: async () => messageService,
    async runtimeForCompany() {
      return {
        companyId: "acme",
        employeeHomesById: new Map([
          ["nora-automation", employeeHome()],
          ["iris-growth", employeeHome("iris-growth")],
        ]),
        employeeIds: ["iris-growth", "nora-automation"],
      };
    },
    async runtimeSessionRepositoryForCompany() {
      return { repository: runtimeSessionRepository.repository };
    },
    runtimeProvider: {
      providerId: "provider-neutral-test",
      async warm() {},
      async reply(input) {
        emitHandoffTopicTurn(input, { toId: "xuziho" });
        return "I updated the checklist and will keep ownership for the next pass.";
      },
      async abortWhere() {
        return 0;
      },
      async reloadWhere() {
        return { reloadedCount: 0, sessionKeys: [] };
      },
    },
    topicSummaryGenerationService: {
      requestTopicSummaryGeneration(request) {
        requests.push({
          companyId: request.companyId,
          topicId: request.topicId,
          roomId: request.roomId,
          existingSummary: request.existingSummary,
          sourceMessages: request.sourceMessages.map((message) => ({
            messageId: message.messageId,
            body: message.body,
          })),
        });
      },
    },
    topicSummaryMinMessageCount: 2,
  });

  await sink.handleChatDispatchEvent({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "xuziho",
    messageId: userMessage.message.messageId,
    body: userMessage.message.body,
    mentionedMemberIds: ["nora-automation"],
  });

  const debugMessages = await messageService.listMessages("acme", "conversation-1");
  assert.equal(
    debugMessages.messages.map((message) => message.body).join(" | "),
    "@Nora please update the checklist and keep the topic moving. | I updated the checklist and will keep ownership for the next pass.",
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.companyId, "acme");
  assert.equal(requests[0]?.roomId, "conversation-1");
  assert.equal(requests[0]?.topicId, "topic-1");
  assert.equal(requests[0]?.existingSummary, "Iris is coordinating launch checklist ownership.");
  assert.deepEqual(requests[0]?.sourceMessages.map((message) => message.messageId), ["message-1", "message-2"]);
  assert.equal(requests[0]?.sourceMessages[1]?.body, "I updated the checklist and will keep ownership for the next pass.");
});

test("TinyOffice Chat runtime dispatch uses prior topic context cursor for repeated channel turns in the same session", async () => {
  const repository = new InMemoryMessageRepository();
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository,
  });
  await messageService.createConversation("acme", {
    title: "Launch topic",
    conversationKind: "topic",
    topic: {
      title: "Launch topic",
    },
    participants: [
      {
        participantKind: "company_member",
        memberId: "xuziho",
        displayName: "Xu",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
      },
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
    ],
  });
  const firstMessage = await messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "xuziho" },
    "@Nora first topic context that should not be resent.",
    { mentionedMemberIds: ["nora-automation"] },
  );
  const runtimeSessionRepository = memoryRuntimeSessionRepository();
  const capturedInputs: Array<Parameters<NonNullable<NaturalLanguageResponseInput["runtimeProvider"]>["reply"]>[0]> = [];
  const sink = createTinyOfficeChatRuntimeDispatchSink({
    repoRoot: process.cwd(),
    serviceForCompany: async () => messageService,
    async runtimeForCompany() {
      return {
        companyId: "acme",
        employeeHomesById: new Map([
          ["nora-automation", employeeHome()],
          ["iris-growth", employeeHome("iris-growth")],
        ]),
        employeeIds: ["nora-automation", "iris-growth"],
      };
    },
    async runtimeSessionRepositoryForCompany() {
      return { repository: runtimeSessionRepository.repository };
    },
    runtimeProvider: {
      providerId: "provider-neutral-test",
      async warm() {},
      async reply(input) {
        capturedInputs.push(input);
        emitHandoffTopicTurn(input, { toId: "xuziho" });
        return capturedInputs.length === 1
          ? "Nora processed the first topic turn."
          : "Nora processed the second topic turn.";
      },
      async abortWhere() {
        return 0;
      },
      async reloadWhere() {
        return { reloadedCount: 0, sessionKeys: [] };
      },
    },
  });

  await sink.handleChatDispatchEvent({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "xuziho",
    messageId: firstMessage.message.messageId,
    body: firstMessage.message.body,
    mentionedMemberIds: ["nora-automation"],
  });
  const secondMessage = await messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "xuziho" },
    "@Nora second topic context that should be incremental.",
    { mentionedMemberIds: ["nora-automation"] },
  );
  await sink.handleChatDispatchEvent({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "xuziho",
    messageId: secondMessage.message.messageId,
    body: secondMessage.message.body,
    mentionedMemberIds: ["nora-automation"],
  });

  assert.equal(capturedInputs.length, 2);
  const firstBlock = capturedInputs[0]?.contextBlocks?.[0];
  const secondBlock = capturedInputs[1]?.contextBlocks?.[0];
  assert.equal(firstBlock?.metadata?.mode, "initial");
  assert.equal(firstBlock?.metadata?.lastMessageId, firstMessage.message.messageId);
  assert.equal(secondBlock?.metadata?.mode, "incremental");
  assert.equal(secondBlock?.metadata?.cursorMessageId, firstMessage.message.messageId);
  assert.equal(secondBlock?.metadata?.lastMessageId, secondMessage.message.messageId);
  assert.match(secondBlock?.text || "", /New raw messages since previous Topic context:/);
  assert.doesNotMatch(secondBlock?.text || "", /first topic context that should not be resent/);
  assert.match(secondBlock?.text || "", /second topic context that should be incremental/);
});

test("TinyOffice Chat runtime dispatch sink publishes failed status when execution cannot persist a reply", async () => {
  const repository = new InMemoryMessageRepository();
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository,
  });
  await messageService.createConversation("acme", {
    title: "Owned Chat DM",
    conversationKind: "direct",
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
      },
    ],
  });
  const userMessage = await messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "iris-growth" },
    "Can you reply using the formal protocol?",
  );
  const runtimeSessionRepository = memoryRuntimeSessionRepository();
  const realtimePublisher = new CapturingRealtimePublisher();
  const processTraceEvents: ProcessTraceEvent[] = [];
  const errors: unknown[] = [];
  const sink = createTinyOfficeChatRuntimeDispatchSink({
    repoRoot: process.cwd(),
    serviceForCompany: async () => messageService,
    realtimePublisher,
    async runtimeForCompany() {
      return {
        companyId: "acme",
        employeeHomesById: new Map([["nora-automation", employeeHome()]]),
        employeeIds: ["iris-growth", "nora-automation"],
        processTrace: {
          async publishProcessTrace(event) {
            const normalized = {
              ...event,
              id: event.id ?? `trace-${processTraceEvents.length + 1}`,
              timestamp: event.timestamp ?? fixedNow,
            } as ProcessTraceEvent;
            processTraceEvents.push(normalized);
            return normalized;
          },
          async publishProcessTraceEvent(event) {
            const normalized = {
              ...event,
              id: event.id ?? `trace-${processTraceEvents.length + 1}`,
              timestamp: event.timestamp ?? fixedNow,
            } as ProcessTraceEvent;
            processTraceEvents.push(normalized);
            return normalized;
          },
        },
      };
    },
    async runtimeSessionRepositoryForCompany() {
      return { repository: runtimeSessionRepository.repository };
    },
    runtimeProvider: {
      providerId: "provider-neutral-test",
      async warm() {},
      async reply() {
        return "";
      },
      async abortWhere() {
        return 0;
      },
      async reloadWhere() {
        return { reloadedCount: 0, sessionKeys: [] };
      },
    },
    onError(error) {
      errors.push(error);
    },
  });

  await sink.handleChatDispatchEvent({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: userMessage.message.messageId,
    body: userMessage.message.body,
  });

  const messages = await messageService.listMessages("acme", "conversation-1");
  const statusEvents = realtimePublisher.payloads.filter((event) => event.type === "chat.runtime_status.changed");
  const failedStatus = statusEvents.find((event) => event.status === "failed");

  assert.equal(messages.messages.length, 1);
  assert.equal(errors.length, 1);
  assert.deepEqual(statusEvents.map((event) => event.status), ["queued", "received", "thinking", "failed"]);
  assert.equal(failedStatus?.sourceMessageId, userMessage.message.messageId);
  assert.equal(failedStatus?.targetMemberId, "nora-automation");
  assert.match(failedStatus?.errorMessage ?? "", /empty reply/i);
  assert.equal(processTraceEvents.length, 2);
  assert.equal(processTraceEvents[0]?.kind, "employee_reply_started");
  assert.equal(processTraceEvents[0]?.status, "running");
  assert.equal(processTraceEvents[1]?.kind, "turn_failed");
  assert.equal(processTraceEvents[1]?.metadata?.sourceMessageId, userMessage.message.messageId);
  assert.equal(processTraceEvents[1]?.metadata?.targetMemberId, "nora-automation");
  assert.equal(processTraceEvents[1]?.metadata?.runId, "tinyoffice_chat:chat_room_message:acme:conversation-1:message-1:nora-automation");
  const failedRealtimeTrace = realtimePublisher.payloads
    .filter((event) => event.type === "chat.process_trace.appended")
    .at(-1);
  assert.equal(failedRealtimeTrace?.type, "chat.process_trace.appended");
  assert.equal(failedRealtimeTrace?.sourceMessageId, userMessage.message.messageId);
  assert.equal(failedRealtimeTrace?.targetMemberId, "nora-automation");
  assert.equal(failedRealtimeTrace?.processTraceEvent.kind, "turn_failed");
  const firstRealtimeTraceIndex = realtimePublisher.payloads.findIndex((event) =>
    event.type === "chat.process_trace.appended" &&
    event.processTraceEvent.kind === "employee_reply_started"
  );
  const failedStatusIndex = realtimePublisher.payloads.findIndex((event) =>
    event.type === "chat.runtime_status.changed" &&
    event.status === "failed"
  );
  assert.ok(firstRealtimeTraceIndex >= 0);
  assert.ok(failedStatusIndex >= 0);
  assert.ok(firstRealtimeTraceIndex < failedStatusIndex);
  assert.doesNotMatch(JSON.stringify({ realtimeEvents: realtimePublisher.events, errors: errors.map(String) }), forbiddenCarrierFieldPattern);
});

test("TinyOffice Chat runtime dispatch sink can cancel the currently running handoff child run", async () => {
  const repository = new InMemoryMessageRepository();
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository,
  });
  await messageService.createConversation("acme", {
    title: "Launch topic",
    conversationKind: "topic",
    participants: [
      {
        participantKind: "company_member",
        memberId: "xuziho",
        displayName: "Xuziho",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
      },
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
    ],
    topic: {
      topicId: "topic-launch",
      title: "Launch topic",
      status: "open",
    },
  });
  const userMessage = await messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "iris-growth" },
    "@Nora start this and hand it to Iris.",
  );
  const runtimeSessionRepository = memoryRuntimeSessionRepository();
  const realtimePublisher = new CapturingRealtimePublisher();
  const backgroundErrors: unknown[] = [];
  let irisReject: ((error: Error) => void) | undefined;
  const abortAttempts: Array<{ employeeId: string; sessionKey: string }> = [];
  const sink = createTinyOfficeChatRuntimeDispatchSink({
    repoRoot: process.cwd(),
    serviceForCompany: async () => messageService,
    realtimePublisher,
    async runtimeForCompany() {
      return {
        companyId: "acme",
        employeeHomesById: new Map([
          ["nora-automation", employeeHome("nora-automation")],
          ["iris-growth", employeeHome("iris-growth")],
        ]),
        employeeIds: ["nora-automation", "iris-growth"],
      };
    },
    async runtimeSessionRepositoryForCompany() {
      return { repository: runtimeSessionRepository.repository };
    },
    runtimeProvider: {
      providerId: "provider-neutral-test",
      async warm() {},
      async reply(input) {
        if (input.employee.employeeId === "nora-automation") {
          emitHandoffTopicTurn(input, { toId: "iris-growth" });
          return "Iris should take the next step.";
        }
        return new Promise<string>((_resolve, reject) => {
          irisReject = reject;
        });
      },
      async abortWhere(predicate) {
        const candidate = {
          employeeId: "iris-growth",
          sessionKey: "iris-growth|chat_topic_room|conversation-1",
        };
        if (!predicate(candidate)) {
          return 0;
        }
        abortAttempts.push(candidate);
        irisReject?.(new Error("aborted by test"));
        return 1;
      },
      async reloadWhere() {
        return { reloadedCount: 0, sessionKeys: [] };
      },
    },
    runInBackground(task) {
      task.catch((error) => backgroundErrors.push(error));
    },
  });

  await sink.handleChatDispatchEvent({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: userMessage.message.messageId,
    body: userMessage.message.body,
    mentionedMemberIds: ["nora-automation"],
  });

  const irisThinkingEvent = await waitFor(() =>
    realtimePublisher.payloads.find((event) =>
      event.type === "chat.runtime_status.changed" &&
      event.targetMemberId === "iris-growth" &&
      event.status === "thinking"
    )
  );
  assert.equal(irisThinkingEvent.type, "chat.runtime_status.changed");
  const messagesBeforeCancel = await messageService.listMessages("acme", "conversation-1");
  const parentReplyMessage = messagesBeforeCancel.messages.find((message) => message.sender.memberId === "nora-automation");
  assert.ok(parentReplyMessage);
  const parentReplyCreatedIndex = realtimePublisher.payloads.findIndex((event) =>
    event.type === "chat.message.created" &&
    event.messageId === parentReplyMessage.messageId
  );
  const childFirstStatusIndex = realtimePublisher.payloads.findIndex((event) =>
    event.type === "chat.runtime_status.changed" &&
    event.targetMemberId === "iris-growth"
  );
  assert.ok(parentReplyCreatedIndex >= 0);
  assert.ok(childFirstStatusIndex > parentReplyCreatedIndex);
  const parentCompletedIndex = realtimePublisher.payloads.findIndex((event) =>
    event.type === "chat.runtime_status.changed" &&
    event.targetMemberId === "nora-automation" &&
    event.status === "completed"
  );
  assert.ok(childFirstStatusIndex < parentCompletedIndex);
  const parentRun = realtimePublisher.payloads.find((event) =>
    event.type === "chat.runtime_status.changed" &&
    event.targetMemberId === "nora-automation" &&
    event.status === "completed"
  );
  assert.equal(parentRun?.type, "chat.runtime_status.changed");
  if (!parentRun || parentRun.type !== "chat.runtime_status.changed") {
    return;
  }

  assert.deepEqual(await sink.getActiveChatRun?.("acme", {
    roomId: "conversation-1",
    actor: { memberId: "xuziho" },
  }), {
    companyId: "acme",
    roomId: "conversation-1",
    chainId: parentRun.chainId,
    runId: irisThinkingEvent.runId,
    sourceMessageId: userMessage.message.messageId,
    targetMemberId: "iris-growth",
    status: "active",
  });
  await assert.rejects(() => sink.assertCanDispatch?.("acme", {
    roomId: "conversation-1",
    actor: { memberId: "xuziho" },
  }) ?? Promise.resolve(), /already has an active employee/);

  await assert.rejects(() => sink.cancelChatRun?.("acme", {
    runId: parentRun.runId,
    actor: { memberId: "outsider" },
    reason: "Unauthorized stop attempt.",
  }), /not available to the current Topic participant/);
  assert.deepEqual(abortAttempts, []);

  const cancelResult = await sink.cancelChatRun?.("acme", {
    runId: parentRun.runId,
    actor: { memberId: "xuziho" },
    reason: "User stopped the current handoff run.",
  });
  await waitFor(() =>
    realtimePublisher.payloads.find((event) =>
      event.type === "chat.runtime_status.changed" &&
      event.runId === irisThinkingEvent.runId &&
      event.status === "canceled"
    )
  );

  assert.equal(cancelResult?.status, "canceled");
  assert.equal(cancelResult?.canceledCount, 1);
  assert.deepEqual(
    realtimePublisher.payloads
      .filter((event) =>
        event.type === "chat.runtime_status.changed" &&
        event.runId === irisThinkingEvent.runId &&
        (event.status === "cancel_requested" || event.status === "canceled")
      )
      .map((event) => event.status),
    ["cancel_requested", "canceled"],
  );
  assert.deepEqual(abortAttempts, [{
    employeeId: "iris-growth",
    sessionKey: "iris-growth|chat_topic_room|conversation-1",
  }]);
  assert.equal(await sink.getActiveChatRun?.("acme", {
    roomId: "conversation-1",
    actor: { memberId: "xuziho" },
  }), null);
  assert.deepEqual(backgroundErrors, []);
});

test("TinyOffice Chat repairs one missing Channel handoff without replacing the visible reply", async () => {
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "iris-growth",
    messageId: "message-missing-handoff",
    body: "Nora, introduce yourself and pass this to Iris.",
    mentionedMemberIds: ["nora-automation"],
    conversation: conversation("topic"),
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return conversation("topic");
      },
      async listRecentMessages() {
        return { messages: [message({
          messageId: "message-missing-handoff",
          senderMemberId: "iris-growth",
          body: "Nora, introduce yourself and pass this to Iris.",
          mentionedMemberIds: ["nora-automation"],
          createdAt: "2026-06-24T04:35:00.000Z",
        })] };
      },
    },
    participantProfiles: [
      { id: "iris-growth", displayName: "Iris", runtimeCapable: true },
      { id: "nora-automation", displayName: "Nora", runtimeCapable: true },
    ],
  });
  const calls: NaturalLanguageResponseInput[] = [];
  const result = await executeTinyOfficeChatNaturalLanguageTurn({
    context,
    employee: employeeHome(),
    runtimeSessionRepository: memoryRuntimeSessionRepository().repository,
    runtimeProvider: {
      async reply(runtimeInput) {
        calls.push(runtimeInput);
        if (calls.length === 1) {
          return "I am Nora, and Iris should continue next.";
        }
        emitHandoffTopicTurn(runtimeInput, { toId: "iris-growth" });
        return "";
      },
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]?.activeToolNames, ["handoff_topic_turn"]);
  assert.match(calls[1]?.contextBlocks?.[0]?.text || "", /Do not write another visible reply/);
  assert.match(
    calls[1]?.contextBlocks?.[0]?.text || "",
    /id="iris-growth"; displayName="Iris"/,
  );
  assert.equal(result.chatOutput.message, "I am Nora, and Iris should continue next.");
  assert.equal(result.stateAction?.targetMemberId, "iris-growth");
});

test("TinyOffice Chat channel context omits a provisional title that repeats the trigger body", async () => {
  const triggerBody = "请大家依次介绍自己的职责，并把球传给下一位。介绍时说明姓名、职责和最擅长帮助团队解决的问题。";
  const baseConversation = memberTopicConversation("conversation-provisional-title");
  const topicConversation: ConversationDto = {
    ...baseConversation,
    title: triggerBody.slice(0, 40),
    topic: baseConversation.topic ? { ...baseConversation.topic, title: triggerBody.slice(0, 40) } : undefined,
  };
  const [decision] = buildTinyOfficeChatTurnDispatches({
    source: "chat_room_message",
    companyId: "acme",
    roomId: topicConversation.conversationId,
    actorMemberId: "xuziho",
    messageId: "message-introduction-round",
    body: triggerBody,
    mentionedMemberIds: ["nora-automation"],
    conversation: topicConversation,
    employeeIds: ["iris-growth", "nora-automation"],
  });
  assert.equal(decision?.kind, "routable");
  if (!decision || decision.kind !== "routable") {
    return;
  }
  const context = await assembleTinyOfficeChatRoomContext({
    decision,
    resolver: {
      async getConversation() {
        return topicConversation;
      },
      async listRecentMessages() {
        return {
          messages: [message({
            conversationId: topicConversation.conversationId,
            messageId: "message-introduction-round",
            senderMemberId: "xuziho",
            body: triggerBody,
            createdAt: fixedNow,
          })],
        };
      },
    },
  });
  const naturalLanguageInput = buildNaturalLanguageInputFromTinyOfficeChatRoomContext({
    context,
    employee: employeeHome(),
  });
  const text = naturalLanguageInput.contextBlocks?.[0]?.text || "";

  assert.doesNotMatch(text, /- title:/);
  assert.equal(text.match(new RegExp(triggerBody, "g"))?.length, 1);
});

test("TinyOffice Chat state action rejects a Channel turn that omits handoff_topic_turn", () => {
  const result = resolveChatTurnStateAction({
    sceneType: "channel",
    topicId: "topic-1",
    assistantMessage: "I finished my part and am returning the topic.",
    reachableParticipants: [{ id: "xuziho", displayName: "Xu Ziho", role: "boss" }],
    events: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: "handoff_topic_turn must be called exactly once in every Channel Topic turn.",
  });
});

test("TinyOffice Chat runtime dispatch sink suppresses late provider replies after cancellation", async () => {
  const repository = new InMemoryMessageRepository();
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository,
  });
  await messageService.createConversation("acme", {
    title: "Owned Chat DM",
    conversationKind: "direct",
    participants: [
      {
        participantKind: "company_member",
        memberId: "xuziho",
        displayName: "Xuziho",
      },
      {
        participantKind: "company_member",
        memberId: "aster",
        displayName: "Aster",
      },
    ],
  });
  const userMessage = await messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "xuziho" },
    "Please inspect your workspace, but I may stop this run.",
  );
  const runtimeSessionRepository = memoryRuntimeSessionRepository();
  const realtimePublisher = new CapturingRealtimePublisher();
  const backgroundErrors: unknown[] = [];
  let releaseProviderReply: (() => void) | undefined;
  const sink = createTinyOfficeChatRuntimeDispatchSink({
    repoRoot: process.cwd(),
    serviceForCompany: async () => messageService,
    realtimePublisher,
    async runtimeForCompany() {
      return {
        companyId: "acme",
        employeeHomesById: new Map([["aster", employeeHome("aster")]]),
        employeeIds: ["aster"],
      };
    },
    async runtimeSessionRepositoryForCompany() {
      return { repository: runtimeSessionRepository.repository };
    },
    runtimeProvider: {
      providerId: "provider-neutral-test",
      async warm() {},
      async reply() {
        await new Promise<void>((resolve) => {
          releaseProviderReply = resolve;
        });
        return "This reply arrived after the user stopped the run.";
      },
      async abortWhere(predicate) {
        return predicate({
          employeeId: "aster",
          sessionKey: "aster|chat_direct_room|conversation-1",
        })
          ? 1
          : 0;
      },
      async reloadWhere() {
        return { reloadedCount: 0, sessionKeys: [] };
      },
    },
    runInBackground(task) {
      task.catch((error) => backgroundErrors.push(error));
    },
  });

  await sink.handleChatDispatchEvent({
    source: "chat_room_message",
    companyId: "acme",
    roomId: "conversation-1",
    actorMemberId: "xuziho",
    messageId: userMessage.message.messageId,
    body: userMessage.message.body,
  });

  const thinkingEvent = await waitFor(() =>
    realtimePublisher.payloads.find((event) =>
      event.type === "chat.runtime_status.changed" &&
      event.targetMemberId === "aster" &&
      event.status === "thinking"
    )
  );
  assert.equal(thinkingEvent.type, "chat.runtime_status.changed");

  const cancelResult = await sink.cancelChatRun?.("acme", {
    runId: thinkingEvent.runId,
    actor: { memberId: "xuziho" },
    reason: "User stopped this run before the late provider reply.",
  });
  releaseProviderReply?.();
  await waitFor(() =>
    runtimeSessionRepository.records.find((record) =>
      record.id === `tinyoffice-chat-session:${thinkingEvent.runId}` &&
      record.status !== "running"
    )
  );

  const messages = await messageService.listMessages("acme", "conversation-1");
  const statusEvents = realtimePublisher.payloads.filter((event) =>
    event.type === "chat.runtime_status.changed" && event.runId === thinkingEvent.runId
  );

  assert.equal(cancelResult?.status, "canceled");
  assert.deepEqual(messages.messages.map((message) => message.body), [
    "Please inspect your workspace, but I may stop this run.",
  ]);
  assert.equal(statusEvents.some((event) => event.status === "completed"), false);
  assert.equal(realtimePublisher.payloads.some((event) =>
    (event.type === "chat.reply.delta" || event.type === "chat.reply.snapshot") &&
    event.runId === thinkingEvent.runId
  ), false);
  assert.equal(runtimeSessionRepository.records.find((record) =>
    record.id === `tinyoffice-chat-session:${thinkingEvent.runId}`
  )?.status, "canceled");
  assert.deepEqual(backgroundErrors, []);
});

test("TinyOffice Chat retry rejects an inactive runtime target before acknowledging the retry", async () => {
  const repository = new InMemoryMessageRepository();
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository,
  });
  await messageService.createConversation("acme", {
    title: "Historical inactive employee DM",
    conversationKind: "direct",
    participants: [
      { participantKind: "company_member", memberId: "xuziho", displayName: "Xuziho" },
      { participantKind: "company_member", memberId: "inactive-analyst", displayName: "Inactive Analyst" },
    ],
  });
  const source = await messageService.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "xuziho" },
    "Retry the failed request.",
  );
  const sink = createTinyOfficeChatRuntimeDispatchSink({
    repoRoot: process.cwd(),
    serviceForCompany: async () => messageService,
    async runtimeForCompany() {
      return { companyId: "acme", employeeHomesById: new Map(), employeeIds: [] };
    },
  });

  await assert.rejects(
    () => sink.retryChatRun!("acme", {
      roomId: "conversation-1",
      sourceMessageId: source.message.messageId,
      targetMemberId: "inactive-analyst",
      actor: { participantKind: "company_member", memberId: "xuziho" },
    }),
    /not an active runtime-capable member/,
  );
});

async function waitFor<T>(read: () => T | undefined, timeoutMs = 1000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for expected test state.");
}
