import { randomUUID } from "node:crypto";

import { assertNoForbiddenPublicCarrierFields } from "./conversation-message-contract.js";
import type { ProcessTraceEvent } from "../../runtime/contracts/process-trace-event.js";

export const TINYOFFICE_REALTIME_EVENT_SCHEMA = "tinyoffice-realtime-event";
export const TINYOFFICE_REALTIME_EVENT_VERSION = 1;

export const PUBLIC_TINYOFFICE_REALTIME_EVENT_KEY_SETS = {
  envelope: [
    "schema",
    "version",
    "eventId",
    "occurredAt",
    "sequence",
    "type",
    "companyId",
  ],
  chatEntryCreated: [
    "containerId",
    "entryId",
    "roomId",
  ],
  chatMessageCreated: [
    "conversationId",
    "roomId",
    "messageId",
  ],
  chatReadStateUpdated: [
    "roomId",
    "memberId",
  ],
  chatProjectionChanged: [
    "viewerMemberId",
  ],
  companyDirectoryChanged: [],
  chatRuntimeStatusChanged: [
    "conversationId",
    "roomId",
    "sourceMessageId",
    "targetMemberId",
    "status",
    "runId",
    "chainId",
    "sessionKey",
    "sessionRecordId",
    "runtimeProviderId",
    "replyMessageId",
    "errorMessage",
  ],
  chatProcessTraceAppended: [
    "conversationId",
    "roomId",
    "runId",
    "chainId",
    "sourceMessageId",
    "targetMemberId",
    "sessionKey",
    "replyMessageId",
    "processTraceEvent",
  ],
  chatReplyDelta: [
    "conversationId",
    "roomId",
    "runId",
    "chainId",
    "sourceMessageId",
    "targetMemberId",
    "sessionKey",
    "delta",
    "sequenceInRun",
  ],
  chatReplySnapshot: [
    "conversationId",
    "roomId",
    "runId",
    "chainId",
    "sourceMessageId",
    "targetMemberId",
    "sessionKey",
    "content",
    "sequenceInRun",
  ],
  accessRequestChanged: [
    "approvalId",
    "status",
    "contextKind",
    "contextId",
  ],
  workRunChanged: [
    "workRunId",
    "workTaskId",
    "employeeId",
    "status",
  ],
  workTaskChanged: [
    "workTaskId",
    "employeeId",
    "status",
  ],
  sessionChanged: [
    "sessionId",
    "employeeId",
    "sessionKey",
    "status",
  ],
  processTraceChanged: [
    "processTraceId",
    "employeeId",
    "sessionKey",
  ],
} as const;

export type ChatEntryCreatedEvent = {
  type: "chat.entry.created";
  companyId: string;
  containerId: string;
  entryId: string;
  roomId: string;
};

export type ChatMessageCreatedEvent = {
  type: "chat.message.created";
  companyId: string;
  conversationId: string;
  roomId: string;
  messageId: string;
};

export type ChatReadStateUpdatedEvent = {
  type: "chat.read_state.updated";
  companyId: string;
  roomId: string;
  memberId: string;
};

export type ChatProjectionChangedEvent = {
  type: "chat.projection.changed";
  companyId: string;
  viewerMemberId: string;
};

export type CompanyDirectoryChangedEvent = {
  type: "company.directory.changed";
  companyId: string;
};

export const CHAT_RUNTIME_STATUSES = [
  "queued",
  "received",
  "thinking",
  "tool_calling",
  "streaming",
  "replying",
  "completed",
  "cancel_requested",
  "canceled",
  "failed",
] as const;

export type ChatRuntimeStatus = typeof CHAT_RUNTIME_STATUSES[number];

export type ChatRuntimeStatusChangedEvent = {
  type: "chat.runtime_status.changed";
  companyId: string;
  conversationId: string;
  roomId: string;
  sourceMessageId: string;
  targetMemberId: string;
  status: ChatRuntimeStatus;
  runId: string;
  chainId?: string;
  sessionKey?: string;
  sessionRecordId?: string;
  runtimeProviderId?: string;
  replyMessageId?: string;
  errorMessage?: string;
};

export type ChatProcessTraceAppendedEvent = {
  type: "chat.process_trace.appended";
  companyId: string;
  conversationId: string;
  roomId: string;
  runId: string;
  chainId?: string;
  sourceMessageId: string;
  targetMemberId: string;
  sessionKey?: string;
  replyMessageId?: string;
  processTraceEvent: ProcessTraceEvent;
};

export type ChatReplyDeltaEvent = {
  type: "chat.reply.delta";
  companyId: string;
  conversationId: string;
  roomId: string;
  runId: string;
  chainId?: string;
  sourceMessageId: string;
  targetMemberId: string;
  sessionKey?: string;
  delta: string;
  sequenceInRun: number;
};

export type ChatReplySnapshotEvent = {
  type: "chat.reply.snapshot";
  companyId: string;
  conversationId: string;
  roomId: string;
  runId: string;
  chainId?: string;
  sourceMessageId: string;
  targetMemberId: string;
  sessionKey?: string;
  content: string;
  sequenceInRun: number;
};

export type AccessRequestChangedEvent = {
  type: "access.request.changed";
  companyId: string;
  approvalId: string;
  status: "pending" | "approved" | "rejected" | "canceled" | "expired";
  contextKind: string;
  contextId: string;
};

export type WorkRunChangedEvent = {
  type: "work_run.updated";
  companyId: string;
  workRunId: string;
  workTaskId: string;
  employeeId: string;
  status: string;
};

export type WorkTaskChangedEvent = {
  type: "work_task.updated";
  companyId: string;
  workTaskId: string;
  employeeId: string;
  status: string;
};

export type SessionChangedEvent = {
  type: "session.updated";
  companyId: string;
  sessionId: string;
  employeeId: string;
  sessionKey: string;
  status: string;
};

export type ProcessTraceChangedEvent = {
  type: "process_trace.appended";
  companyId: string;
  processTraceId: string;
  employeeId: string;
  sessionKey: string;
};

export type TinyOfficeRealtimeEventPayload =
  | ChatEntryCreatedEvent
  | ChatMessageCreatedEvent
  | ChatReadStateUpdatedEvent
  | ChatProjectionChangedEvent
  | CompanyDirectoryChangedEvent
  | ChatRuntimeStatusChangedEvent
  | ChatProcessTraceAppendedEvent
  | ChatReplyDeltaEvent
  | ChatReplySnapshotEvent
  | AccessRequestChangedEvent
  | WorkRunChangedEvent
  | WorkTaskChangedEvent
  | SessionChangedEvent
  | ProcessTraceChangedEvent;

export type TinyOfficeRealtimeEvent = TinyOfficeRealtimeEventPayload & {
  schema: typeof TINYOFFICE_REALTIME_EVENT_SCHEMA;
  version: typeof TINYOFFICE_REALTIME_EVENT_VERSION;
  eventId: string;
  occurredAt: string;
  sequence: number;
};

export interface TinyOfficeRealtimePublisher {
  publish(event: TinyOfficeRealtimeEventPayload): TinyOfficeRealtimeEvent;
}

export function createTinyOfficeRealtimeEvent(
  payload: TinyOfficeRealtimeEventPayload,
  options: {
    eventId?: string;
    occurredAt?: string;
    sequence: number;
  },
): TinyOfficeRealtimeEvent {
  const event = {
    schema: TINYOFFICE_REALTIME_EVENT_SCHEMA,
    version: TINYOFFICE_REALTIME_EVENT_VERSION,
    eventId: options.eventId || `tinyoffice-realtime-${randomUUID()}`,
    occurredAt: options.occurredAt || new Date().toISOString(),
    sequence: options.sequence,
    ...payload,
  };
  assertTinyOfficeRealtimeEvent(event);
  return event;
}

export function assertTinyOfficeRealtimeEvent(value: unknown): asserts value is TinyOfficeRealtimeEvent {
  assertNoForbiddenPublicCarrierFields(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TinyOffice realtime event must be an object");
  }
  const event = value as Partial<TinyOfficeRealtimeEvent>;
  if (event.schema !== TINYOFFICE_REALTIME_EVENT_SCHEMA) {
    throw new Error(`TinyOffice realtime event schema must be ${TINYOFFICE_REALTIME_EVENT_SCHEMA}`);
  }
  if (event.version !== TINYOFFICE_REALTIME_EVENT_VERSION) {
    throw new Error(`TinyOffice realtime event version must be ${TINYOFFICE_REALTIME_EVENT_VERSION}`);
  }
  requireNonEmptyString(event.eventId, "eventId");
  requireNonEmptyString(event.occurredAt, "occurredAt");
  if (typeof event.sequence !== "number" || !Number.isInteger(event.sequence) || event.sequence < 1) {
    throw new Error("TinyOffice realtime event sequence must be a positive integer");
  }
  requireNonEmptyString(event.companyId, "companyId");

  switch (event.type) {
    case "chat.entry.created":
      requireNonEmptyString(event.containerId, "containerId");
      requireNonEmptyString(event.entryId, "entryId");
      requireNonEmptyString(event.roomId, "roomId");
      return;
    case "chat.message.created":
      requireNonEmptyString(event.conversationId, "conversationId");
      requireNonEmptyString(event.roomId, "roomId");
      requireNonEmptyString(event.messageId, "messageId");
      return;
    case "chat.read_state.updated":
      requireNonEmptyString(event.roomId, "roomId");
      requireNonEmptyString(event.memberId, "memberId");
      return;
    case "chat.projection.changed":
      requireNonEmptyString(event.viewerMemberId, "viewerMemberId");
      return;
    case "company.directory.changed":
      return;
    case "chat.runtime_status.changed":
      rejectLegacyPublicField(event, "eventKey");
      requireNonEmptyString(event.conversationId, "conversationId");
      requireNonEmptyString(event.roomId, "roomId");
      requireNonEmptyString(event.sourceMessageId, "sourceMessageId");
      requireNonEmptyString(event.targetMemberId, "targetMemberId");
      requireNonEmptyString(event.runId, "runId");
      requireOptionalString(event.chainId, "chainId");
      if (!CHAT_RUNTIME_STATUSES.includes(event.status as ChatRuntimeStatus)) {
        throw new Error(`unsupported Chat runtime status: ${String(event.status)}`);
      }
      requireOptionalString(event.sessionKey, "sessionKey");
      requireOptionalString(event.sessionRecordId, "sessionRecordId");
      requireOptionalString(event.runtimeProviderId, "runtimeProviderId");
      requireOptionalString(event.replyMessageId, "replyMessageId");
      requireOptionalString(event.errorMessage, "errorMessage");
      return;
    case "chat.process_trace.appended":
      rejectLegacyPublicField(event, "eventKey");
      requireNonEmptyString(event.conversationId, "conversationId");
      requireNonEmptyString(event.roomId, "roomId");
      requireNonEmptyString(event.runId, "runId");
      requireOptionalString(event.chainId, "chainId");
      requireNonEmptyString(event.sourceMessageId, "sourceMessageId");
      requireNonEmptyString(event.targetMemberId, "targetMemberId");
      requireOptionalString(event.sessionKey, "sessionKey");
      requireOptionalString(event.replyMessageId, "replyMessageId");
      requireProcessTraceEvent(event.processTraceEvent);
      return;
    case "chat.reply.delta":
      rejectLegacyPublicField(event, "eventKey");
      requireNonEmptyString(event.conversationId, "conversationId");
      requireNonEmptyString(event.roomId, "roomId");
      requireNonEmptyString(event.runId, "runId");
      requireOptionalString(event.chainId, "chainId");
      requireNonEmptyString(event.sourceMessageId, "sourceMessageId");
      requireNonEmptyString(event.targetMemberId, "targetMemberId");
      requireOptionalString(event.sessionKey, "sessionKey");
      requireNonEmptyString(event.delta, "delta");
      requirePositiveInteger(event.sequenceInRun, "sequenceInRun");
      return;
    case "chat.reply.snapshot":
      rejectLegacyPublicField(event, "eventKey");
      requireNonEmptyString(event.conversationId, "conversationId");
      requireNonEmptyString(event.roomId, "roomId");
      requireNonEmptyString(event.runId, "runId");
      requireOptionalString(event.chainId, "chainId");
      requireNonEmptyString(event.sourceMessageId, "sourceMessageId");
      requireNonEmptyString(event.targetMemberId, "targetMemberId");
      requireOptionalString(event.sessionKey, "sessionKey");
      requireNonEmptyString(event.content, "content");
      requirePositiveInteger(event.sequenceInRun, "sequenceInRun");
      return;
    case "access.request.changed":
      requireNonEmptyString(event.approvalId, "approvalId");
      requireNonEmptyString(event.contextKind, "contextKind");
      requireNonEmptyString(event.contextId, "contextId");
      if (!["pending", "approved", "rejected", "canceled", "expired"].includes(String(event.status))) {
        throw new Error(`unsupported Access request status: ${String(event.status)}`);
      }
      return;
    case "work_run.updated":
      requireNonEmptyString(event.workRunId, "workRunId");
      requireNonEmptyString(event.workTaskId, "workTaskId");
      requireNonEmptyString(event.employeeId, "employeeId");
      requireNonEmptyString(event.status, "status");
      return;
    case "work_task.updated":
      requireNonEmptyString(event.workTaskId, "workTaskId");
      requireNonEmptyString(event.employeeId, "employeeId");
      requireNonEmptyString(event.status, "status");
      return;
    case "session.updated":
      requireNonEmptyString(event.sessionId, "sessionId");
      requireNonEmptyString(event.employeeId, "employeeId");
      requireNonEmptyString(event.sessionKey, "sessionKey");
      requireNonEmptyString(event.status, "status");
      return;
    case "process_trace.appended":
      requireNonEmptyString(event.processTraceId, "processTraceId");
      requireNonEmptyString(event.employeeId, "employeeId");
      requireNonEmptyString(event.sessionKey, "sessionKey");
      return;
    default:
      throw new Error(`unsupported TinyOffice realtime event type: ${String(event.type)}`);
  }
}

function rejectLegacyPublicField(value: object, fieldName: string): void {
  if (Object.prototype.hasOwnProperty.call(value, fieldName)) {
    throw new Error(`unsupported TinyOffice realtime event field: ${fieldName}`);
  }
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function requireOptionalString(value: unknown, fieldName: string): void {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    throw new Error(`${fieldName} must be a non-empty string when present`);
  }
}

function requirePositiveInteger(value: unknown, fieldName: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
}

function requireProcessTraceEvent(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("processTraceEvent must be an object");
  }
  const event = value as Partial<ProcessTraceEvent>;
  requireNonEmptyString(event.id, "processTraceEvent.id");
  requireNonEmptyString(event.timestamp, "processTraceEvent.timestamp");
  requireNonEmptyString(event.kind, "processTraceEvent.kind");
  requireNonEmptyString(event.sessionKey, "processTraceEvent.sessionKey");
  requireNonEmptyString(event.title, "processTraceEvent.title");
}
