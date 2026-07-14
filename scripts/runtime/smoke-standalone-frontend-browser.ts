import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Server as SocketIOServer } from "socket.io";

const commandName = "npm run smoke:standalone-frontend-browser";
const companyId = "tinyoffice";
const viewerMemberId = "xuziho";
const viewerMemberDisplayName = "Xu Ziho";
const viewerMemberRole = "boss";
const targetEmployeeId = "nora-automation";
const topicRoomId = "smoke-room-pricing";
const existingDmRoomId = "smoke-room-dm-nora-existing";
const createdDmRoomId = "smoke-room-dm-nora-created";
const chatChannelId = "smoke-channel-ops";
const containerId = `chat-container-channel-${chatChannelId}`;
const entryId = "smoke-entry-pricing";
const dmContainerId = `chat-container-member-dm-${targetEmployeeId}`;
const existingDmEntryId = "smoke-entry-dm-nora-existing";
const createdDmEntryId = "smoke-entry-dm-nora-created";
const evidenceSessionId = "session-owned-chat-employee-reply-20260624T060000Z-smoke-proof-long-id";
const evidenceSessionLabel = "Owned Chat employee reply";
const startedAt = "2026-06-24T06:00:00.000Z";
const standaloneAppPath = "apps/tinyoffice-web-shadcn";
const startupTimeoutMs = 45_000;
const maxCapturedProcessOutputLength = 12_000;

type SmokeMessage = {
  messageId: string;
  roomId: string;
  body: string;
  senderEmployeeId?: string;
  senderMemberId?: string;
  senderDisplayName: string;
  mentionedEmployeeIds?: string[];
  runtimeLinks?: ReturnType<typeof entryRuntimeLink>[];
  createdAt: string;
};

type BrowserChoice = {
  name: string;
  executablePath: string;
};

type CapturedProcess = {
  name: string;
  child: ChildProcessWithoutNullStreams;
  command: string;
  cwd?: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
};

type CdpResponse<T = unknown> = {
  id?: number;
  result?: T;
  error?: { message: string; data?: string };
};

type SmokeServer = {
  baseUrl: string;
  close(): Promise<void>;
  addIncomingMention(): SmokeMessage;
  completeRuntimeReply(roomId: string): SmokeMessage;
  latestMessage(roomId: string): SmokeMessage | undefined;
  sendRuntimeStatus(status: "thinking" | "failed" | "completed", message?: SmokeMessage): void;
  clientCount(): number;
  requests: string[];
  createEntryBodies: string[];
  postedBodies: string[];
  readMarks: string[];
};

export type StandaloneFrontendBrowserSmokeResult = {
  ok: true;
  command: typeof commandName;
  appUrl: string;
  runtimeOrigin: string;
  browser: string;
  verified: {
    openedStandaloneFrontend: true;
    chatEntryList: true;
    threadRoomEntry: true;
    messageSend: true;
    realtimeRefresh: true;
    unreadMentionState: true;
    memberDirectoryContact: true;
    memberDmOverview: true;
    existingDmSessionEntry: true;
    createdDmSessionEntry: true;
    noMattermostEntry: true;
  };
  evidence: {
    requests: string[];
    createEntryBodies: string[];
    postedBodies: string[];
    readMarks: string[];
    realtimeClientCount: number;
    sentMessageText: string;
    realtimeMessageText: string;
    runtimeStatusText: string;
  };
};

function json(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function participant(roomId: string, employeeId: string, displayName: string, role: string) {
  return {
    schema: "conversation-participant",
    version: 1,
    companyId,
    conversationId: roomId,
    participantId: `participant-${employeeId}`,
    participantKind: "employee",
    employeeId,
    displayName,
    role,
    joinedAt: startedAt,
  };
}

function companyMemberParticipant(roomId: string, memberId: string, displayName: string, role: string) {
  return {
    schema: "conversation-participant",
    version: 1,
    companyId,
    conversationId: roomId,
    participantId: `participant-${memberId}`,
    participantKind: "company_member",
    memberId,
    displayName,
    role,
    joinedAt: startedAt,
  };
}

function conversation(
  roomId: string,
  title: string,
  kind: "topic" | "direct",
  messages: SmokeMessage[],
  unreadCount = 1,
  mentionCount = 1,
) {
  return {
    schema: "conversation",
    version: 1,
    companyId,
    conversationId: roomId,
    title,
    conversationKind: kind,
    participants: [
      companyMemberParticipant(roomId, viewerMemberId, viewerMemberDisplayName, viewerMemberRole),
      participant(roomId, targetEmployeeId, "Nora Automation", "employee"),
    ],
    participantStates: [
      {
        schema: "conversation-participant-state",
        version: 1,
        companyId,
        conversationId: roomId,
        participantId: `participant-${viewerMemberId}`,
        memberId: viewerMemberId,
        lastReadMessageId: messages[0]?.messageId,
        lastMentionMessageId: messages.find((message) =>
          message.mentionedEmployeeIds?.includes(targetEmployeeId)
        )?.messageId,
        unreadCount,
        mentionCount,
        updatedAt: startedAt,
      },
    ],
    lastMessageId: messages.at(-1)?.messageId,
    runtimeLinks: [],
    realtimeSequence: messages.length,
    createdAt: startedAt,
    updatedAt: messages.at(-1)?.createdAt ?? startedAt,
  };
}

function dtoMessage(message: SmokeMessage) {
  const senderParticipantId = message.senderMemberId ?? message.senderEmployeeId;
  return {
    schema: "message",
    version: 1,
    companyId,
    conversationId: message.roomId,
    messageId: message.messageId,
    sender: {
      participantId: `participant-${senderParticipantId}`,
      participantKind: message.senderMemberId ? "company_member" : "employee",
      employeeId: message.senderEmployeeId,
      memberId: message.senderMemberId,
      displayName: message.senderDisplayName,
    },
    body: message.body,
    mentions: (message.mentionedEmployeeIds ?? []).map((employeeId) => ({
      schema: "message-mention",
      version: 1,
      companyId,
      conversationId: message.roomId,
      messageId: message.messageId,
      participantId: `participant-${employeeId}`,
      employeeId,
      createdAt: message.createdAt,
    })),
    attachments: [],
    runtimeLinks: message.runtimeLinks ?? [],
    createdAt: message.createdAt,
    deliveryState: "sent",
  };
}

function entryRuntimeLink(input: {
  linkId: string;
  targetKind: "session" | "work_run" | "process_trace" | "attachment";
  targetId: string;
  label: string;
  sourceMessageId?: string;
}) {
  return {
    schema: "chat-runtime-link",
    version: 1,
    companyId,
    linkId: input.linkId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    label: input.label,
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
    createdAt: startedAt,
  };
}

function realtimeEvent(
  type: "chat.message.created" | "chat.projection.changed" | "chat.read_state.updated" | "chat.runtime_status.changed",
  message?: SmokeMessage,
  runtimeStatus: "thinking" | "failed" | "completed" = "thinking",
  replyMessage?: SmokeMessage,
) {
  if (type === "chat.runtime_status.changed") {
    const roomId = message?.roomId ?? topicRoomId;
    const runId = `tinyoffice_chat:chat_room_message:${companyId}:${roomId}:${message?.messageId ?? "smoke-message-initial"}:${targetEmployeeId}`;
    return {
      schema: "tinyoffice-realtime-event",
      version: 1,
      eventId: `smoke-event-${type}-${runtimeStatus}`,
      type,
      occurredAt: new Date().toISOString(),
      sequence: Date.now(),
      companyId,
      conversationId: roomId,
      roomId,
      sourceMessageId: message?.messageId ?? "smoke-message-initial",
      targetMemberId: targetEmployeeId,
      status: runtimeStatus,
      runId,
      sessionKey: `${targetEmployeeId}|chat_${roomId === topicRoomId ? "topic" : "direct"}_room|${roomId}`,
      sessionRecordId: "runtime-session-standalone-smoke",
      ...(replyMessage ? { replyMessageId: replyMessage.messageId } : {}),
    };
  }
  return {
    schema: "tinyoffice-realtime-event",
    version: 1,
    eventId: `smoke-event-${type}-${message?.messageId ?? "read"}`,
    type,
    occurredAt: new Date().toISOString(),
    sequence: Date.now(),
    companyId,
    roomId: message?.roomId ?? topicRoomId,
    conversationId: message?.roomId ?? topicRoomId,
    messageId: message?.messageId,
    memberId: viewerMemberId,
    viewerMemberId,
    payload: {},
  };
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function createRuntimeServer(): Promise<SmokeServer> {
  const topicMessages: SmokeMessage[] = [
    {
      messageId: "smoke-message-initial",
      roomId: topicRoomId,
      body: "Xu, please review the pricing note before launch.",
      senderEmployeeId: targetEmployeeId,
      senderDisplayName: "Nora Automation",
      mentionedEmployeeIds: [targetEmployeeId],
      createdAt: startedAt,
    },
  ];
  const existingDmMessages: SmokeMessage[] = [
    {
      messageId: "smoke-message-dm-existing",
      roomId: existingDmRoomId,
      body: "Existing DM session entry stayed behind the member overview.",
      senderEmployeeId: targetEmployeeId,
      senderDisplayName: "Nora Automation",
      createdAt: new Date(Date.parse(startedAt) + 500).toISOString(),
    },
  ];
  const createdDmMessages: SmokeMessage[] = [];
  let createdDmEntry:
    | {
      schema: "chat-entry";
      version: 1;
      companyId: string;
      entryId: string;
      kind: "dm_session_entry";
      parentContainerId: string;
      title: string;
      titleStatus: "manual";
      summary: string;
      unreadCount: number;
      mentionCount: number;
      openTarget: { kind: "dm_session_entry_room"; roomId: string };
      runtimeLinks: [];
      updatedAt: string;
    }
    | undefined;
  let unreadCount = 1;
  let mentionCount = 1;
  let sequence = 1;
  const requests: string[] = [];
  const createEntryBodies: string[] = [];
  const postedBodies: string[] = [];
  const readMarks: string[] = [];
  let socketServer: SocketIOServer;
  const hub = {
    sendJson(value: unknown) {
      socketServer.emit("tinyoffice.realtime", value);
    },
    close() {
      socketServer.close();
    },
    count() {
      return socketServer.engine.clientsCount;
    },
  };

  const roomMessages = (id: string) => {
    if (id === topicRoomId) {
      return topicMessages;
    }
    if (id === existingDmRoomId) {
      return existingDmMessages;
    }
    if (id === createdDmRoomId) {
      return createdDmMessages;
    }
    return undefined;
  };

  const roomTitle = (id: string) => {
    if (id === topicRoomId) {
      return "Smoke topic";
    }
    if (id === existingDmRoomId) {
      return "Existing Nora handoff";
    }
    if (id === createdDmRoomId) {
      return createdDmEntry?.title ?? "Nora Automation: Can you inspect the smoke queue";
    }
    return "Unknown room";
  };

  const roomKind = (id: string): "topic" | "direct" => id === topicRoomId ? "topic" : "direct";

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(`${req.method ?? "GET"} ${url.pathname}${url.search}`);

    if (url.pathname === "/api/tinyoffice/session/current" && req.method === "GET") {
      json(res, 200, {
        schema: "tinyoffice-current-session",
        version: 1,
        user: { id: viewerMemberId, displayName: viewerMemberDisplayName },
        currentCompanyId: companyId,
        companyId,
        member: {
          memberId: viewerMemberId,
          displayName: viewerMemberDisplayName,
          role: viewerMemberRole,
        },
        needsInitialization: false,
      });
      return;
    }

    if (url.pathname === "/api/tinyoffice/session/current-company" && req.method === "PUT") {
      const body = JSON.parse(await readRequestBody(req)) as { companyId?: string };
      assert.equal(body.companyId, companyId);
      json(res, 200, {
        schema: "tinyoffice-current-session",
        version: 1,
        user: { id: viewerMemberId, displayName: viewerMemberDisplayName },
        currentCompanyId: companyId,
        companyId,
        member: {
          memberId: viewerMemberId,
          displayName: viewerMemberDisplayName,
          role: viewerMemberRole,
        },
        needsInitialization: false,
      });
      return;
    }

    if (url.pathname === "/api/companies" && req.method === "GET") {
      json(res, 200, {
        contract: { name: "company-lifecycle", version: 1, boundary: "company-lifecycle" },
        companies: [{ companyId, displayName: "TinyOffice", createdAt: startedAt, updatedAt: startedAt }],
      });
      return;
    }

    if (url.pathname === `/api/companies/${companyId}/chat` && req.method === "GET") {
      json(res, 200, {
        containers: [
          {
            schema: "chat-container",
            version: 1,
            companyId,
            containerId,
            kind: "channel",
            title: "smoke-channel",
            summary: "1 topic/thread entry",
            unreadCount,
            mentionCount,
            entryCount: 1,
            members: [
              {
                schema: "chat-channel-member",
                version: 1,
                companyId,
                chatChannelId,
                memberId: viewerMemberId,
                displayName: viewerMemberDisplayName,
                role: "owner",
                hasRuntimeProfile: false,
                joinedAt: startedAt,
              },
              {
                schema: "chat-channel-member",
                version: 1,
                companyId,
                chatChannelId,
                employeeId: targetEmployeeId,
                displayName: "Nora Automation",
                avatarSeed: "smoke-nora-automation",
                role: "member",
                hasRuntimeProfile: true,
                joinedAt: startedAt,
              },
            ],
            viewerRole: "owner",
            runtimeLinks: [],
          },
          {
            schema: "chat-container",
            version: 1,
            companyId,
            containerId: dmContainerId,
            kind: "member_dm",
            title: "Nora Automation",
            summary: "Runtime DM contact",
            unreadCount: 0,
            mentionCount: 0,
            entryCount: createdDmEntry ? 2 : 1,
            runtimeLinks: [],
          },
        ],
        entries: [
          {
            schema: "chat-entry",
            version: 1,
            companyId,
            entryId,
            kind: "channel_topic",
            parentContainerId: containerId,
            title: "Smoke topic",
            titleStatus: "manual",
            summary: "Margin note needs approval before launch.",
            unreadCount,
            mentionCount,
            attentionReason: mentionCount > 0 ? "mention" : unreadCount > 0 ? "unread" : undefined,
            openTarget: { kind: "topic_room", roomId: topicRoomId },
            runtimeLinks: [],
            updatedAt: new Date(Date.parse(startedAt) + sequence * 1000).toISOString(),
          },
          {
            schema: "chat-entry",
            version: 1,
            companyId,
            entryId: existingDmEntryId,
            kind: "dm_session_entry",
            parentContainerId: dmContainerId,
            title: "Existing Nora handoff",
            titleStatus: "manual",
            summary: "A previous DM session remains directly selectable.",
            unreadCount: 0,
            mentionCount: 0,
            openTarget: { kind: "dm_session_entry_room", roomId: existingDmRoomId },
            runtimeLinks: [entryRuntimeLink({
              linkId: "smoke-session-evidence-link",
              targetKind: "session",
              targetId: evidenceSessionId,
              label: evidenceSessionLabel,
            })],
            updatedAt: new Date(Date.parse(startedAt) + sequence * 1000).toISOString(),
          },
          ...(createdDmEntry ? [createdDmEntry] : []),
        ],
      });
      return;
    }

    if (url.pathname === `/api/companies/${companyId}/directory` && req.method === "GET") {
      json(res, 200, {
        schema: "company-directory",
        version: 1,
        companyId,
        directoryMembers: [
          {
            schema: "company-directory-member-entry",
            version: 1,
            companyId,
            memberId: viewerMemberId,
            selector: { kind: "member", memberId: viewerMemberId },
            displayName: viewerMemberDisplayName,
            avatarSeed: "smoke-xuziho",
            role: viewerMemberRole,
            hasRuntimeProfile: false,
          },
          {
            schema: "company-directory-member-entry",
            version: 1,
            companyId,
            memberId: targetEmployeeId,
            selector: { kind: "member", memberId: targetEmployeeId },
            displayName: "Nora Automation",
            avatarSeed: "smoke-nora-automation",
            role: "automation",
            summary: "Runtime capability: resident",
            hasRuntimeProfile: true,
            runtimeCapability: {
              presenceMode: "resident",
              model: {
                thinkingLevel: "minimal",
              },
            },
          },
        ],
      });
      return;
    }

    if (url.pathname === `/api/companies/${companyId}/chat/entries` && req.method === "POST") {
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body) as {
        companyId: string;
        containerId: string;
        actorEmployeeId?: string;
        actorMemberId?: string;
        actorDisplayName?: string;
        title?: string;
        memberDisplayNames?: Record<string, string>;
        firstMessage?: { body?: string };
      };
      assert.equal(parsed.companyId, companyId);
      assert.equal(parsed.containerId, dmContainerId);
      assert.equal(parsed.actorMemberId, viewerMemberId);
      assert.equal(parsed.actorEmployeeId, undefined);
      assert.equal(parsed.memberDisplayNames?.[targetEmployeeId], "Nora Automation");
      const firstMessageBody = parsed.firstMessage?.body?.trim();
      assert(firstMessageBody);
      createEntryBodies.push(firstMessageBody);
      const createdAt = new Date(Date.parse(startedAt) + ++sequence * 1000).toISOString();
      const title = parsed.title?.trim() || `Nora Automation: ${firstMessageBody}`;
      createdDmEntry = {
        schema: "chat-entry",
        version: 1,
        companyId,
        entryId: createdDmEntryId,
        kind: "dm_session_entry",
        parentContainerId: dmContainerId,
        title,
        titleStatus: "manual",
        summary: "Runtime-created DM session entry from the standalone Chat smoke.",
        unreadCount: 0,
        mentionCount: 0,
        openTarget: { kind: "dm_session_entry_room", roomId: createdDmRoomId },
        runtimeLinks: [],
        updatedAt: createdAt,
      };
      createdDmMessages.splice(0, createdDmMessages.length, {
        messageId: "smoke-message-dm-created",
        roomId: createdDmRoomId,
        body: firstMessageBody,
        senderMemberId: viewerMemberId,
        senderDisplayName: parsed.actorDisplayName || viewerMemberDisplayName,
        createdAt,
      });
      json(res, 201, {
        schema: "chat-create-entry-result",
        version: 1,
        companyId,
        container: {
          schema: "chat-container",
          version: 1,
          companyId,
          containerId: dmContainerId,
          kind: "member_dm",
          title: "Nora Automation",
          summary: "Runtime DM contact",
          unreadCount: 0,
          mentionCount: 0,
          entryCount: 2,
          runtimeLinks: [],
        },
        entry: createdDmEntry,
        openTarget: createdDmEntry.openTarget,
        firstMessageId: "smoke-message-dm-created",
      });
      return;
    }

    const roomMatch = url.pathname.match(new RegExp(`^/api/companies/${companyId}/chat/rooms/([^/]+)(?:/(messages|read))?$`));
    if (roomMatch && req.method === "GET" && !roomMatch[2]) {
      const id = decodeURIComponent(roomMatch[1]!);
      const messages = roomMessages(id);
      if (!messages) {
        json(res, 404, { error: "room not found" });
        return;
      }
      if (id === existingDmRoomId) {
        await delay(700);
      }
      const roomUnreadCount = id === topicRoomId ? unreadCount : 0;
      const roomMentionCount = id === topicRoomId ? mentionCount : 0;
      json(res, 200, conversation(id, roomTitle(id), roomKind(id), messages, roomUnreadCount, roomMentionCount));
      return;
    }

    if (roomMatch && roomMatch[2] === "messages" && req.method === "GET") {
      const id = decodeURIComponent(roomMatch[1]!);
      const messages = roomMessages(id);
      if (!messages) {
        json(res, 404, { error: "room not found" });
        return;
      }
      json(res, 200, { messages: messages.map(dtoMessage) });
      return;
    }

    const processTraceMatch = url.pathname.match(new RegExp(`^/api/companies/${companyId}/chat/rooms/([^/]+)/process-trace$`));
    if (processTraceMatch && req.method === "GET") {
      const id = decodeURIComponent(processTraceMatch[1]!);
      if (!roomMessages(id)) {
        json(res, 404, { error: "room not found" });
        return;
      }
      json(res, 200, { events: [] });
      return;
    }

    const activityMatch = url.pathname.match(new RegExp(`^/api/companies/${companyId}/chat/rooms/([^/]+)/activity$`));
    if (activityMatch && req.method === "GET") {
      const id = decodeURIComponent(activityMatch[1]!);
      if (!roomMessages(id)) {
        json(res, 404, { error: "room not found" });
        return;
      }
      json(res, 200, {
        items: [{
          id: "smoke-activity-run-completed",
          kind: "run_completed",
          title: "Run completed",
          details: "Worked for 7s",
          status: "succeeded",
          timestamp: new Date(Date.parse(startedAt) + sequence * 1000).toISOString(),
          raw: { eventIds: [], events: [] },
        }],
      });
      return;
    }

    if (roomMatch && roomMatch[2] === "messages" && req.method === "POST") {
      const id = decodeURIComponent(roomMatch[1]!);
      const messages = roomMessages(id);
      if (!messages) {
        json(res, 404, { error: "room not found" });
        return;
      }
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body) as { actorEmployeeId?: string; actorMemberId?: string; body: string };
      assert.equal(parsed.actorMemberId, viewerMemberId);
      assert.equal(parsed.actorEmployeeId, undefined);
      postedBodies.push(parsed.body);
      const message: SmokeMessage = {
        messageId: `smoke-message-user-${messages.length + 1}`,
        roomId: id,
        body: parsed.body,
        senderMemberId: parsed.actorMemberId,
        senderDisplayName: viewerMemberDisplayName,
        createdAt: new Date(Date.parse(startedAt) + ++sequence * 1000).toISOString(),
      };
      messages.push(message);
      unreadCount = 0;
      mentionCount = 0;
      json(res, 201, {
        conversation: conversation(id, roomTitle(id), roomKind(id), messages, unreadCount, mentionCount),
        message: dtoMessage(message),
        realtimeEvent: realtimeEvent("chat.message.created", message),
      });
      return;
    }

    if (roomMatch && roomMatch[2] === "read" && req.method === "POST") {
      const id = decodeURIComponent(roomMatch[1]!);
      const messages = roomMessages(id);
      if (!messages) {
        json(res, 404, { error: "room not found" });
        return;
      }
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body) as { viewerEmployeeId?: string; viewerMemberId?: string; lastReadMessageId?: string };
      assert.equal(parsed.viewerMemberId, viewerMemberId);
      assert.equal(parsed.viewerEmployeeId, undefined);
      readMarks.push(parsed.lastReadMessageId ?? "");
      unreadCount = 0;
      mentionCount = 0;
      json(res, 200, {
        conversation: conversation(id, roomTitle(id), roomKind(id), messages, unreadCount, mentionCount),
        realtimeEvent: realtimeEvent("chat.read_state.updated", messages.at(-1)),
      });
      return;
    }

    json(res, 404, { error: "not found" });
  });

  socketServer = new SocketIOServer(server, {
    path: "/api/realtime/socket.io",
    transports: ["websocket"],
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: async () => {
          hub.close();
          server.close();
          await once(server, "close");
        },
        addIncomingMention() {
          const message: SmokeMessage = {
            messageId: `smoke-message-realtime-${topicMessages.length + 1}`,
            roomId: topicRoomId,
            body: "Realtime owned Chat refresh reached the standalone frontend.",
            senderEmployeeId: targetEmployeeId,
            senderDisplayName: "Nora Automation",
            mentionedEmployeeIds: [targetEmployeeId],
            createdAt: new Date(Date.parse(startedAt) + ++sequence * 1000).toISOString(),
          };
          topicMessages.push(message);
          unreadCount = 1;
          mentionCount = 1;
          hub.sendJson(realtimeEvent("chat.message.created", message));
          hub.sendJson(realtimeEvent("chat.projection.changed", message));
          return message;
        },
        completeRuntimeReply(roomId) {
          const messages = roomMessages(roomId);
          assert(messages, `expected messages for ${roomId}`);
          const sourceMessage = messages.at(-1);
          assert(sourceMessage, `expected source message for ${roomId}`);
          const reply: SmokeMessage = {
            messageId: `smoke-message-runtime-reply-${messages.length + 1}`,
            roomId,
            body: "Nora completed the smoke queue inspection.",
            senderEmployeeId: targetEmployeeId,
            senderDisplayName: "Nora Automation",
            runtimeLinks: [
              entryRuntimeLink({
                linkId: "smoke-runtime-reply-session-link",
                targetKind: "session",
                targetId: "runtime-session-standalone-smoke",
                label: "Owned Chat employee reply",
              }),
              entryRuntimeLink({
                linkId: "smoke-runtime-reply-process-trace-link",
                targetKind: "process_trace",
                targetId: "tinyoffice-chat-process:standalone-smoke",
                label: "Worked for 7s",
                sourceMessageId: sourceMessage.messageId,
              }),
            ],
            createdAt: new Date(Date.parse(startedAt) + ++sequence * 1000).toISOString(),
          };
          messages.push(reply);
          hub.sendJson(realtimeEvent("chat.message.created", reply));
          hub.sendJson(realtimeEvent("chat.runtime_status.changed", sourceMessage, "completed", reply));
          return reply;
        },
        latestMessage(roomId) {
          return roomMessages(roomId)?.at(-1);
        },
        sendRuntimeStatus(status, message) {
          hub.sendJson(realtimeEvent("chat.runtime_status.changed", message ?? topicMessages.at(-1), status));
        },
        clientCount() {
          return hub.count();
        },
        requests,
        createEntryBodies,
        postedBodies,
        readMarks,
      });
    });
  });
}

function findBrowser(): BrowserChoice {
  const candidates: BrowserChoice[] = [
    {
      name: "Microsoft Edge",
      executablePath: path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
    },
    {
      name: "Microsoft Edge",
      executablePath: path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    },
    {
      name: "Google Chrome",
      executablePath: path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    },
    {
      name: "Google Chrome",
      executablePath: path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    },
  ];
  const found = candidates.find((candidate) => existsSync(candidate.executablePath));
  if (!found) {
    throw new Error("Standalone frontend browser smoke requires Microsoft Edge or Google Chrome on this machine.");
  }
  return found;
}

async function freePort(): Promise<number> {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

function trimCapturedOutput(value: string): string {
  if (value.length <= maxCapturedProcessOutputLength) {
    return value;
  }
  return value.slice(value.length - maxCapturedProcessOutputLength);
}

function captureProcess(
  name: string,
  child: ChildProcessWithoutNullStreams,
  input: { command: string; cwd?: string },
): CapturedProcess {
  const captured: CapturedProcess = {
    name,
    child,
    command: input.command,
    cwd: input.cwd,
    stdout: "",
    stderr: "",
    exitCode: null,
    signalCode: null,
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    captured.stdout = trimCapturedOutput(`${captured.stdout}${chunk}`);
  });
  child.stderr.on("data", (chunk: string) => {
    captured.stderr = trimCapturedOutput(`${captured.stderr}${chunk}`);
  });
  child.on("exit", (code, signal) => {
    captured.exitCode = code;
    captured.signalCode = signal;
  });

  return captured;
}

function capturedProcessDiagnostics(process: CapturedProcess): string {
  const exitCode = process.child.exitCode ?? process.exitCode;
  const signalCode = process.child.signalCode ?? process.signalCode;
  return [
    `${process.name} command: ${process.command}`,
    `${process.name} cwd: ${process.cwd ?? "<not set>"}`,
    `${process.name} exitCode: ${exitCode === null ? "<running>" : exitCode}`,
    `${process.name} signalCode: ${signalCode === null ? "<none>" : signalCode}`,
    `${process.name} stdout:\n${process.stdout.trim() || "<empty>"}`,
    `${process.name} stderr:\n${process.stderr.trim() || "<empty>"}`,
  ].join("\n");
}

async function waitForHttp(
  url: string,
  options: {
    timeoutMs?: number;
    label?: string;
    diagnostics?: () => string;
    shouldAbort?: () => boolean;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (options.shouldAbort?.()) {
      throw new Error(
        `${options.label ?? url} stopped before it became reachable at ${url}.\n` +
        `Last error: ${lastError instanceof Error ? lastError.message : String(lastError ?? "none")}\n\n` +
        `${options.diagnostics?.() ?? ""}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Timed out waiting ${timeoutMs}ms for ${options.label ?? url} at ${url}: ` +
    `${lastError instanceof Error ? lastError.message : String(lastError)}\n\n` +
    `${options.diagnostics?.() ?? ""}`,
  );
}

function spawnVite(runtimeOrigin: string, port: number): CapturedProcess {
  const cwd = path.join(process.cwd(), ...standaloneAppPath.split("/"));
  const args = [
    path.join("node_modules", "vite", "bin", "vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ];
  const child = spawn(
    process.execPath,
    args,
    {
      cwd,
      env: {
        ...process.env,
        TINYOFFICE_RUNTIME_ORIGIN: runtimeOrigin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return captureProcess("Vite", child, {
    command: `${process.execPath} ${args.join(" ")}`,
    cwd,
  });
}

function spawnBrowser(browser: BrowserChoice, debuggingPort: number, userDataDir: string): CapturedProcess {
  const args = [
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--window-size=1440,900",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];
  const child = spawn(
    browser.executablePath,
    args,
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return captureProcess("Browser", child, {
    command: `${browser.executablePath} ${args.join(" ")}`,
  });
}

async function createCdpPage(debuggingPort: number, url: string): Promise<CdpClient> {
  const target = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  assert.equal(target.ok, true);
  const targetJson = await target.json() as { webSocketDebuggerUrl: string };
  return CdpClient.connect(targetJson.webSocketDebuggerUrl);
}

class CdpClient {
  private nextId = 1;
  private runtimeDiagnostics: string[] = [];
  private pending = new Map<number, {
    resolve(value: CdpResponse): void;
    reject(error: Error): void;
  }>();

  private constructor(private readonly socket: globalThis.WebSocket) {}

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    const client = new CdpClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP websocket failed to open")), { once: true });
    });
    socket.addEventListener("message", (event) => client.onMessage(String(event.data)));
    return client;
  }

  async send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    const promise = new Promise<CdpResponse<T>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: CdpResponse) => void, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    const response = await promise;
    if (response.error) {
      throw new Error(`${method} failed: ${response.error.message}${response.error.data ? ` ${response.error.data}` : ""}`);
    }
    return response.result as T;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{
      result: { value?: T };
      exceptionDetails?: { text: string };
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text);
    }
    return result.result.value as T;
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) {
      return;
    }
    const closed = new Promise<void>((resolve) => {
      this.socket.addEventListener("close", () => resolve(), { once: true });
    });
    this.socket.close();
    await Promise.race([closed, delay(1_000)]);
  }

  diagnostics(): string {
    return this.runtimeDiagnostics.slice(-10).join("\n");
  }

  private onMessage(data: string): void {
    const message = JSON.parse(data) as CdpResponse & { method?: string; params?: Record<string, unknown> };
    if (!message.id) {
      if (message.method === "Runtime.exceptionThrown" || message.method === "Runtime.consoleAPICalled") {
        this.runtimeDiagnostics.push(`${message.method}: ${JSON.stringify(message.params)}`);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    pending.resolve(message);
  }
}

async function waitForPageText(cdp: CdpClient, text: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hasText = await cdp.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(text)})`);
    if (hasText) {
      return;
    }
    await delay(200);
  }
  const body = await cdp.evaluate<string>("document.body.innerText");
  const href = await cdp.evaluate<string>("window.location.href");
  throw new Error(`Timed out waiting for page text ${JSON.stringify(text)} at ${href}. Body was:\n${body}\nRuntime diagnostics:\n${cdp.diagnostics()}`);
}

async function assertPageTextAbsent(cdp: CdpClient, text: string): Promise<void> {
  const body = await cdp.evaluate<string>("document.body.innerText");
  assert.doesNotMatch(body, literalTextRegExp(text));
}

function literalTextRegExp(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

type ShellDomSnapshot = {
  href: string;
  bodyText: string;
  productRailText: string;
  chatListText: string;
  primaryText: string;
  contextText: string;
  hasChatList: boolean;
  hasPrimarySurface: boolean;
  hasContextPanel: boolean;
  hasWireframeHeader: boolean;
  workbenchGap: string;
  chatListBorderRadius: string;
  primaryBorderRadius: string;
  contextBorderRadius: string;
  roomBorderRightWidth: string;
  runtimeEvidenceLabelWhiteSpace: string | null;
  runtimeEvidenceLabelTextOverflow: string | null;
  runtimeEvidenceMetaWhiteSpace: string | null;
  runtimeEvidenceMetaTextOverflow: string | null;
};

async function readShellDomSnapshot(cdp: CdpClient): Promise<ShellDomSnapshot> {
  return cdp.evaluate<ShellDomSnapshot>(`
    (() => {
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? "";
      const style = (selector) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element) : undefined;
      };
      const workbenchStyle = style("[data-tiny-chat-workbench]");
      const chatListStyle = style("[data-tiny-chat-sidebar-pane]");
      const primaryStyle = style("[data-tiny-chat-primary-pane]");
      const contextStyle = style("[data-tiny-chat-context-pane]");
      const evidenceLabelStyle = style(".tiny-runtime-work-title");
      const evidenceMetaStyle = style(".tiny-runtime-work-meta");
      return {
        href: window.location.href,
        bodyText: document.body.innerText,
        productRailText: text('[aria-label="TinyOffice"]'),
        chatListText: text('[data-tiny-chat-sidebar-pane]'),
        primaryText: text('[data-tiny-chat-primary-pane]'),
        contextText: text('[data-tiny-chat-context-pane]'),
        hasChatList: Boolean(document.querySelector('[data-tiny-chat-sidebar-pane]')),
        hasPrimarySurface: Boolean(document.querySelector('[data-tiny-chat-primary-pane]')),
        hasContextPanel: Boolean(document.querySelector('[data-tiny-chat-context-pane]')),
        hasWireframeHeader: Boolean(document.querySelector('.wireframe-header')),
        workbenchGap: workbenchStyle?.gap ?? "",
        chatListBorderRadius: chatListStyle?.borderRadius ?? "",
        primaryBorderRadius: primaryStyle?.borderRadius ?? "",
        contextBorderRadius: contextStyle?.borderRadius ?? "",
        roomBorderRightWidth: primaryStyle?.borderRightWidth ?? "",
        runtimeEvidenceLabelWhiteSpace: evidenceLabelStyle?.whiteSpace ?? null,
        runtimeEvidenceLabelTextOverflow: evidenceLabelStyle?.textOverflow ?? null,
        runtimeEvidenceMetaWhiteSpace: evidenceMetaStyle?.whiteSpace ?? null,
        runtimeEvidenceMetaTextOverflow: evidenceMetaStyle?.textOverflow ?? null,
      };
    })()
  `);
}

function assertChatSurfaceTextAbsent(snapshot: ShellDomSnapshot, text: string, surfaceLabel: string): void {
  const pattern = literalTextRegExp(text);
  assert.doesNotMatch(
    snapshot.primaryText,
    pattern,
    `${surfaceLabel} primary Chat surface must not contain ${JSON.stringify(text)}`,
  );
  assert.doesNotMatch(
    snapshot.contextText,
    pattern,
    `${surfaceLabel} Context panel must not contain ${JSON.stringify(text)}`,
  );
}

async function clickButtonContaining(cdp: CdpClient, text: string): Promise<void> {
  const clicked = await cdp.evaluate<boolean>(`
    (() => {
      const controls = [...document.querySelectorAll("button, a, [role=button]")];
      const control = controls.find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)}));
      if (!control) return false;
      control.click();
      return true;
    })()
  `);
  assert.equal(clicked, true, `expected an interactive control containing ${text}`);
}

async function clickButtonNamed(cdp: CdpClient, name: string): Promise<void> {
  const clicked = await cdp.evaluate<boolean>(`
    (() => {
      const buttons = [...document.querySelectorAll("button")];
      const button = buttons.find((candidate) =>
        candidate.textContent?.includes(${JSON.stringify(name)}) ||
        candidate.getAttribute("aria-label")?.includes(${JSON.stringify(name)}) ||
        candidate.getAttribute("title")?.includes(${JSON.stringify(name)})
      );
      if (!button) return false;
      button.click();
      return true;
    })()
  `);
  assert.equal(clicked, true, `expected a button named ${name}`);
}

async function clickButtonContainingWithin(cdp: CdpClient, label: string, text: string): Promise<void> {
  const clicked = await cdp.evaluate<boolean>(`
    (() => {
      const details = [...document.querySelectorAll("details")].find((candidate) =>
        candidate.querySelector("summary")?.textContent?.includes(${JSON.stringify(label)})
      );
      const labelledRegion = [...document.querySelectorAll("[aria-label]")].find((candidate) =>
        candidate.getAttribute("aria-label")?.includes(${JSON.stringify(label)})
      );
      const region = details ?? labelledRegion;
      if (!region) return false;
      const buttons = [...region.querySelectorAll("button")];
      const button = buttons.find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)}));
      if (!button) return false;
      button.click();
      return true;
    })()
  `);
  assert.equal(clicked, true, `expected a button containing ${text} within ${label}`);
}

async function submitReplyComposer(cdp: CdpClient, placeholder: string, text: string): Promise<void> {
  const submitted = await cdp.evaluate<boolean>(`
    (() => {
      const textarea = [...document.querySelectorAll("textarea")].find((candidate) => candidate.placeholder?.includes(${JSON.stringify(placeholder)}));
      if (!textarea) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, ${JSON.stringify(text)});
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      const form = textarea.closest("form");
      const button = form?.querySelector('button[type="submit"]');
      button?.click();
      return Boolean(button);
    })()
  `);
  assert.equal(submitted, true, `expected the reply composer ${placeholder} to submit`);
}

async function submitComposer(cdp: CdpClient, text: string): Promise<void> {
  await submitReplyComposer(cdp, "Type a message", text);
}

async function submitStarterComposer(cdp: CdpClient, label: string, text: string): Promise<void> {
  const submitted = await cdp.evaluate<boolean>(`
    (() => {
      const textarea = document.querySelector(".tiny-composer textarea");
      if (!textarea) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, ${JSON.stringify(text)});
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      const button = textarea.closest("form")?.querySelector('button[type="submit"]');
      button?.click();
      return Boolean(button);
    })()
  `);
  assert.equal(submitted, true, `expected starter composer ${label} to submit`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  await Promise.race([
    once(child, "exit"),
    delay(3_000),
  ]);
}

export async function runStandaloneFrontendBrowserSmoke(): Promise<StandaloneFrontendBrowserSmokeResult> {
  const runtimeServer = await createRuntimeServer();
  const vitePort = await freePort();
  const browserPort = await freePort();
  const browserProfile = await mkdtemp(path.join(tmpdir(), "tinyoffice-web-smoke-"));
  const browser = findBrowser();
  let vite: CapturedProcess | undefined;
  let browserProcess: CapturedProcess | undefined;
  let cdp: CdpClient | undefined;

  try {
    const appUrl = `http://127.0.0.1:${vitePort}/?companyId=${companyId}&memberId=${viewerMemberId}&memberDisplayName=${encodeURIComponent(viewerMemberDisplayName)}&memberRole=${viewerMemberRole}`;
    vite = spawnVite(runtimeServer.baseUrl, vitePort);
    browserProcess = spawnBrowser(browser, browserPort, browserProfile);
    await waitForHttp(`http://127.0.0.1:${vitePort}/`, {
      timeoutMs: startupTimeoutMs,
      label: "Vite dev server",
      diagnostics: () => capturedProcessDiagnostics(vite!),
      shouldAbort: () => Boolean(vite && (vite.child.exitCode !== null || vite.child.signalCode !== null)),
    });
    await waitForHttp(`http://127.0.0.1:${browserPort}/json/version`, {
      timeoutMs: startupTimeoutMs,
      label: `${browser.name} CDP endpoint`,
      diagnostics: () => capturedProcessDiagnostics(browserProcess!),
      shouldAbort: () => Boolean(browserProcess && (browserProcess.child.exitCode !== null || browserProcess.child.signalCode !== null)),
    });
    cdp = await createCdpPage(browserPort, appUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForPageText(cdp, "smoke-channel");
    await waitForPageText(cdp, "Xu Ziho");
    await waitForPageText(cdp, "Smoke topic");
    await waitForPageText(cdp, "Direct messages");
    await waitForPageText(cdp, "Nora Automation");
    await clickButtonContaining(cdp, "Nora Automation");
    await waitForPageText(cdp, "Existing Nora handoff");
    const dmMemberOverview = await readShellDomSnapshot(cdp);
    assert.doesNotMatch(
      dmMemberOverview.productRailText,
      /Members/,
      "retired Members rail module must not return to the product rail",
    );
    assertChatSurfaceTextAbsent(dmMemberOverview, "Members", "DM member overview");
    assertChatSurfaceTextAbsent(dmMemberOverview, "Participants", "DM member overview");
    await waitForPageText(cdp, "Existing Nora handoff");
    await waitForPageText(cdp, "Start new topic with Nora Automation");
    const beforeExistingDmOpen = await readShellDomSnapshot(cdp);
    await clickButtonContaining(cdp, "Existing Nora handoff");
    await delay(100);
    const duringExistingDmOpen = await readShellDomSnapshot(cdp);
    assert.notEqual(duringExistingDmOpen.href, beforeExistingDmOpen.href, "opening an existing DM session entry must write its canonical room URL");
    assert.match(duringExistingDmOpen.href, /\/chat\?roomId=smoke-room-dm-nora-existing&surface=direct$/);
    await waitForPageText(cdp, "DM session entry");
    await waitForPageText(cdp, "Existing DM session entry stayed behind the member overview.");
    await assertPageTextAbsent(cdp, "Company Directory");
    await waitForPageText(cdp, "Find session");
    const workspaceVisual = await readShellDomSnapshot(cdp);
    assert.match(workspaceVisual.primaryText, /Existing DM session entry stayed behind the member overview\./);
    assert.match(workspaceVisual.contextText, /Runtime capability: resident/);
    assert.doesNotMatch(workspaceVisual.primaryText, /Participants:\s*2|DM chat|Enter to send|Shift\+Enter/);
    assert.doesNotMatch(workspaceVisual.contextText, literalTextRegExp(evidenceSessionLabel));
    assert.doesNotMatch(workspaceVisual.contextText, /Type|DM chat|Participants|Loaded messages|Delivery|Sessions|Trace/);
    assert.equal(workspaceVisual.hasWireframeHeader, false, "top development/status strip must not occupy the Chat workspace");
    assert.ok(["normal", "0px"].includes(workspaceVisual.workbenchGap), "Chat workbench panes should share continuous split-pane boundaries");
    assert.equal(workspaceVisual.chatListBorderRadius, "0px", "left Chat list should not render as a floating card");
    assert.equal(workspaceVisual.primaryBorderRadius, "0px", "center room surface should not render as a floating card");
    assert.equal(workspaceVisual.contextBorderRadius, "0px", "Context aside should not render as a floating card");
    assert.equal(workspaceVisual.runtimeEvidenceLabelWhiteSpace, null, "DM Context should not render repeated Session or Trace cards by default");
    assert.equal(workspaceVisual.runtimeEvidenceLabelTextOverflow, null, "DM Context should not render repeated Session or Trace cards by default");
    assert.equal(workspaceVisual.runtimeEvidenceMetaWhiteSpace, null, "DM Context should not render repeated Session or Trace cards by default");
    assert.equal(workspaceVisual.runtimeEvidenceMetaTextOverflow, null, "DM Context should not render repeated Session or Trace cards by default");
    const dmRuntimeText = "Can you inspect the folded trace transition?";
    await submitReplyComposer(cdp, "Type a message", dmRuntimeText);
    await waitForPageText(cdp, dmRuntimeText);
    const dmSourceMessage = runtimeServer.latestMessage(existingDmRoomId);
    assert(dmSourceMessage);
    runtimeServer.sendRuntimeStatus("thinking", dmSourceMessage);
    const dmRuntimeReply = runtimeServer.completeRuntimeReply(existingDmRoomId);
    await waitForPageText(cdp, dmRuntimeReply.body);
    await waitForPageText(cdp, "Run completed");
    await assertPageTextAbsent(cdp, "Loading room messages...");
    const afterDmRuntimeComplete = await readShellDomSnapshot(cdp);
    assert.match(afterDmRuntimeComplete.contextText, /Run completed/);
    assert.doesNotMatch(afterDmRuntimeComplete.contextText, /Trace|runtime-session-standalone-smoke/);
    await clickButtonNamed(cdp, "Back");
    await waitForPageText(cdp, "Existing Nora handoff");
    await clickButtonContaining(cdp, "Existing Nora handoff");
    await delay(50);
    const cachedExistingDmOpen = await readShellDomSnapshot(cdp);
    assert.match(cachedExistingDmOpen.href, /\/chat\?roomId=smoke-room-dm-nora-existing&surface=direct$/);
    assert.match(cachedExistingDmOpen.primaryText, /Existing DM session entry stayed behind the member overview\./);
    assert.doesNotMatch(cachedExistingDmOpen.bodyText, /Chat could not load|No conversations yet|Loading room messages/);
    await clickButtonNamed(cdp, "Back");
    await waitForPageText(cdp, "Existing Nora handoff");
    const startedDmText = "Can you inspect the smoke queue?";
    await clickButtonContaining(cdp, "Start new topic with Nora Automation");
    await submitStarterComposer(cdp, "First message for a chat with Nora Automation", startedDmText);
    await waitForPageText(cdp, "Nora Automation: Can you inspect the smoke queue");
    await waitForPageText(cdp, startedDmText);
    assert(runtimeServer.createEntryBodies.includes(startedDmText));

    await clickButtonContaining(cdp, "smoke-channel");
    await clickButtonContaining(cdp, "Smoke topic");
    await waitForPageText(cdp, "Xu, please review the pricing note before launch.");

    const sentMessageText = "Browser smoke says the standalone frontend can send through TinyOffice Chat.";
    await submitComposer(cdp, sentMessageText);
    await waitForPageText(cdp, sentMessageText);
    assert(runtimeServer.postedBodies.includes(sentMessageText));
    assert(runtimeServer.readMarks.length > 0);

    const deadline = Date.now() + 5_000;
    while (runtimeServer.clientCount() === 0 && Date.now() < deadline) {
      await delay(100);
    }
    assert.ok(runtimeServer.clientCount() > 0, "expected standalone frontend to subscribe to TinyOffice realtime Socket.IO");
    runtimeServer.sendRuntimeStatus("thinking");
    await waitForPageText(cdp, "Replying...");
    const incoming = runtimeServer.addIncomingMention();
    await waitForPageText(cdp, incoming.body);

    const body = await cdp.evaluate<string>("document.body.innerText");
    assert.doesNotMatch(appUrl, /actorEmployeeId/);
    assert.doesNotMatch(body, /Actor bridge|Employee API/);
    assert.doesNotMatch(body, /8065|registry\.registerRootComponent|packages\/tinyoffice-mattermost-plugin\/webapp/);
    assert.ok(runtimeServer.requests.some((request) => request.includes(`/api/companies/${companyId}/chat`)));
    assert.ok(runtimeServer.requests.some((request) => request.includes(`viewerMemberId=${viewerMemberId}`)));
    assert.ok(runtimeServer.requests.every((request) => !request.includes("viewerEmployeeId=iris-growth")));
    assert.ok(runtimeServer.requests.some((request) => request.includes(`/api/companies/${companyId}/chat/rooms/${topicRoomId}`)));
    assert.ok(runtimeServer.requests.some((request) => request.includes(`/api/companies/${companyId}/chat/rooms/${existingDmRoomId}`)));
    assert.ok(runtimeServer.requests.some((request) => request.includes(`/api/companies/${companyId}/chat/entries`)));

    return {
      ok: true,
      command: commandName,
      appUrl,
      runtimeOrigin: runtimeServer.baseUrl,
      browser: browser.name,
      verified: {
        openedStandaloneFrontend: true,
        chatEntryList: true,
        threadRoomEntry: true,
        messageSend: true,
        realtimeRefresh: true,
        unreadMentionState: true,
        memberDirectoryContact: true,
        memberDmOverview: true,
        existingDmSessionEntry: true,
        createdDmSessionEntry: true,
        noMattermostEntry: true,
      },
      evidence: {
        requests: runtimeServer.requests,
        createEntryBodies: runtimeServer.createEntryBodies,
        postedBodies: runtimeServer.postedBodies,
        readMarks: runtimeServer.readMarks,
        realtimeClientCount: runtimeServer.clientCount(),
        sentMessageText,
        realtimeMessageText: incoming.body,
        runtimeStatusText: "Replying...",
      },
    };
  } finally {
    await cdp?.close();
    if (browserProcess) {
      await stopProcess(browserProcess.child);
    }
    if (vite) {
      await stopProcess(vite.child);
    }
    await runtimeServer.close();
    await rm(browserProfile, { recursive: true, force: true });
  }
}

const invokedAsScript = process.argv.some((arg) =>
  pathToFileURL(path.resolve(arg)).href === import.meta.url ||
  arg.replace(/\\/g, "/").endsWith("scripts/runtime/smoke-standalone-frontend-browser.ts")
);

if (invokedAsScript) {
  runStandaloneFrontendBrowserSmoke()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
