import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import { logicalRuntimeSessionToolCounts } from "./runtime-session-tool-counts.js";
import { releaseCompanyPostgresConnection } from "../company-config/postgres-runtime-connection.js";
import type { PostgresMigrationClient } from "../company-config/postgres-company-database.js";
import type {
  CollaborationActionEvent,
  MemorySummary,
  RetentionState,
  RuntimeSessionEvent,
  RuntimeSessionMetadata,
  RuntimeSessionRecord,
  RuntimeSessionStatus,
  RuntimeStorageCleanupResult,
  RuntimeStorageRetentionPolicy,
  RuntimeSessionStorageDomain,
} from "./runtime-session-repository.js";

interface RuntimePostgresClient extends PostgresMigrationClient {
  release(): void;
}

const DEFAULT_POSTGRES_RUNTIME_STORAGE_RETENTION_POLICY: RuntimeStorageRetentionPolicy = {
  keepSessionDays: 30,
  maxSessionRecords: 3000,
  maxSessionEvents: 500000,
  maxEventPreviewBytes: 8192,
  maxEventPayloadBytes: 262144,
};

export interface RuntimePostgresPoolLike {
  end?(): Promise<void>;
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function bool(value: unknown): boolean {
  return value === true || value === 1;
}

function numberValue(value: unknown): number {
  return Number(value ?? 0);
}

function timestampValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return String(value);
}

function optionalTimestamp(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  return timestampValue(value);
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function runtimeSessionMetadata(value: unknown): RuntimeSessionMetadata | undefined {
  return jsonObject(value) as RuntimeSessionMetadata | undefined;
}

function inferWorkRunIdFromSessionKey(sceneType: string, sessionKey: string): string | undefined {
  if (sceneType !== "work_run_execution") {
    return undefined;
  }
  const [, , workRunId] = sessionKey.split("|");
  return workRunId?.trim() || undefined;
}

export function sessionRecordFromRow(row: Record<string, unknown>): RuntimeSessionRecord {
  return {
    id: String(row.id),
    employeeId: String(row.employee_id),
    sessionKey: String(row.session_key),
    sessionId: String(row.session_id),
    sceneType: String(row.scene_type),
    channelTopicId: optional(row.channel_topic_id),
    workRunId: optional(row.work_run_id),
    requesterId: optional(row.requester_id),
    modelProvider: optional(row.model_provider),
    modelId: optional(row.model_id),
    runtimeMetadata: runtimeSessionMetadata(row.metadata_json),
    status: String(row.status) as RuntimeSessionStatus,
    title: optional(row.title),
    summary: optional(row.summary),
    startedAt: timestampValue(row.started_at),
    updatedAt: timestampValue(row.updated_at),
    eventCount: numberValue(row.event_count),
    userMessageCount: numberValue(row.user_message_count),
    assistantMessageCount: numberValue(row.assistant_message_count),
    toolCallCount: numberValue(row.tool_call_count),
    toolResultCount: numberValue(row.tool_result_count),
    tokenInputTotal: numberValue(row.token_input_total),
    tokenOutputTotal: numberValue(row.token_output_total),
    tokenCacheTotal: numberValue(row.token_cache_total),
    byteSize: numberValue(row.byte_size),
    truncated: bool(row.truncated),
  };
}

function sessionEventFromRow(row: Record<string, unknown>): RuntimeSessionEvent {
  return {
    id: String(row.id),
    sessionRecordId: String(row.session_record_id),
    sequence: numberValue(row.sequence),
    timestamp: timestampValue(row.timestamp),
    kind: String(row.kind),
    role: optional(row.role),
    sceneId: optional(row.scene_id),
    turnId: optional(row.turn_id),
    runId: optional(row.run_id),
    modelCallId: optional(row.model_call_id),
    source: optional(row.source),
    visibility: optional(row.visibility) as RuntimeSessionEvent["visibility"] | undefined,
    semanticRole: optional(row.semantic_role),
    rawEventKind: optional(row.raw_event_kind),
    title: optional(row.title),
    summary: optional(row.summary),
    preview: optional(row.preview),
    payload: jsonObject(row.payload_json),
    byteSize: numberValue(row.byte_size),
    truncated: bool(row.truncated),
  };
}

function processTraceEventFromRow(row: Record<string, unknown>): ProcessTraceEvent {
  return {
    id: String(row.id),
    timestamp: timestampValue(row.timestamp),
    sessionKey: String(row.session_key),
    runId: optional(row.run_id),
    sequenceInRun: row.sequence_in_run === null || row.sequence_in_run === undefined
      ? undefined
      : numberValue(row.sequence_in_run),
    conversationId: optional(row.conversation_id),
    messageId: optional(row.message_id),
    sourceMessageId: optional(row.source_message_id),
    chatEntryId: optional(row.chat_entry_id),
    channelTopicId: optional(row.channel_topic_id),
    workTaskId: optional(row.work_task_id),
    workRunId: optional(row.work_run_id),
    employeeId: optional(row.employee_id),
    kind: String(row.kind) as ProcessTraceEvent["kind"],
    title: String(row.title),
    summary: optional(row.summary),
    status: optional(row.status) as ProcessTraceEvent["status"] | undefined,
    preview: optional(row.preview),
    metadata: jsonObject(row.payload_json),
  };
}

function collaborationActionEventFromRow(row: Record<string, unknown>): CollaborationActionEvent {
  return {
    id: String(row.id),
    timestamp: timestampValue(row.timestamp),
    employeeId: String(row.employee_id),
    actionName: String(row.action_name),
    channelTopicId: optional(row.channel_topic_id),
    workRunId: optional(row.work_run_id),
    status: optional(row.status),
    recipientId: optional(row.recipient_id),
    message: optional(row.message),
    progressSummary: optional(row.progress_summary),
    decision: optional(row.decision),
    emitted: bool(row.emitted),
    suppressedReason: optional(row.suppressed_reason),
    payload: jsonObject(row.payload_json),
  };
}

function memorySummaryFromRow(row: Record<string, unknown>): MemorySummary {
  return {
    id: String(row.id),
    createdAt: timestampValue(row.created_at),
    updatedAt: timestampValue(row.updated_at),
    scopeKind: String(row.scope_kind),
    scopeId: String(row.scope_id),
    employeeId: optional(row.employee_id),
    sourceKind: String(row.source_kind),
    sourceId: String(row.source_id),
    category: String(row.category),
    title: String(row.title),
    summary: String(row.summary),
    importance: numberValue(row.importance),
    lastAccessedAt: optionalTimestamp(row.last_accessed_at),
    expiresAt: optionalTimestamp(row.expires_at),
    embeddingStatus: String(row.embedding_status),
    embeddingRef: optional(row.embedding_ref),
  };
}

function metadataString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const item = value?.[key];
  return typeof item === "string" && item.trim() ? item.trim() : undefined;
}

function retentionStateFromRow(row: Record<string, unknown>): RetentionState {
  const policy = row.policy_json;
  return {
    id: String(row.id),
    policy: typeof policy === "string"
      ? JSON.parse(policy) as RuntimeStorageRetentionPolicy
      : policy as RuntimeStorageRetentionPolicy,
    lastCleanupAt: optionalTimestamp(row.last_cleanup_at),
    deletedSessionCount: numberValue(row.deleted_session_count),
    deletedEventCount: numberValue(row.deleted_event_count),
    lastVacuumAt: optionalTimestamp(row.last_vacuum_at),
    updatedAt: timestampValue(row.updated_at),
  };
}

function byTimestampAsc<T extends { timestamp: string; id: string }>(left: T, right: T) {
  return left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id);
}

function byUpdatedDesc(left: RuntimeSessionRecord, right: RuntimeSessionRecord) {
  return right.updatedAt.localeCompare(left.updatedAt) ||
    right.startedAt.localeCompare(left.startedAt) ||
    left.id.localeCompare(right.id);
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = item;
  } else {
    items.push(item);
  }
}

function deleteById<T extends { id: string }>(items: T[], id: string): number {
  const index = items.findIndex((candidate) => candidate.id === id);
  if (index < 0) {
    return 0;
  }
  items.splice(index, 1);
  return 1;
}

export class PostgresRuntimeSessionRepository {
  private pendingWrites: Promise<unknown> = Promise.resolve();
  private pendingWriteCount = 0;
  private closed = false;

  private constructor(
    private readonly client: RuntimePostgresClient,
    private readonly pool: RuntimePostgresPoolLike,
    private readonly companyId: string,
    private readonly sessionRecords: RuntimeSessionRecord[],
    private readonly sessionEvents: RuntimeSessionEvent[],
    private readonly processTraceEvents: ProcessTraceEvent[],
    private readonly collaborationActionEvents: CollaborationActionEvent[],
    private readonly memorySummaries: MemorySummary[],
    private readonly retentionStates: RetentionState[],
  ) {}

  static async open(input: {
    client: RuntimePostgresClient;
    pool: RuntimePostgresPoolLike;
    companyId: string;
    sessionRecordId?: string;
    domains?: RuntimeSessionStorageDomain[];
  }): Promise<PostgresRuntimeSessionRepository> {
    const domains = new Set<RuntimeSessionStorageDomain>(
      input.sessionRecordId ? ["sessions"] : input.domains ?? [
        "sessions",
        "processTrace",
        "collaborationActions",
        "memory",
        "retention",
      ],
    );
    const sessionRecords = !domains.has("sessions") ? { rows: [] } : await input.client.query(
      input.sessionRecordId
        ? "SELECT * FROM session_records WHERE company_id = $1 AND id = $2"
        : "SELECT * FROM session_records WHERE company_id = $1 ORDER BY updated_at DESC, started_at DESC",
      input.sessionRecordId ? [input.companyId, input.sessionRecordId] : [input.companyId],
    );
    const sessionEvents = !domains.has("sessions") ? { rows: [] } : await input.client.query(
      input.sessionRecordId
        ? "SELECT * FROM session_events WHERE company_id = $1 AND session_record_id = $2 ORDER BY sequence ASC, timestamp ASC"
        : "SELECT * FROM session_events WHERE company_id = $1 ORDER BY sequence ASC, timestamp ASC",
      input.sessionRecordId ? [input.companyId, input.sessionRecordId] : [input.companyId],
    );
    const processTraceEvents = !domains.has("processTrace")
      ? { rows: [] }
      : await input.client.query(
          "SELECT * FROM process_trace_events WHERE company_id = $1 ORDER BY timestamp ASC",
          [input.companyId],
        );
    const collaborationActionEvents = !domains.has("collaborationActions")
      ? { rows: [] }
      : await input.client.query(
          "SELECT * FROM collaboration_action_events WHERE company_id = $1 ORDER BY timestamp ASC",
          [input.companyId],
        );
    const memorySummaries = !domains.has("memory")
      ? { rows: [] }
      : await input.client.query(
          "SELECT * FROM memory_summaries WHERE company_id = $1 ORDER BY updated_at DESC",
          [input.companyId],
        );
    const retentionStates = !domains.has("retention")
      ? { rows: [] }
      : await input.client.query(
          "SELECT * FROM runtime_storage_retention_state WHERE company_id = $1",
          [input.companyId],
        );

    return new PostgresRuntimeSessionRepository(
      input.client,
      input.pool,
      input.companyId,
      sessionRecords.rows.map(sessionRecordFromRow),
      sessionEvents.rows.map(sessionEventFromRow),
      processTraceEvents.rows.map(processTraceEventFromRow),
      collaborationActionEvents.rows.map(collaborationActionEventFromRow),
      memorySummaries.rows.map(memorySummaryFromRow),
      retentionStates.rows.map(retentionStateFromRow),
    );
  }

  upsertSessionRecord(input: {
    id: string;
    employeeId: string;
    sessionKey: string;
    sessionId: string;
    sceneType: string;
    channelTopicId?: string;
    workRunId?: string;
    requesterId?: string;
    modelProvider?: string;
    modelId?: string;
    runtimeMetadata?: RuntimeSessionMetadata;
    status: RuntimeSessionStatus;
    title?: string;
    summary?: string;
    startedAt: string;
    updatedAt: string;
    eventCount?: number;
    userMessageCount?: number;
    assistantMessageCount?: number;
    toolCallCount?: number;
    toolResultCount?: number;
    tokenInputTotal?: number;
    tokenOutputTotal?: number;
    tokenCacheTotal?: number;
    byteSize?: number;
    truncated?: boolean;
  }): RuntimeSessionRecord {
    const existing = this.getSessionRecord(input.id);
    const runtimeMetadata = input.runtimeMetadata ?? existing?.runtimeMetadata;
    const record: RuntimeSessionRecord = {
      id: input.id,
      employeeId: input.employeeId,
      sessionKey: input.sessionKey,
      sessionId: input.sessionId,
      sceneType: input.sceneType,
      channelTopicId: input.channelTopicId,
      workRunId: input.workRunId ?? existing?.workRunId ??
        inferWorkRunIdFromSessionKey(input.sceneType, input.sessionKey),
      requesterId: input.requesterId,
      modelProvider: input.modelProvider,
      modelId: input.modelId,
      runtimeMetadata,
      status: input.status,
      title: input.title,
      summary: input.summary,
      startedAt: timestampValue(input.startedAt),
      updatedAt: timestampValue(input.updatedAt),
      eventCount: input.eventCount ?? existing?.eventCount ?? 0,
      userMessageCount: input.userMessageCount ?? existing?.userMessageCount ?? 0,
      assistantMessageCount: input.assistantMessageCount ?? existing?.assistantMessageCount ?? 0,
      toolCallCount: input.toolCallCount ?? existing?.toolCallCount ?? 0,
      toolResultCount: input.toolResultCount ?? existing?.toolResultCount ?? 0,
      tokenInputTotal: input.tokenInputTotal ?? existing?.tokenInputTotal ?? 0,
      tokenOutputTotal: input.tokenOutputTotal ?? existing?.tokenOutputTotal ?? 0,
      tokenCacheTotal: input.tokenCacheTotal ?? existing?.tokenCacheTotal ?? 0,
      byteSize: input.byteSize ?? existing?.byteSize ?? 0,
      truncated: input.truncated ?? existing?.truncated ?? false,
    };
    upsertById(this.sessionRecords, record);
    this.queueQuery(
      `INSERT INTO session_records (
  company_id, id, employee_id, session_key, session_id, scene_type,
  channel_topic_id, work_run_id, requester_id, model_provider, model_id, metadata_json, status,
  title, summary, started_at, updated_at, event_count, user_message_count,
  assistant_message_count, tool_call_count, tool_result_count, token_input_total,
  token_output_total, token_cache_total, byte_size, truncated
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
ON CONFLICT (company_id, id) DO UPDATE SET
  employee_id = EXCLUDED.employee_id,
  session_key = EXCLUDED.session_key,
  session_id = EXCLUDED.session_id,
  scene_type = EXCLUDED.scene_type,
  channel_topic_id = EXCLUDED.channel_topic_id,
  work_run_id = EXCLUDED.work_run_id,
  requester_id = EXCLUDED.requester_id,
  model_provider = EXCLUDED.model_provider,
  model_id = EXCLUDED.model_id,
  metadata_json = EXCLUDED.metadata_json,
  status = EXCLUDED.status,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  started_at = EXCLUDED.started_at,
  updated_at = EXCLUDED.updated_at,
  event_count = EXCLUDED.event_count,
  user_message_count = EXCLUDED.user_message_count,
  assistant_message_count = EXCLUDED.assistant_message_count,
  tool_call_count = EXCLUDED.tool_call_count,
  tool_result_count = EXCLUDED.tool_result_count,
  token_input_total = EXCLUDED.token_input_total,
  token_output_total = EXCLUDED.token_output_total,
  token_cache_total = EXCLUDED.token_cache_total,
  byte_size = EXCLUDED.byte_size,
  truncated = EXCLUDED.truncated`,
      [
        this.companyId,
        record.id,
        record.employeeId,
        record.sessionKey,
        record.sessionId,
        record.sceneType,
        record.channelTopicId ?? null,
        record.workRunId ?? null,
        record.requesterId ?? null,
        record.modelProvider ?? null,
        record.modelId ?? null,
        record.runtimeMetadata ?? null,
        record.status,
        record.title ?? null,
        record.summary ?? null,
        record.startedAt,
        record.updatedAt,
        record.eventCount,
        record.userMessageCount,
        record.assistantMessageCount,
        record.toolCallCount,
        record.toolResultCount,
        record.tokenInputTotal,
        record.tokenOutputTotal,
        record.tokenCacheTotal,
        record.byteSize,
        record.truncated,
      ],
    );
    return record;
  }

  appendSessionEvent(input: {
    id: string;
    sessionRecordId: string;
    sequence: number;
    timestamp: string;
    kind: string;
    role?: string;
    sceneId?: string;
    turnId?: string;
    runId?: string;
    modelCallId?: string;
    source?: string;
    visibility?: RuntimeSessionEvent["visibility"];
    semanticRole?: string;
    rawEventKind?: string;
    title?: string;
    summary?: string;
    preview?: string;
    payload?: Record<string, unknown>;
    byteSize?: number;
    truncated?: boolean;
  }): RuntimeSessionEvent {
    const event: RuntimeSessionEvent = {
      id: input.id,
      sessionRecordId: input.sessionRecordId,
      sequence: input.sequence,
      timestamp: timestampValue(input.timestamp),
      kind: input.kind,
      role: input.role,
      sceneId: input.sceneId,
      turnId: input.turnId,
      runId: input.runId,
      modelCallId: input.modelCallId,
      source: input.source,
      visibility: input.visibility,
      semanticRole: input.semanticRole,
      rawEventKind: input.rawEventKind,
      title: input.title,
      summary: input.summary,
      preview: input.preview,
      payload: input.payload,
      byteSize: input.byteSize || 0,
      truncated: Boolean(input.truncated),
    };
    upsertById(this.sessionEvents, event);
    this.recountSession(input.sessionRecordId);
    this.queueQuery(
      `INSERT INTO session_events (
  company_id, id, session_record_id, sequence, timestamp, kind, role, scene_id, turn_id,
  run_id, model_call_id, source, visibility, semantic_role, raw_event_kind,
  title, summary, preview, payload_json, byte_size, truncated
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
ON CONFLICT (company_id, id) DO UPDATE SET
  session_record_id = EXCLUDED.session_record_id,
  sequence = EXCLUDED.sequence,
  timestamp = EXCLUDED.timestamp,
  kind = EXCLUDED.kind,
  role = EXCLUDED.role,
  scene_id = EXCLUDED.scene_id,
  turn_id = EXCLUDED.turn_id,
  run_id = EXCLUDED.run_id,
  model_call_id = EXCLUDED.model_call_id,
  source = EXCLUDED.source,
  visibility = EXCLUDED.visibility,
  semantic_role = EXCLUDED.semantic_role,
  raw_event_kind = EXCLUDED.raw_event_kind,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  preview = EXCLUDED.preview,
  payload_json = EXCLUDED.payload_json,
  byte_size = EXCLUDED.byte_size,
  truncated = EXCLUDED.truncated`,
      [
        this.companyId,
        event.id,
        event.sessionRecordId,
        event.sequence,
        event.timestamp,
        event.kind,
        event.role ?? null,
        event.sceneId ?? null,
        event.turnId ?? null,
        event.runId ?? null,
        event.modelCallId ?? null,
        event.source ?? null,
        event.visibility ?? null,
        event.semanticRole ?? null,
        event.rawEventKind ?? null,
        event.title ?? null,
        event.summary ?? null,
        event.preview ?? null,
        event.payload ?? null,
        event.byteSize,
        event.truncated,
      ],
    );
    this.queueSessionRecount(input.sessionRecordId);
    return event;
  }

  getSessionRecord(id: string): RuntimeSessionRecord | undefined {
    return this.sessionRecords.find((record) => record.id === id);
  }

  getSessionDetail(id: string): { record: RuntimeSessionRecord; events: RuntimeSessionEvent[] } | undefined {
    const record = this.getSessionRecord(id);
    if (!record) {
      return undefined;
    }
    return {
      record,
      events: this.listSessionEvents(id),
    };
  }

  listSessionRecords(input: {
    employeeId?: string;
    sessionKey?: string;
    channelTopicId?: string;
    workRunId?: string;
    limit?: number;
  } = {}): RuntimeSessionRecord[] {
    const records = this.sessionRecords
      .filter((record) => !input.employeeId || record.employeeId === input.employeeId)
      .filter((record) => !input.sessionKey || record.sessionKey === input.sessionKey)
      .filter((record) => !input.channelTopicId || record.channelTopicId === input.channelTopicId)
      .filter((record) => !input.workRunId || record.workRunId === input.workRunId)
      .sort(byUpdatedDesc);
    return input.limit ? records.slice(0, input.limit) : records;
  }

  listSessionEvents(sessionRecordId: string): RuntimeSessionEvent[] {
    return this.sessionEvents
      .filter((event) => event.sessionRecordId === sessionRecordId)
      .sort((left, right) => left.sequence - right.sequence || left.timestamp.localeCompare(right.timestamp));
  }

  appendProcessTraceEvent(input: ProcessTraceEvent): ProcessTraceEvent {
    const event: ProcessTraceEvent = {
      ...input,
      timestamp: timestampValue(input.timestamp),
    };
    upsertById(this.processTraceEvents, event);
    this.queueQuery(
      `INSERT INTO process_trace_events (
  company_id, id, timestamp, session_key, run_id, sequence_in_run,
  conversation_id, message_id, source_message_id, chat_entry_id,
  channel_topic_id, work_task_id, work_run_id, employee_id,
  kind, title, summary, status, preview, payload_json
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
ON CONFLICT (company_id, id) DO UPDATE SET
  timestamp = EXCLUDED.timestamp,
  session_key = EXCLUDED.session_key,
  run_id = EXCLUDED.run_id,
  sequence_in_run = EXCLUDED.sequence_in_run,
  conversation_id = EXCLUDED.conversation_id,
  message_id = EXCLUDED.message_id,
  source_message_id = EXCLUDED.source_message_id,
  chat_entry_id = EXCLUDED.chat_entry_id,
  channel_topic_id = EXCLUDED.channel_topic_id,
  work_task_id = EXCLUDED.work_task_id,
  work_run_id = EXCLUDED.work_run_id,
  employee_id = EXCLUDED.employee_id,
  kind = EXCLUDED.kind,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  status = EXCLUDED.status,
  preview = EXCLUDED.preview,
  payload_json = EXCLUDED.payload_json`,
      [
        this.companyId,
        event.id,
        event.timestamp,
        event.sessionKey,
        event.runId ?? metadataString(event.metadata, "runId") ?? metadataString(event.metadata, "eventKey") ?? null,
        event.sequenceInRun ?? null,
        event.conversationId ?? metadataString(event.metadata, "conversationId") ?? null,
        event.messageId ?? metadataString(event.metadata, "messageId") ?? null,
        event.sourceMessageId ?? metadataString(event.metadata, "sourceMessageId") ?? null,
        event.chatEntryId ?? metadataString(event.metadata, "chatEntryId") ?? null,
        event.channelTopicId ?? null,
        event.workTaskId ?? null,
        event.workRunId ?? null,
        event.employeeId ?? null,
        event.kind,
        event.title,
        event.summary ?? null,
        event.status ?? null,
        event.preview ?? null,
        event.metadata ?? null,
      ],
    );
    return event;
  }

  listProcessTraceEvents(input: {
    processTraceId?: string;
    sessionKey?: string;
    channelTopicId?: string;
    conversationId?: string;
    messageId?: string;
    sourceMessageId?: string;
    chatEntryId?: string;
    workTaskId?: string;
    workRunId?: string;
    employeeId?: string;
    since?: string;
    limit?: number;
  } = {}): ProcessTraceEvent[] {
    const events = this.processTraceEvents
      .filter((event) => !input.processTraceId || event.id === input.processTraceId)
      .filter((event) => !input.sessionKey || event.sessionKey === input.sessionKey)
      .filter((event) => !input.channelTopicId || event.channelTopicId === input.channelTopicId)
      .filter((event) => !input.conversationId || event.conversationId === input.conversationId)
      .filter((event) => !input.messageId || event.messageId === input.messageId)
      .filter((event) => !input.sourceMessageId || event.sourceMessageId === input.sourceMessageId)
      .filter((event) => !input.chatEntryId || event.chatEntryId === input.chatEntryId)
      .filter((event) => !input.workTaskId || event.workTaskId === input.workTaskId)
      .filter((event) => !input.workRunId || event.workRunId === input.workRunId)
      .filter((event) => !input.employeeId || event.employeeId === input.employeeId)
      .filter((event) => !input.since || event.timestamp >= input.since)
      .sort(byTimestampAsc);
    return input.limit ? events.slice(-input.limit) : events;
  }

  appendCollaborationActionEvent(input: CollaborationActionEvent): CollaborationActionEvent {
    const event: CollaborationActionEvent = {
      ...input,
      timestamp: timestampValue(input.timestamp),
    };
    upsertById(this.collaborationActionEvents, event);
    this.queueQuery(
      `INSERT INTO collaboration_action_events (
  company_id, id, timestamp, employee_id, action_name, channel_topic_id,
  work_run_id, status, recipient_id, message, progress_summary, decision,
  emitted, suppressed_reason, payload_json
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
ON CONFLICT (company_id, id) DO UPDATE SET
  timestamp = EXCLUDED.timestamp,
  employee_id = EXCLUDED.employee_id,
  action_name = EXCLUDED.action_name,
  channel_topic_id = EXCLUDED.channel_topic_id,
  work_run_id = EXCLUDED.work_run_id,
  status = EXCLUDED.status,
  recipient_id = EXCLUDED.recipient_id,
  message = EXCLUDED.message,
  progress_summary = EXCLUDED.progress_summary,
  decision = EXCLUDED.decision,
  emitted = EXCLUDED.emitted,
  suppressed_reason = EXCLUDED.suppressed_reason,
  payload_json = EXCLUDED.payload_json`,
      [
        this.companyId,
        event.id,
        event.timestamp,
        event.employeeId,
        event.actionName,
        event.channelTopicId ?? null,
        event.workRunId ?? null,
        event.status ?? null,
        event.recipientId ?? null,
        event.message ?? null,
        event.progressSummary ?? null,
        event.decision ?? null,
        event.emitted,
        event.suppressedReason ?? null,
        event.payload ?? null,
      ],
    );
    return event;
  }

  listCollaborationActionEvents(input: {
    channelTopicId?: string;
    workRunId?: string;
    employeeId?: string;
    actionName?: string;
    limit?: number;
  } = {}): CollaborationActionEvent[] {
    const events = this.collaborationActionEvents
      .filter((event) => !input.channelTopicId || event.channelTopicId === input.channelTopicId)
      .filter((event) => !input.workRunId || event.workRunId === input.workRunId)
      .filter((event) => !input.employeeId || event.employeeId === input.employeeId)
      .filter((event) => !input.actionName || event.actionName === input.actionName)
      .sort(byTimestampAsc);
    return input.limit ? events.slice(0, input.limit) : events;
  }

  upsertMemorySummary(input: MemorySummary): MemorySummary {
    const summary: MemorySummary = {
      ...input,
      createdAt: timestampValue(input.createdAt),
      updatedAt: timestampValue(input.updatedAt),
      lastAccessedAt: optionalTimestamp(input.lastAccessedAt),
      expiresAt: optionalTimestamp(input.expiresAt),
    };
    upsertById(this.memorySummaries, summary);
    this.queueQuery(
      `INSERT INTO memory_summaries (
  company_id, id, created_at, updated_at, scope_kind, scope_id, employee_id, source_kind,
  source_id, category, title, summary, importance, last_accessed_at, expires_at,
  embedding_status, embedding_ref
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
ON CONFLICT (company_id, id) DO UPDATE SET
  updated_at = EXCLUDED.updated_at,
  scope_kind = EXCLUDED.scope_kind,
  scope_id = EXCLUDED.scope_id,
  employee_id = EXCLUDED.employee_id,
  source_kind = EXCLUDED.source_kind,
  source_id = EXCLUDED.source_id,
  category = EXCLUDED.category,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  importance = EXCLUDED.importance,
  last_accessed_at = EXCLUDED.last_accessed_at,
  expires_at = EXCLUDED.expires_at,
  embedding_status = EXCLUDED.embedding_status,
  embedding_ref = EXCLUDED.embedding_ref`,
      [
        this.companyId,
        summary.id,
        summary.createdAt,
        summary.updatedAt,
        summary.scopeKind,
        summary.scopeId,
        summary.employeeId ?? null,
        summary.sourceKind,
        summary.sourceId,
        summary.category,
        summary.title,
        summary.summary,
        summary.importance,
        summary.lastAccessedAt ?? null,
        summary.expiresAt ?? null,
        summary.embeddingStatus,
        summary.embeddingRef ?? null,
      ],
    );
    return summary;
  }

  listMemorySummaries(input: {
    id?: string;
    employeeId?: string;
    scopeKind?: string;
    scopeId?: string;
    category?: string;
    limit?: number;
  } = {}): MemorySummary[] {
    const summaries = this.memorySummaries
      .filter((summary) => !input.id || summary.id === input.id)
      .filter((summary) => !input.employeeId || summary.employeeId === input.employeeId)
      .filter((summary) => !input.scopeKind || summary.scopeKind === input.scopeKind)
      .filter((summary) => !input.scopeId || summary.scopeId === input.scopeId)
      .filter((summary) => !input.category || summary.category === input.category)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return input.limit ? summaries.slice(0, input.limit) : summaries;
  }

  upsertRetentionState(input: {
    id: string;
    policy: RuntimeStorageRetentionPolicy;
    lastCleanupAt?: string;
    deletedSessionCount?: number;
    deletedEventCount?: number;
    lastVacuumAt?: string;
    updatedAt?: string;
  }): RetentionState {
    const state: RetentionState = {
      id: input.id,
      policy: input.policy,
      lastCleanupAt: optionalTimestamp(input.lastCleanupAt),
      deletedSessionCount: input.deletedSessionCount || 0,
      deletedEventCount: input.deletedEventCount || 0,
      lastVacuumAt: optionalTimestamp(input.lastVacuumAt),
      updatedAt: timestampValue(input.updatedAt || input.lastCleanupAt || new Date().toISOString()),
    };
    upsertById(this.retentionStates, state);
    this.queueQuery(
      `INSERT INTO runtime_storage_retention_state (
  company_id, id, policy_json, last_cleanup_at, deleted_session_count, deleted_event_count,
  last_vacuum_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (company_id, id) DO UPDATE SET
  policy_json = EXCLUDED.policy_json,
  last_cleanup_at = EXCLUDED.last_cleanup_at,
  deleted_session_count = EXCLUDED.deleted_session_count,
  deleted_event_count = EXCLUDED.deleted_event_count,
  last_vacuum_at = EXCLUDED.last_vacuum_at,
  updated_at = EXCLUDED.updated_at`,
      [
        this.companyId,
        state.id,
        state.policy,
        state.lastCleanupAt ?? null,
        state.deletedSessionCount,
        state.deletedEventCount,
        state.lastVacuumAt ?? null,
        state.updatedAt,
      ],
    );
    return state;
  }

  getRetentionState(id: string): RetentionState | undefined {
    return this.retentionStates.find((state) => state.id === id);
  }

  cleanupRuntimeStorage(input: {
    policy?: RuntimeStorageRetentionPolicy;
    now?: string;
    vacuum?: boolean;
  } = {}): RuntimeStorageCleanupResult {
    const policy = input.policy || DEFAULT_POSTGRES_RUNTIME_STORAGE_RETENTION_POLICY;
    const now = input.now || new Date().toISOString();
    const cutoff = new Date(
      new Date(now).getTime() - policy.keepSessionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    let deletedSessionCount = 0;
    let deletedEventCount = 0;
    const deleteSession = (id: string) => {
      const count = deleteById(this.sessionRecords, id);
      if (!count) {
        return;
      }
      const before = this.sessionEvents.length;
      for (let index = this.sessionEvents.length - 1; index >= 0; index -= 1) {
        if (this.sessionEvents[index]?.sessionRecordId === id) {
          this.sessionEvents.splice(index, 1);
        }
      }
      deletedSessionCount += 1;
      deletedEventCount += before - this.sessionEvents.length;
      this.queueQuery("DELETE FROM session_records WHERE company_id = $1 AND id = $2", [this.companyId, id]);
    };

    for (const record of [...this.sessionRecords]
      .filter((record) => record.updatedAt < cutoff)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))) {
      deleteSession(record.id);
    }

    while (this.sessionRecords.length > policy.maxSessionRecords) {
      const oldest = [...this.sessionRecords]
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))[0];
      if (!oldest) break;
      deleteSession(oldest.id);
    }

    while (this.sessionEvents.length > policy.maxSessionEvents && this.sessionRecords.length > 0) {
      const oldest = [...this.sessionRecords]
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))[0];
      if (!oldest) break;
      deleteSession(oldest.id);
    }

    const state = this.upsertRetentionState({
      id: "runtime-storage",
      policy,
      lastCleanupAt: now,
      deletedSessionCount,
      deletedEventCount,
      lastVacuumAt: input.vacuum ? now : undefined,
      updatedAt: now,
    });
    return { state, deletedSessionCount, deletedEventCount };
  }

  async save(): Promise<void> {
    await this.pendingWrites;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const release = () => releaseCompanyPostgresConnection({ client: this.client, pool: this.pool });
    if (this.pendingWriteCount === 0) {
      void release();
      return;
    }
    void this.pendingWrites
      .finally(release)
      .catch(() => undefined);
  }

  private queueQuery(sql: string, params?: readonly unknown[]) {
    this.pendingWriteCount += 1;
    this.pendingWrites = this.pendingWrites
      .then(() => this.client.query(sql, params))
      .finally(() => {
        this.pendingWriteCount -= 1;
      });
  }

  private queueSessionRecount(sessionRecordId: string) {
    const record = this.getSessionRecord(sessionRecordId);
    if (!record) {
      return;
    }
    this.queueQuery(
      `UPDATE session_records SET
  event_count = $3,
  user_message_count = $4,
  assistant_message_count = $5,
  tool_call_count = $6,
  tool_result_count = $7,
  byte_size = $8
WHERE company_id = $1 AND id = $2`,
      [
        this.companyId,
        sessionRecordId,
        record.eventCount,
        record.userMessageCount,
        record.assistantMessageCount,
        record.toolCallCount,
        record.toolResultCount,
        record.byteSize,
      ],
    );
  }

  private recountSession(sessionRecordId: string): void {
    const record = this.getSessionRecord(sessionRecordId);
    if (!record) {
      return;
    }
    const events = this.sessionEvents.filter((event) => event.sessionRecordId === sessionRecordId);
    record.eventCount = events.length;
    record.userMessageCount = events.filter(isUserVisibleUserMessageEvent).length;
    record.assistantMessageCount = events.filter(isUserVisibleAssistantMessageEvent).length;
    const toolCounts = logicalRuntimeSessionToolCounts(events);
    record.toolCallCount = toolCounts.toolCallCount;
    record.toolResultCount = toolCounts.toolResultCount;
    record.byteSize = events.reduce((total, event) => total + event.byteSize, 0);
  }

}

function isUserVisibleUserMessageEvent(event: RuntimeSessionEvent): boolean {
  if (event.visibility || event.semanticRole) {
    return event.visibility === "user_visible"
      && (event.semanticRole === "user_message" || event.semanticRole === "user_visible_message");
  }
  return event.role === "user";
}

function isUserVisibleAssistantMessageEvent(event: RuntimeSessionEvent): boolean {
  if (event.visibility || event.semanticRole) {
    return event.visibility === "user_visible" && event.semanticRole === "assistant_visible_message";
  }
  return event.role === "assistant";
}
