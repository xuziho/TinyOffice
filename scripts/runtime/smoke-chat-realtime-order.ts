import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import type { TinyOfficeRealtimeEvent } from "../../src/collaboration/contracts/tinyoffice-realtime-contract.js";

const commandName = "npm run smoke:chat-realtime-order";
const runtimeOrigin = process.env.TINYOFFICE_RUNTIME_ORIGIN || "http://127.0.0.1:8095";
const targetMemberId = process.env.TINYOFFICE_SMOKE_TARGET_MEMBER_ID || "alex";
const timeoutMs = Number(process.env.TINYOFFICE_SMOKE_TIMEOUT_MS || 90_000);
const socketIoPath = "/api/realtime/socket.io";
const socketEventName = "tinyoffice.realtime";

type SocketIoClient = {
  io: (origin: string, options: {
    path: string;
    query: Record<string, string>;
    transports: string[];
  }) => {
    on(eventName: string, handler: (...args: unknown[]) => void): void;
    once(eventName: string, handler: (...args: unknown[]) => void): void;
    disconnect(): void;
  };
};

type CurrentSession = {
  currentCompanyId?: string;
  member?: {
    memberId?: string;
    displayName?: string;
  };
};

type ChatProjection = {
  containers: Array<{
    containerId: string;
    kind: string;
    title: string;
  }>;
  entries?: unknown[];
};

type CreateEntryResponse = {
  companyId: string;
  entry: {
    entryId: string;
    title: string;
  };
  openTarget: {
    roomId: string;
  };
  firstMessageId: string;
};

type SmokeResult = {
  ok: true;
  command: typeof commandName;
  runtimeOrigin: string;
  companyId: string;
  viewerMemberId: string;
  targetMemberId: string;
  entryId: string;
  roomId: string;
  firstMessageId: string;
  firstProcessTraceIndex: number;
  firstVisibleReplyIndex: number;
  firstProcessTraceAt: string;
  firstVisibleReplyAt: string;
  eventTypes: TinyOfficeRealtimeEvent["type"][];
};

type RealtimeMonitor = {
  events: TinyOfficeRealtimeEvent[];
  close(): void;
};

function socketIoClient(): SocketIoClient {
  const requireFromShadcn = createRequire(path.resolve("apps/tinyoffice-web-shadcn/package.json"));
  return requireFromShadcn("socket.io-client") as SocketIoClient;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method || "GET"} ${url} failed with ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) as T : undefined as T;
}

async function currentSession(): Promise<CurrentSession> {
  return requestJson<CurrentSession>(`${runtimeOrigin}/api/tinyoffice/session/current`);
}

async function chatProjection(companyId: string, viewerMemberId: string): Promise<ChatProjection> {
  const query = new URLSearchParams({ viewerMemberId });
  return requestJson<ChatProjection>(`${runtimeOrigin}/api/companies/${encodeURIComponent(companyId)}/chat?${query}`);
}

function directMessageContainerFor(projection: ChatProjection, memberId: string) {
  const expectedContainerId = `chat-container-member-dm-${memberId}`;
  return projection.containers.find((container) =>
    container.kind === "member_dm" &&
    container.containerId === expectedContainerId
  );
}

async function createSmokeEntry(input: {
  companyId: string;
  containerId: string;
  viewerMemberId: string;
  viewerDisplayName: string;
  targetMemberId: string;
  targetDisplayName: string;
}): Promise<CreateEntryResponse> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return requestJson<CreateEntryResponse>(`${runtimeOrigin}/api/companies/${encodeURIComponent(input.companyId)}/chat/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId: input.companyId,
      containerId: input.containerId,
      actorMemberId: input.viewerMemberId,
      actorDisplayName: input.viewerDisplayName,
      title: `Smoke realtime order ${stamp}`,
      memberDisplayNames: {
        [input.viewerMemberId]: input.viewerDisplayName,
        [input.targetMemberId]: input.targetDisplayName,
      },
      firstMessage: {
        body: `Smoke realtime order ${stamp}. Please reply with a short confirmation.`,
      },
    }),
  });
}

function eventBelongsToRun(event: TinyOfficeRealtimeEvent, created: CreateEntryResponse): boolean {
  if (!("roomId" in event) || event.roomId !== created.openTarget.roomId) {
    return false;
  }
  if ("sourceMessageId" in event) {
    return event.sourceMessageId === created.firstMessageId;
  }
  if ("messageId" in event) {
    return event.messageId === created.firstMessageId;
  }
  return true;
}

function firstIndex(events: TinyOfficeRealtimeEvent[], predicate: (event: TinyOfficeRealtimeEvent) => boolean): number {
  return events.findIndex(predicate);
}

async function openRealtimeMonitor(input: {
  companyId: string;
  viewerMemberId: string;
}): Promise<RealtimeMonitor> {
  const { io } = socketIoClient();
  const events: TinyOfficeRealtimeEvent[] = [];
  const socket = io(runtimeOrigin, {
    path: socketIoPath,
    query: {
      companyId: input.companyId,
      viewerMemberId: input.viewerMemberId,
    },
    transports: ["websocket"],
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket.io connection timed out")), 10_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  socket.on(socketEventName, (event: unknown) => {
    if (!event || typeof event !== "object") {
      return;
    }
    const realtimeEvent = event as TinyOfficeRealtimeEvent;
    if (realtimeEvent.companyId === input.companyId) {
      events.push(realtimeEvent);
    }
  });

  return {
    events,
    close() {
      socket.disconnect();
    },
  };
}

async function waitForRealtimeOrder(input: {
  created: CreateEntryResponse;
  monitor: RealtimeMonitor;
}): Promise<Pick<SmokeResult, "firstProcessTraceIndex" | "firstVisibleReplyIndex" | "firstProcessTraceAt" | "firstVisibleReplyAt" | "eventTypes">> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runEvents = input.monitor.events.filter((event) => eventBelongsToRun(event, input.created));
    const firstProcessTraceIndex = firstIndex(runEvents, (event) => event.type === "chat.process_trace.appended");
    const firstVisibleReplyIndex = firstIndex(runEvents, (event) =>
      event.type === "chat.reply.delta" || event.type === "chat.reply.snapshot"
    );
    if (firstProcessTraceIndex >= 0 && firstVisibleReplyIndex >= 0) {
      const firstTrace = runEvents[firstProcessTraceIndex];
      const firstReply = runEvents[firstVisibleReplyIndex];
      assert(firstTrace);
      assert(firstReply);
      assert.ok(
        firstProcessTraceIndex < firstVisibleReplyIndex,
        `expected first process trace before first visible reply, got ${runEvents.map((event) => event.type).join(", ")}`,
      );
      return {
        firstProcessTraceIndex,
        firstVisibleReplyIndex,
        firstProcessTraceAt: firstTrace.occurredAt,
        firstVisibleReplyAt: firstReply.occurredAt,
        eventTypes: runEvents.map((event) => event.type),
      };
    }
    await delay(250);
  }
  throw new Error(`timed out waiting for trace and reply events. Seen: ${input.monitor.events.map((event) => event.type).join(", ") || "(none)"}`);
}

export async function runChatRealtimeOrderSmoke(): Promise<SmokeResult> {
  await requestJson(`${runtimeOrigin}/health`);
  const session = await currentSession();
  const companyId = session.currentCompanyId?.trim();
  const viewerMemberId = session.member?.memberId?.trim();
  const viewerDisplayName = session.member?.displayName?.trim();
  assert(companyId, "current session companyId is required");
  assert(viewerMemberId, "current session memberId is required");
  assert(viewerDisplayName, "current session displayName is required");

  const projection = await chatProjection(companyId, viewerMemberId);
  const directMessageContainer = directMessageContainerFor(projection, targetMemberId);
  assert(
    directMessageContainer,
    `target member DM container not found for ${targetMemberId}; set TINYOFFICE_SMOKE_TARGET_MEMBER_ID`,
  );
  const targetDisplayName = directMessageContainer.title;
  const monitor = await openRealtimeMonitor({ companyId, viewerMemberId });
  let created: CreateEntryResponse | undefined;
  try {
    created = await createSmokeEntry({
      companyId,
      containerId: directMessageContainer.containerId,
      viewerMemberId,
      viewerDisplayName,
      targetMemberId,
      targetDisplayName,
    });
    const order = await waitForRealtimeOrder({ created, monitor });

    return {
      ok: true,
      command: commandName,
      runtimeOrigin,
      companyId,
      viewerMemberId,
      targetMemberId,
      entryId: created.entry.entryId,
      roomId: created.openTarget.roomId,
      firstMessageId: created.firstMessageId,
      ...order,
    };
  } finally {
    monitor.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runChatRealtimeOrderSmoke()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
