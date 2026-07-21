import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import {
  openConfiguredPostgresConnection,
  releaseCompanyPostgresConnection,
} from "../company-config/postgres-runtime-connection.js";

export interface ProcessTraceStoreQuery {
  processTraceId?: string;
  sessionKey?: string;
  channelTopicId?: string;
  conversationId?: string;
  messageId?: string;
  sourceMessageId?: string;
  chatEntryId?: string;
  runId?: string;
  workTaskId?: string;
  workRunId?: string;
  employeeId?: string;
  since?: string;
  limit?: number;
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function timestampValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const text = String(value);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function processTraceEventFromPostgresRow(row: Record<string, unknown>): ProcessTraceEvent {
  return {
    id: String(row.id),
    timestamp: timestampValue(row.timestamp),
    sessionKey: String(row.session_key),
    runId: optional(row.run_id),
    sequenceInRun: optionalNumber(row.sequence_in_run),
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

export async function appendProcessTraceEventBatch(
  repoRoot: string,
  companyId: string,
  events: ProcessTraceEvent[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  const connection = await openConfiguredPostgresConnection(repoRoot, { companyId });
  if (!connection) {
    throw new Error("Process Trace requires PostgreSQL runtime configuration.");
  }
  try {
    const columnCount = 20;
    const values: unknown[] = [];
    const rows = events.map((event, eventIndex) => {
      const offset = eventIndex * columnCount;
      values.push(
        companyId,
        event.id,
        event.timestamp,
        event.sessionKey,
        event.runId ?? null,
        event.sequenceInRun ?? null,
        event.conversationId ?? null,
        event.messageId ?? null,
        event.sourceMessageId ?? null,
        event.chatEntryId ?? null,
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
      );
      return `(${Array.from({ length: columnCount }, (_, index) => `$${offset + index + 1}`).join(", ")})`;
    });
    await connection.client.query(
      `INSERT INTO process_trace_events (
  company_id, id, timestamp, session_key, run_id, sequence_in_run,
  conversation_id, message_id, source_message_id, chat_entry_id,
  channel_topic_id, work_task_id, work_run_id, employee_id,
  kind, title, summary, status, preview, payload_json
)
VALUES ${rows.join(",\n")}
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
      values,
    );
  } finally {
    releaseCompanyPostgresConnection(connection);
  }
}

export async function queryProcessTraceEvents(
  repoRoot: string,
  companyId: string,
  query: ProcessTraceStoreQuery = {},
): Promise<ProcessTraceEvent[]> {
  const connection = await openConfiguredPostgresConnection(repoRoot, { companyId });
  if (!connection) {
    throw new Error("Process Trace requires PostgreSQL runtime configuration.");
  }
  try {
    const params: unknown[] = [companyId];
    const predicates = ["company_id = $1"];
    const addPredicate = (column: string, value: unknown, operator = "=") => {
      if (value === undefined) {
        return;
      }
      params.push(value);
      predicates.push(`${column} ${operator} $${params.length}`);
    };
    addPredicate("id", query.processTraceId);
    addPredicate("session_key", query.sessionKey);
    addPredicate("channel_topic_id", query.channelTopicId);
    addPredicate("conversation_id", query.conversationId);
    addPredicate("message_id", query.messageId);
    addPredicate("source_message_id", query.sourceMessageId);
    addPredicate("chat_entry_id", query.chatEntryId);
    addPredicate("run_id", query.runId);
    addPredicate("work_task_id", query.workTaskId);
    addPredicate("work_run_id", query.workRunId);
    addPredicate("employee_id", query.employeeId);
    addPredicate("timestamp", query.since, ">=");

    let sql = `SELECT * FROM process_trace_events WHERE ${predicates.join(" AND ")}`;
    if (query.limit && query.limit > 0) {
      params.push(Math.floor(query.limit));
      sql = `SELECT * FROM (${sql} ORDER BY timestamp DESC, id DESC LIMIT $${params.length}) recent
ORDER BY timestamp ASC, id ASC`;
    } else {
      sql += " ORDER BY timestamp ASC, id ASC";
    }
    const result = await connection.client.query(sql, params);
    return result.rows.map(processTraceEventFromPostgresRow);
  } finally {
    releaseCompanyPostgresConnection(connection);
  }
}
