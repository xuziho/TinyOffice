import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as delayImmediate } from "node:timers/promises";

import {
  RuntimeSessionRepository,
} from "../../src/runtime/storage/runtime-session-repository.js";
import { PostgresRuntimeSessionRepository } from "../../src/runtime/storage/postgres-runtime-session-repository.js";
import type {
  PostgresMigrationClient,
  PostgresPoolLike,
} from "../../src/runtime/company-config/postgres-company-database.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";

class FakeRuntimePostgresClient implements PostgresMigrationClient {
  readonly queries: Array<{ sql: string; params?: readonly unknown[] }> = [];
  released = false;

  async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
    this.queries.push({ sql, params });
    if (/SELECT id FROM schema_migrations/.test(sql)) {
      return { rows: [] as Row[] };
    }
    if (/SELECT \* FROM (session_records|session_events|process_trace_events|collaboration_action_events|memory_summaries|runtime_storage_retention_state)/.test(sql)) {
      return { rows: [] as Row[] };
    }
    return { rows: [] as Row[] };
  }

  release() {
    this.released = true;
  }
}

class FakeRuntimePostgresPool implements PostgresPoolLike {
  readonly client = new FakeRuntimePostgresClient();
  connectCount = 0;
  ended = false;

  async connect() {
    this.connectCount += 1;
    return this.client;
  }

  async end() {
    this.ended = true;
  }
}

class DeferredRuntimePostgresClient implements PostgresMigrationClient {
  readonly queries: string[] = [];
  readonly resolvers: Array<() => void> = [];
  released = false;
  private active = false;

  async query<Row = Record<string, unknown>>(sql: string) {
    this.queries.push(sql);
    if (this.active) {
      throw new Error("query called before previous query settled");
    }
    this.active = true;
    return new Promise<{ rows: Row[] }>((resolve) => {
      this.resolvers.push(() => {
        this.active = false;
        resolve({ rows: [] });
      });
    });
  }

  resolveNext() {
    const resolve = this.resolvers.shift();
    assert.ok(resolve, "expected a pending query to resolve");
    resolve();
  }

  release() {
    this.released = true;
  }
}

class DateReturningRuntimePostgresClient implements PostgresMigrationClient {
  readonly queries: Array<{ sql: string; params?: readonly unknown[] }> = [];
  released = false;

  async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
    this.queries.push({ sql, params });
    if (/SELECT \* FROM session_records/.test(sql)) {
      return {
        rows: [{
          id: "session-record-date",
          employee_id: "mira-hr",
          session_key: "mira-hr|chat_topic_room|conversation-date",
          session_id: "pi-session-date",
          scene_type: "chat_topic_room",
          channel_topic_id: "topic-date",
          work_run_id: null,
          requester_id: "xuziho",
          model_provider: "openai",
          model_id: "gpt-5-mini",
          status: "completed",
          title: null,
          summary: null,
          started_at: new Date("2026-06-15T02:00:00.000Z"),
          updated_at: new Date("2026-06-15T02:03:04.000Z"),
          event_count: 1,
          user_message_count: 0,
          assistant_message_count: 1,
          tool_call_count: 0,
          tool_result_count: 0,
          token_input_total: 0,
          token_output_total: 0,
          byte_size: 0,
          truncated: false,
        }] as Row[],
      };
    }
    if (/SELECT \* FROM session_events/.test(sql)) {
      return {
        rows: [{
          id: "session-event-date",
          session_record_id: "session-record-date",
          sequence: 1,
          timestamp: new Date("2026-06-15T02:03:04.000Z"),
          kind: "assistant_message",
          role: "assistant",
          title: null,
          summary: null,
          preview: "Mira completed the reply.",
          payload_json: null,
          byte_size: 24,
          truncated: false,
        }] as Row[],
      };
    }
    if (/SELECT \* FROM process_trace_events/.test(sql)) {
      return { rows: [] as Row[] };
    }
    if (/SELECT \* FROM collaboration_action_events/.test(sql)) {
      return { rows: [] as Row[] };
    }
    if (/SELECT \* FROM memory_summaries/.test(sql)) {
      return { rows: [] as Row[] };
    }
    if (/SELECT \* FROM runtime_storage_retention_state/.test(sql)) {
      return { rows: [] as Row[] };
    }
    if (/INSERT INTO session_records|INSERT INTO session_events/.test(sql)) {
      const invalidTimestamp = (params || []).find((value) =>
        typeof value === "string" && /^Mon |^Tue |^Wed |^Thu |^Fri |^Sat |^Sun /.test(value)
      );
      assert.equal(invalidTimestamp, undefined, "queued writes must not contain localized Date strings");
    }
    return { rows: [] as Row[] };
  }

  release() {
    this.released = true;
  }
}

test("postgres runtime session repository open waits for each client query to settle", async () => {
  const client = new DeferredRuntimePostgresClient();
  const pool = { async end() {} };
  const open = PostgresRuntimeSessionRepository.open({ client, pool, companyId: DEFAULT_COMPANY_ID });
  open.catch(() => undefined);

  for (let expectedQueryCount = 1; expectedQueryCount <= 6; expectedQueryCount += 1) {
    await delayImmediate();
    assert.equal(client.queries.length, expectedQueryCount);
    client.resolveNext();
  }

  const repository = await open;
  repository.close();
  assert.equal(client.released, true);
});

test("postgres runtime session repository loads only explicitly requested storage domains", async () => {
  const client = new FakeRuntimePostgresClient();
  const repository = await PostgresRuntimeSessionRepository.open({
    client,
    pool: { async end() {} },
    companyId: DEFAULT_COMPANY_ID,
    domains: ["sessions"],
  });

  try {
    const selects = client.queries.filter(({ sql }) => /^SELECT \* FROM/.test(sql));
    assert.equal(selects.length, 2);
    assert.match(selects[0]!.sql, /session_records/);
    assert.match(selects[1]!.sql, /session_events/);
    assert.equal(selects.some(({ sql }) => /process_trace_events|collaboration_action_events|memory_summaries|runtime_storage_retention_state/.test(sql)), false);
  } finally {
    repository.close();
  }
});

test("postgres runtime session repository scopes one runtime flush to one Session", async () => {
  const client = new FakeRuntimePostgresClient();
  const repository = await PostgresRuntimeSessionRepository.open({
    client,
    pool: { async end() {} },
    companyId: DEFAULT_COMPANY_ID,
    sessionRecordId: "session-record-focused",
  });

  try {
    const selects = client.queries.filter(({ sql }) => /^SELECT \* FROM/.test(sql));
    assert.equal(selects.length, 2);
    assert.match(selects[0]!.sql, /id = \$2/);
    assert.match(selects[1]!.sql, /session_record_id = \$2/);
    assert.deepEqual(selects[0]!.params, [DEFAULT_COMPANY_ID, "session-record-focused"]);
  } finally {
    repository.close();
  }
});

test("postgres runtime session repository normalizes pg Date timestamps to ISO before readback and save", async () => {
  const client = new DateReturningRuntimePostgresClient();
  const repository = await PostgresRuntimeSessionRepository.open({
    client,
    pool: { async end() {} },
    companyId: DEFAULT_COMPANY_ID,
  });

  try {
    const detail = repository.getSessionDetail("session-record-date");
    assert.ok(detail);
    assert.equal(detail.record.startedAt, "2026-06-15T02:00:00.000Z");
    assert.equal(detail.record.updatedAt, "2026-06-15T02:03:04.000Z");
    assert.equal(detail.events[0]?.timestamp, "2026-06-15T02:03:04.000Z");

    repository.upsertSessionRecord({
      id: detail.record.id,
      employeeId: detail.record.employeeId,
      sessionKey: detail.record.sessionKey,
      sessionId: detail.record.sessionId,
      sceneType: detail.record.sceneType,
      channelTopicId: detail.record.channelTopicId,
      requesterId: detail.record.requesterId,
      modelProvider: detail.record.modelProvider,
      modelId: detail.record.modelId,
      status: detail.record.status,
      title: detail.record.title,
      summary: detail.record.summary,
      startedAt: detail.record.startedAt,
      updatedAt: detail.record.updatedAt,
      eventCount: detail.record.eventCount,
      userMessageCount: detail.record.userMessageCount,
      assistantMessageCount: detail.record.assistantMessageCount,
      toolCallCount: detail.record.toolCallCount,
      toolResultCount: detail.record.toolResultCount,
      tokenInputTotal: detail.record.tokenInputTotal,
      tokenOutputTotal: detail.record.tokenOutputTotal,
      byteSize: detail.record.byteSize,
      truncated: detail.record.truncated,
    });
    repository.appendSessionEvent({
      id: "session-event-date-rewrite",
      sessionRecordId: detail.record.id,
      sequence: 2,
      timestamp: detail.record.updatedAt,
      kind: "assistant_message",
      role: "assistant",
      preview: "Mira reply stayed visible after save.",
    });

    await repository.save();
  } finally {
    repository.close();
  }

  const sessionRecordWrite = client.queries.find(({ sql }) => /^INSERT INTO session_records/.test(sql));
  assert.equal(sessionRecordWrite?.params?.[11], null);
  assert.equal(sessionRecordWrite?.params?.[12], "completed");
  assert.equal(sessionRecordWrite?.params?.[15], "2026-06-15T02:00:00.000Z");
  assert.equal(sessionRecordWrite?.params?.[16], "2026-06-15T02:03:04.000Z");
  assert.equal(client.released, true);
});

test("runtime session repository uses postgres pool for configured backend read and write paths", async () => {
  const pool = new FakeRuntimePostgresPool();
  const repository = await RuntimeSessionRepository.open("C:\\repo\\TinyOffice", {
    companyId: DEFAULT_COMPANY_ID,
    env: {
      COMPANY_DATABASE_BACKEND: "postgres",
      TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
    },
    createPostgresPool: (databaseUrl) => {
      assert.equal(databaseUrl, "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice");
      return pool;
    },
  });

  try {
    const session = repository.upsertSessionRecord({
      id: "session-record-1",
      employeeId: "mira-hr",
      sessionKey: "mira-hr|channel_thread|root-1",
      sessionId: "pi-session-1",
      sceneType: "channel_thread",
      channelTopicId: "topic-1",
      workRunId: "work-run-1",
      status: "running",
      startedAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:01:00.000Z",
    });

    repository.appendSessionEvent({
      id: "session-event-1",
      sessionRecordId: session.id,
      sequence: 1,
      timestamp: "2026-06-09T00:01:01.000Z",
      kind: "assistant_message",
      role: "assistant",
      sceneId: "mira-hr|channel_thread|root-1",
      turnId: "mira-hr|channel_thread|root-1|turn",
      runId: "session-record-1",
      modelCallId: "session-record-1|model_call|primary",
      source: "pi.employee_reply",
      visibility: "user_visible",
      semanticRole: "assistant_visible_message",
      rawEventKind: "assistant_message",
      payload: { text: "I will continue." },
      truncated: true,
    });
    repository.appendSessionEvent({
      id: "session-event-2",
      sessionRecordId: session.id,
      sequence: 2,
      timestamp: "2026-06-09T00:01:02.000Z",
      kind: "prompt_context",
      role: "user",
      source: "work_execution.work_run_context",
      visibility: "prompt_context",
      semanticRole: "work_run_context",
      rawEventKind: "prompt_context",
      preview: "WorkRun package",
      byteSize: 40,
    });
    repository.appendSessionEvent({
      id: "session-event-3",
      sessionRecordId: session.id,
      sequence: 3,
      timestamp: "2026-06-09T00:01:03.000Z",
      kind: "assistant_message",
      role: "assistant",
      source: "pi.lifecycle",
      visibility: "diagnostic",
      semanticRole: "model_output",
      rawEventKind: "assistant_message",
      preview: "message_end",
      byteSize: 40,
    });
    repository.appendProcessTraceEvent({
      id: "ptrace-1",
      timestamp: "2026-06-09T00:01:02.000Z",
      sessionKey: session.sessionKey,
      channelTopicId: "topic-1",
      workRunId: "work-run-1",
      employeeId: "mira-hr",
      kind: "tool_call",
      title: "Tool call",
      metadata: { tool: "handoff" },
    });
    repository.appendCollaborationActionEvent({
      id: "action-1",
      timestamp: "2026-06-09T00:01:03.000Z",
      employeeId: "mira-hr",
      actionName: "handoff",
      channelTopicId: "topic-1",
      workRunId: "work-run-1",
      status: "allowed",
      recipientId: "iris-growth",
      message: "Please continue.",
      emitted: true,
      payload: { type: "handoff", toId: "iris-growth" },
    });
    repository.upsertMemorySummary({
      id: "memory-1",
      createdAt: "2026-06-09T00:01:04.000Z",
      updatedAt: "2026-06-09T00:01:04.000Z",
      scopeKind: "work_run",
      scopeId: "work-run-1",
      employeeId: "mira-hr",
      sourceKind: "session",
      sourceId: session.id,
      category: "lesson",
      title: "Use handoff simply",
      summary: "Keep channel turn results as the core handoff semantics.",
      importance: 0.7,
      embeddingStatus: "not_requested",
    });

    const [listedSession] = repository.listSessionRecords({ employeeId: "mira-hr" });
    assert.ok(listedSession);
    assert.equal(listedSession.userMessageCount, 0);
    assert.equal(listedSession.assistantMessageCount, 1);
    const events = repository.getSessionDetail(session.id)?.events || [];
    assert.equal(events.length, 3);
    assert.equal(events[0]?.modelCallId, "session-record-1|model_call|primary");
    assert.equal(events[0]?.visibility, "user_visible");
    assert.equal(events[0]?.semanticRole, "assistant_visible_message");
    assert.equal(repository.listProcessTraceEvents({ workRunId: "work-run-1" }).length, 1);
    assert.equal(repository.listCollaborationActionEvents({ actionName: "handoff" }).length, 1);
    assert.equal(repository.listMemorySummaries({ employeeId: "mira-hr" }).length, 1);

    await repository.save();
  } finally {
    repository.close();
  }

  assert.equal(pool.connectCount, 1);
  assert.equal(pool.client.released, true);
  assert.equal(pool.ended, true);
  assert.ok(pool.client.queries.some(({ sql }) => /CREATE TABLE IF NOT EXISTS schema_migrations/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /SELECT \* FROM session_records/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO session_records/.test(sql)));
  const sessionEventInsert = pool.client.queries.find(({ sql }) => /^INSERT INTO session_events/.test(sql));
  assert.ok(sessionEventInsert);
  assert.match(sessionEventInsert.sql, /model_call_id/);
  assert.ok(sessionEventInsert.params?.includes("session-record-1|model_call|primary"));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO process_trace_events/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO collaboration_action_events/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO memory_summaries/.test(sql)));
  assert.equal(
    pool.client.queries.some(({ sql }) => /responsibility_domains|CREATE TABLE IF NOT EXISTS tasks\b/.test(sql)),
    false,
  );
});
