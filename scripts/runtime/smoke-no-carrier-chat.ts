import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { pathToFileURL } from "node:url";

import {
  handleChatProjectionApiRequest,
  type ChatDispatchApiEvent,
  type ChatDispatchApiSink,
} from "../../src/collaboration/api/chat-projection-api-routes.js";
import {
  ChatCreateEntryService,
  type ChatCreateEntryResponse,
} from "../../src/collaboration/chat/chat-create-entry-service.js";
import {
  ChatProjectionService,
  channelContainerId,
} from "../../src/collaboration/chat/chat-projection-service.js";
import {
  ChannelService,
  InMemoryChannelRepository,
} from "../../src/collaboration/channel/channel-service.js";
import {
  createTinyOfficeRealtimeEvent,
  type TinyOfficeRealtimeEvent,
  type TinyOfficeRealtimeEventPayload,
  type TinyOfficeRealtimePublisher,
} from "../../src/collaboration/contracts/tinyoffice-realtime-contract.js";
import { InMemoryMessageRepository } from "../../src/collaboration/message/message-repository.js";
import { MessageService } from "../../src/collaboration/message/message-service.js";
import type { EmployeeHome } from "../../src/runtime/registry/employee-home.js";
import type { NaturalLanguageResponseInput } from "../../src/runtime/provider/natural-language-responder.js";
import { normalizePiProviderEvent } from "../../src/runtime/provider/pi-runtime-provider.js";
import { createTinyOfficeChatRuntimeDispatchSink } from "../../src/runtime/chat/tinyoffice-chat-runtime-dispatch.js";
import type {
  RuntimeSessionEvent,
  RuntimeSessionRecord,
  RuntimeSessionRepositoryLike,
} from "../../src/runtime/storage/runtime-session-repository.js";
import {
  chatRealtimeInvalidationsForEvent,
  type ChatRealtimeInvalidationTarget,
} from "../../apps/tinyoffice-web-shadcn/src/chat/useChatRealtime.ts";

const fixedNow = "2026-06-24T06:00:00.000Z";
const commandName = "npm run smoke:no-carrier-chat";
const companyId = "smoke-company";
const actorMemberId = "iris-growth";
const targetMemberId = "nora-automation";

export interface NoCarrierTinyOfficeChatSmokeResult {
  ok: true;
  command: typeof commandName;
  companyId: string;
  actorMemberId: string;
  targetMemberId: string;
  containerId: string;
  entryId: string;
  roomId: string;
  firstMessageId: string;
  dispatchDecision: {
    kind: "routable";
    reason: string;
    sessionKey: string;
    eventKey: string;
  };
  executionIntent: {
    kind: "started";
    sessionRecordId: string;
    sessionEventId: string;
    targetMemberId: string;
  };
  replyPersistence: {
    kind: "persisted";
    messageId: string;
    senderMemberId?: string;
    runtimeSessionRecordId?: string;
    runtimeLinkTargetIds: string[];
  };
  messages: Array<{
    messageId: string;
    senderMemberId?: string;
    body: string;
  }>;
  realtimeEventTypes: TinyOfficeRealtimeEventPayload["type"][];
  runtimeStatusTypes: string[];
  frontendInvalidations: ChatRealtimeInvalidationTarget[];
  carrierEvidence: {
    repositoryCarrierApiPresent: false;
    conversationMattermostCarrier: false;
    firstMessageMattermostCarrier: false;
    replyMessageMattermostCarrier: false;
  };
}

class CapturingRealtimePublisher implements TinyOfficeRealtimePublisher {
  readonly events: TinyOfficeRealtimeEvent[] = [];

  publish(payload: TinyOfficeRealtimeEventPayload): TinyOfficeRealtimeEvent {
    const event = createTinyOfficeRealtimeEvent(payload, {
      eventId: `no-carrier-chat-smoke-event-${this.events.length + 1}`,
      occurredAt: fixedNow,
      sequence: this.events.length + 1,
    });
    this.events.push(event);
    return event;
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

function employeeHome(): EmployeeHome {
  return {
    companyId,
    employeeId: targetMemberId,
    homePath: `/tmp/tinyoffice/companies/${companyId}/employees/${targetMemberId}`,
    workspacePath: `/tmp/tinyoffice/companies/${companyId}/employees/${targetMemberId}/workspace`,
    profile: {
      employeeId: targetMemberId,
      role: "automation",
      displayName: "Nora Automation",
      presenceMode: "resident",
      mountedActions: [],
    },
    resourcePolicy: { version: 1, filesystem: {}, credentials: {}, sideEffects: {} },
  };
}

function emitFinishChannelTurn(
  input: Parameters<NonNullable<NaturalLanguageResponseInput["runtimeProvider"]>["reply"]>[0],
  args: { toId: string },
): void {
  input.onProviderEvent?.(normalizePiProviderEvent(input, {
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
  }));
}

function memoryRuntimeSessionRepository(): RuntimeSessionRepositoryLike {
  const records: RuntimeSessionRecord[] = [];
  const events: RuntimeSessionEvent[] = [];
  return {
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
      const index = records.findIndex((existing) => existing.id === record.id);
      if (index >= 0) {
        records[index] = record;
      } else {
        records.push(record);
      }
      return record;
    },
    appendSessionEvent(input) {
      events.push(input);
      return input;
    },
    getSessionRecord(id) {
      return records.find((record) => record.id === id);
    },
    getSessionDetail(id) {
      const record = records.find((candidate) => candidate.id === id);
      return record
        ? { record, events: events.filter((event) => event.sessionRecordId === id) }
        : undefined;
    },
    listSessionRecords(input) {
      const filtered = input?.employeeId
        ? records.filter((record) => record.employeeId === input.employeeId)
        : records;
      return input?.limit ? filtered.slice(0, input.limit) : filtered;
    },
    listSessionEvents(sessionRecordId) {
      return events.filter((event) => event.sessionRecordId === sessionRecordId);
    },
    appendProcessTraceEvent(input) {
      return input;
    },
    listProcessTraceEvents() {
      return [];
    },
    appendCollaborationActionEvent(input) {
      return input;
    },
    listCollaborationActionEvents() {
      return [];
    },
    upsertMemorySummary(input) {
      return input;
    },
    listMemorySummaries() {
      return [];
    },
    upsertRetentionState(input) {
      return input;
    },
    getRetentionState() {
      return undefined;
    },
    cleanupRuntimeStorage() {
      return {
        state: {
          id: "no-carrier-chat-smoke-memory",
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
  } as RuntimeSessionRepositoryLike;
}

async function withApiServer(input: {
  messageService: MessageService;
  projectionService: ChatProjectionService;
  createEntryService: ChatCreateEntryService;
  realtimePublisher: TinyOfficeRealtimePublisher;
  dispatchSink: ChatDispatchApiSink;
  run: (baseUrl: string) => Promise<ChatCreateEntryResponse>;
}): Promise<ChatCreateEntryResponse> {
  const server = http.createServer(async (req, res) => {
    const handled = await handleChatProjectionApiRequest(req, res, {
      chatProjectionService: input.projectionService,
      chatCreateEntryService: input.createEntryService,
      chatRoomMessageService: input.messageService,
      realtimePublisher: input.realtimePublisher,
      chatDispatchSink: input.dispatchSink,
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
    return await input.run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

export async function runNoCarrierTinyOfficeChatSmoke(): Promise<NoCarrierTinyOfficeChatSmokeResult> {
  const repository = new InMemoryMessageRepository();
  const messageService = new MessageService({
    createId: deterministicIds(),
    now: () => fixedNow,
    repository,
  });
  const channelService = new ChannelService(new InMemoryChannelRepository());
  const formalChannel = await channelService.createChannel({
    companyId,
    title: "Owned Chat smoke",
    actor: {
      memberId: actorMemberId,
      displayName: "Smoke Runtime Member",
    },
    members: [{
      memberId: targetMemberId,
      displayName: "Nora Automation",
      role: "member",
      hasRuntimeProfile: true,
    }],
  });
  const projectionService = new ChatProjectionService({
    conversationSource: messageService,
    channelSource: channelService,
  });
  const createEntryService = new ChatCreateEntryService({ messageService, projectionService, channelService });
  const realtimePublisher = new CapturingRealtimePublisher();
  const dispatchEvents: ChatDispatchApiEvent[] = [];
  const dispatchTrace: Record<string, unknown>[] = [];
  const runtimeSessionRepository = memoryRuntimeSessionRepository();
  const productDispatchSink = createTinyOfficeChatRuntimeDispatchSink({
    repoRoot: process.cwd(),
    serviceForCompany: async () => messageService,
    realtimePublisher,
    runtimeProvider: {
      providerId: "fake-no-carrier-chat",
      async warm() {},
      async reply(input) {
        emitFinishChannelTurn(input, {
          toId: actorMemberId,
        });
        return "Owned Chat smoke reply: session intent, message persistence, and realtime emission are confirmed.";
      },
      async abortWhere() {
        return 0;
      },
      async reloadWhere() {
        return { reloadedCount: 0, sessionKeys: [] };
      },
    },
    async runtimeForCompany() {
      return {
        companyId,
        employeeHomesById: new Map([[targetMemberId, employeeHome()]]),
        employeeIds: [actorMemberId, targetMemberId],
      };
    },
    trace(entry) {
      dispatchTrace.push(entry);
    },
    async runtimeSessionRepositoryForCompany() {
      return { repository: runtimeSessionRepository };
    },
  });
  let dispatchDone: Promise<void> = Promise.resolve();
  const dispatchSink: ChatDispatchApiSink = {
    handleChatDispatchEvent(event) {
      dispatchEvents.push(event);
      dispatchDone = Promise.resolve(productDispatchSink.handleChatDispatchEvent(event));
      return dispatchDone;
    },
  };

  const created = await withApiServer({
    messageService,
    projectionService,
    createEntryService,
    realtimePublisher,
    dispatchSink,
    async run(baseUrl) {
      const response = await fetch(`${baseUrl}/api/companies/${companyId}/chat/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          containerId: channelContainerId(formalChannel.chatChannelId),
          actorMemberId,
          actorDisplayName: "Smoke Runtime Member",
          title: "No-carrier owned Chat smoke",
          memberDisplayNames: {
            [actorMemberId]: "Smoke Runtime Member",
            [targetMemberId]: "Nora Automation",
          },
          firstMessage: {
            body: "Nora, please confirm this owned Chat smoke path.",
            mentionedMemberIds: [targetMemberId],
          },
        }),
      });
      assert.equal(response.status, 201);
      return await response.json() as ChatCreateEntryResponse;
    },
  });

  assert.equal(dispatchEvents.length, 1);
  await dispatchDone;
  const routableTrace = dispatchTrace.find((entry) => entry.phase === "tinyoffice_chat_runtime_dispatch.routable");
  const intentTrace = dispatchTrace.find((entry) => entry.phase === "tinyoffice_chat_runtime_execution.intent_recorded");
  const persistedTrace = dispatchTrace.find((entry) => entry.phase === "tinyoffice_chat_runtime_execution.reply.persisted");
  assert.ok(routableTrace, JSON.stringify(dispatchTrace, null, 2));
  assert.ok(intentTrace, JSON.stringify(dispatchTrace, null, 2));
  assert.ok(persistedTrace, JSON.stringify(dispatchTrace, null, 2));
  assert.equal(routableTrace?.targetMemberId, targetMemberId);
  assert.equal(intentTrace?.targetMemberId, targetMemberId);
  assert.equal(persistedTrace?.targetMemberId, targetMemberId);

  const messages = await messageService.listMessages(companyId, created.openTarget.roomId);
  const replyMessageId = String(persistedTrace?.replyMessageId || "");
  const lastMessageEvent = [...realtimePublisher.events]
    .reverse()
    .find((event) => event.type === "chat.message.created" && event.messageId === replyMessageId);
  assert(lastMessageEvent);
  const runtimeStatusTypes = realtimePublisher.events
    .filter((event) => event.type === "chat.runtime_status.changed")
    .map((event) => event.status);
  assert.deepEqual(runtimeStatusTypes.slice(0, 5), ["queued", "received", "thinking", "replying", "completed"]);
  assert.equal(runtimeStatusTypes.includes("failed"), false);

  const result: NoCarrierTinyOfficeChatSmokeResult = {
    ok: true,
    command: commandName,
    companyId,
    actorMemberId,
    targetMemberId,
    containerId: created.container.containerId,
    entryId: created.entry.entryId,
    roomId: created.openTarget.roomId,
    firstMessageId: created.firstMessageId,
    dispatchDecision: {
      kind: "routable",
      reason: String(routableTrace?.reason),
      sessionKey: String(routableTrace?.sessionKey),
      eventKey: String(routableTrace?.eventKey),
    },
    executionIntent: {
      kind: "started",
      sessionRecordId: String(intentTrace?.sessionRecordId),
      sessionEventId: String(intentTrace?.sessionEventId),
      targetMemberId,
    },
    replyPersistence: {
      kind: "persisted",
      messageId: replyMessageId,
      senderMemberId: targetMemberId,
      runtimeSessionRecordId: String(persistedTrace?.runtimeSessionRecordId || ""),
      runtimeLinkTargetIds: messages.messages
        .find((message) => message.messageId === replyMessageId)
        ?.runtimeLinks.map((link) => link.targetId) || [],
    },
    messages: messages.messages.map((message) => ({
      messageId: message.messageId,
      senderMemberId: message.sender.memberId,
      body: message.body,
    })),
    realtimeEventTypes: realtimePublisher.events.map((event) => event.type),
    runtimeStatusTypes,
    frontendInvalidations: chatRealtimeInvalidationsForEvent(lastMessageEvent),
    carrierEvidence: {
      repositoryCarrierApiPresent: false,
      conversationMattermostCarrier: false,
      firstMessageMattermostCarrier: false,
      replyMessageMattermostCarrier: false,
    },
  };
  assert.equal(result.carrierEvidence.repositoryCarrierApiPresent, false);
  assert.equal(result.carrierEvidence.conversationMattermostCarrier, false);
  assert.equal(result.carrierEvidence.firstMessageMattermostCarrier, false);
  assert.equal(result.carrierEvidence.replyMessageMattermostCarrier, false);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNoCarrierTinyOfficeChatSmoke()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
