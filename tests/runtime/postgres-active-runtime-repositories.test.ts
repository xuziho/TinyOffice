import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setImmediate as delayImmediate } from "node:timers/promises";

import { DbChannelTopicStore } from "../../src/channel-topics/storage/db-channel-topic-store.js";
import { PostgresChannelTopicStore } from "../../src/channel-topics/storage/postgres-channel-topic-store.js";
import { DbIntakeEventStore } from "../../src/intake/db-intake-event-store.js";
import { OperatingLogRepository } from "../../src/operating-log/operating-log-repository.js";
import {
  loadCompanyMemberDirectory,
} from "../../src/runtime/members/company-member-directory.js";
import type {
  PostgresMigrationClient,
  PostgresPoolLike,
} from "../../src/runtime/company-config/postgres-company-database.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { WorkDispatchLeaseRepository } from "../../src/work/work-dispatch-lease.js";
import { PostgresWorkRepository } from "../../src/work/postgres-work-repository.js";
import { WorkRepository } from "../../src/work/work-repository.js";

class FakeActiveRuntimePostgresClient implements PostgresMigrationClient {
  readonly queries: Array<{ sql: string; params?: readonly unknown[] }> = [];
  channelTopicRows: Array<Record<string, unknown>> = [];
  channelTopicHandoffRows: Array<Record<string, unknown>> = [];
  released = false;

  async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
    this.queries.push({ sql, params });
    if (/DELETE FROM channel_topic_handoffs/.test(sql)) {
      this.channelTopicHandoffRows = [];
    }
    if (/DELETE FROM channel_topics/.test(sql)) {
      this.channelTopicRows = [];
    }
    if (/INSERT INTO channel_topics/.test(sql) && params) {
      const row = {
        id: String(params[1]),
        title: String(params[2]),
        owner_member_id: String(params[3]),
        participant_member_ids_json: JSON.parse(String(params[4])) as unknown,
        room_id: params[5] === null ? undefined : String(params[5]),
        conversation_id: params[6] === null ? undefined : String(params[6]),
        chat_entry_id: params[7] === null ? undefined : String(params[7]),
        identity_source: String(params[8]),
        seen_cursors_json: JSON.parse(String(params[9])) as unknown,
        created_at: params[10],
        updated_at: params[10],
      };
      const index = this.channelTopicRows.findIndex((item) => item.id === row.id);
      if (index >= 0) {
        this.channelTopicRows[index] = row;
      } else {
        this.channelTopicRows.push(row);
      }
    }
    if (/INSERT INTO channel_topic_handoffs/.test(sql) && params) {
      const row = {
        id: String(params[1]),
        topic_id: String(params[2]),
        room_id: params[3] === null ? undefined : String(params[3]),
        conversation_id: params[4] === null ? undefined : String(params[4]),
        chat_entry_id: params[5] === null ? undefined : String(params[5]),
        action_id: params[6] === null ? undefined : String(params[6]),
        from_id: String(params[7]),
        to_id: String(params[8]),
        message: String(params[9]),
        created_at: params[10],
      };
      const index = this.channelTopicHandoffRows.findIndex((item) => item.id === row.id);
      if (index >= 0) {
        this.channelTopicHandoffRows[index] = row;
      } else {
        this.channelTopicHandoffRows.push(row);
      }
    }
    if (/SELECT id FROM schema_migrations/.test(sql)) {
      return { rows: [] as Row[] };
    }
    if (
      /SELECT \* FROM channel_topics/.test(sql)
    ) {
      return { rows: this.channelTopicRows as Row[] };
    }
    if (
      /SELECT \* FROM channel_topic_handoffs/.test(sql)
    ) {
      return { rows: this.channelTopicHandoffRows as Row[] };
    }
    if (
      /SELECT \* FROM (work_tasks|work_task_revisions|work_schedules|work_runs|work_run_events|work_dispatch_leases|intake_events|operating_events|governance_approvals|office_tool_audit_logs)/.test(sql) ||
      /SELECT \* FROM company_members/.test(sql)
    ) {
      return { rows: [] as Row[] };
    }
    return { rows: [] as Row[] };
  }

  release() {
    this.released = true;
  }
}

class FakeActiveRuntimePostgresPool implements PostgresPoolLike {
  readonly client = new FakeActiveRuntimePostgresClient();
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

interface MutableChannelTopicTables {
  channelTopicRows: Array<Record<string, unknown>>;
  channelTopicHandoffRows: Array<Record<string, unknown>>;
  queries?: string[];
}

class MutableChannelTopicPostgresClient implements PostgresMigrationClient {
  released = false;

  constructor(readonly tables: MutableChannelTopicTables) {}

  async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
    this.tables.queries?.push(sql);
    if (/SELECT \* FROM channel_topics/.test(sql)) {
      return {
        rows: this.tables.channelTopicRows.map((row) => ({ ...row })) as Row[],
      };
    }
    if (/SELECT \* FROM channel_topic_handoffs/.test(sql)) {
      return {
        rows: this.tables.channelTopicHandoffRows.map((row) => ({ ...row })) as Row[],
      };
    }
    if (/DELETE FROM channel_topic_handoffs/.test(sql)) {
      this.tables.channelTopicHandoffRows = [];
      return { rows: [] as Row[] };
    }
    if (/DELETE FROM channel_topics/.test(sql)) {
      this.tables.channelTopicRows = [];
      return { rows: [] as Row[] };
    }
    if (/INSERT INTO channel_topics/.test(sql) && params) {
      const row = {
        id: String(params[1]),
        title: String(params[2]),
        owner_member_id: String(params[3]),
        participant_member_ids_json: JSON.parse(String(params[4])) as unknown,
        room_id: params[5] === null ? undefined : String(params[5]),
        conversation_id: params[6] === null ? undefined : String(params[6]),
        chat_entry_id: params[7] === null ? undefined : String(params[7]),
        identity_source: String(params[8]),
        seen_cursors_json: JSON.parse(String(params[9])) as unknown,
        created_at: params[10],
        updated_at: params[10],
      };
      const index = this.tables.channelTopicRows.findIndex((item) => item.id === row.id);
      if (index >= 0) {
        this.tables.channelTopicRows[index] = row;
      } else {
        this.tables.channelTopicRows.push(row);
      }
      return { rows: [] as Row[] };
    }
    if (/INSERT INTO channel_topic_handoffs/.test(sql) && params) {
      const row = {
        id: String(params[1]),
        topic_id: String(params[2]),
        from_id: String(params[3]),
        to_id: String(params[4]),
        message: String(params[5]),
        created_at: params[6],
      };
      const index = this.tables.channelTopicHandoffRows.findIndex((item) => item.id === row.id);
      if (index >= 0) {
        this.tables.channelTopicHandoffRows[index] = row;
      } else {
        this.tables.channelTopicHandoffRows.push(row);
      }
      return { rows: [] as Row[] };
    }
    return { rows: [] as Row[] };
  }

  release() {
    this.released = true;
  }
}

class MutableChannelTopicPostgresPool implements PostgresPoolLike {
  ended = false;

  constructor(readonly tables: MutableChannelTopicTables) {}

  async connect() {
    return new MutableChannelTopicPostgresClient(this.tables);
  }

  async end() {
    this.ended = true;
  }
}

class DeferredWorkPostgresClient implements PostgresMigrationClient {
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

function postgresEnv() {
  return {
    COMPANY_DATABASE_BACKEND: "postgres",
    TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
  };
}

function defaultPostgresEnv() {
  return {
    TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
  };
}

function assertNoRetiredRuntimeTables(client: FakeActiveRuntimePostgresClient) {
  assert.equal(
    client.queries.some(({ sql }) =>
      /CREATE TABLE IF NOT EXISTS tasks\b|INSERT INTO tasks\b|responsibility_domains/.test(sql)
    ),
    false,
  );
}

test("postgres work repository open waits for each client query to settle", async () => {
  const client = new DeferredWorkPostgresClient();
  const pool = { async end() {} };
  const open = PostgresWorkRepository.open({ client, pool, companyId: DEFAULT_COMPANY_ID });
  open.catch(() => undefined);

  for (let expectedQueryCount = 1; expectedQueryCount <= 5; expectedQueryCount += 1) {
    await delayImmediate();
    assert.equal(client.queries.length, expectedQueryCount);
    client.resolveNext();
  }

  const repository = await open;
  repository.close();
  assert.equal(client.released, true);
});

test("postgres channel topic store open waits for each client query to settle", async () => {
  const client = new DeferredWorkPostgresClient();
  const pool = { async end() {} };
  const open = PostgresChannelTopicStore.open({ client, pool, companyId: DEFAULT_COMPANY_ID });
  open.catch(() => undefined);

  await delayImmediate();
  assert.equal(client.queries.length, 1);
  client.resolveNext();

  await delayImmediate();
  assert.equal(client.queries.length, 2);
  client.resolveNext();

  const store = await open;
  store.close();
  assert.equal(client.released, true);
});

test("postgres channel topic upsert sends participant ids as json text", async () => {
  const pool = new FakeActiveRuntimePostgresPool();
  const topicStore = await DbChannelTopicStore.open({
    repoRoot: "C:\\repo\\TinyOffice",
    companyId: DEFAULT_COMPANY_ID,
    env: postgresEnv(),
    createPostgresPool: () => pool,
  });

  await topicStore.save({
    channelTopics: [{
      id: "topic-json-param",
      ownerId: "mira-hr",
      participantIds: ["mira-hr", "iris-growth"],
      roomId: "conversation-topic-json-param",
      conversationId: "conversation-topic-json-param",
      identitySource: "tinyoffice_room",
      lastActivityAt: "2026-06-15T00:02:00.000Z",
    }],
    handoffs: [],
  });

  const upsert = pool.client.queries.find(({ sql }) => /^INSERT INTO channel_topics/.test(sql));
  assert.ok(upsert, "expected channel topic upsert query");
  assert.equal(upsert.params?.[4], JSON.stringify(["mira-hr", "iris-growth"]));
  assert.equal(upsert.params?.[8], "tinyoffice_room");
  assert.equal(upsert.params?.[9], "{}");
});

test("postgres channel topic store open maps timestamp rows to ISO strings", async () => {
  const pool = new FakeActiveRuntimePostgresPool();
  pool.client.channelTopicRows = [{
    id: "channel-topic-row-date",
    owner_member_id: "nora-automation",
    participant_member_ids_json: ["nora-automation"],
    updated_at: new Date("2026-06-05T10:40:37.000Z"),
  }];
  pool.client.channelTopicHandoffRows = [{
    id: "handoff-row-date",
    topic_id: "channel-topic-row-date",
    from_id: "nora-automation",
    to_id: "iris-growth",
    message: "Please continue.",
    created_at: new Date("2026-06-05T10:41:37.000Z"),
  }];

  const topicStore = await PostgresChannelTopicStore.open({
    client: pool.client,
    pool,
    companyId: DEFAULT_COMPANY_ID,
  });

  try {
    const state = await topicStore.load();
    assert.equal(state.channelTopics[0]?.lastActivityAt, "2026-06-05T10:40:37.000Z");
    assert.equal(state.handoffs[0]?.createdAt, "2026-06-05T10:41:37.000Z");
  } finally {
    topicStore.close();
  }
});

test("postgres channel topic store refreshes rows before update so stale instances do not delete newer topics or handoffs", async () => {
  const tables: MutableChannelTopicTables = {
    channelTopicRows: [{
      id: "channel-topic-existing",
      owner_member_id: "nora-automation",
      participant_member_ids_json: ["nora-automation"],
      updated_at: new Date("2026-06-15T00:00:00.000Z"),
    }],
    channelTopicHandoffRows: [],
  };
  const firstStore = await PostgresChannelTopicStore.open({
    client: new MutableChannelTopicPostgresClient(tables),
    pool: new MutableChannelTopicPostgresPool(tables),
    companyId: DEFAULT_COMPANY_ID,
  });
  const staleStore = await PostgresChannelTopicStore.open({
    client: new MutableChannelTopicPostgresClient(tables),
    pool: new MutableChannelTopicPostgresPool(tables),
    companyId: DEFAULT_COMPANY_ID,
  });

  try {
    await firstStore.update((state) => {
      state.channelTopics.push({
        id: "channel-topic-newer",
        ownerId: "iris-growth",
        participantIds: ["iris-growth", "nora-automation"],
        lastActivityAt: "2026-06-15T00:01:00.000Z",
      });
      state.handoffs.push({
        id: "handoff-newer",
        topicId: "channel-topic-newer",
        fromId: "iris-growth",
        toId: "nora-automation",
        message: "Please continue.",
        createdAt: "2026-06-15T00:01:30.000Z",
      });
    });

    await staleStore.update((state) => {
      const existing = state.channelTopics.find((topic) => topic.id === "channel-topic-existing");
      assert.ok(existing, "expected existing imported topic");
      existing.participantIds = [...existing.participantIds, "mira-hr"];
      existing.lastActivityAt = "2026-06-15T00:02:00.000Z";
    });

    assert.deepEqual(
      tables.channelTopicRows.map((row) => row.id).sort(),
      ["channel-topic-existing", "channel-topic-newer"],
    );
    assert.deepEqual(
      tables.channelTopicHandoffRows.map((row) => row.id),
      ["handoff-newer"],
    );
  } finally {
    firstStore.close();
    staleStore.close();
  }
});

test("postgres channel topic save does not delete imported topics that are outside the saved slice", async () => {
  const tables: MutableChannelTopicTables = {
    channelTopicRows: [{
      id: "channel-topic-imported",
      owner_member_id: "nora-automation",
      participant_member_ids_json: ["nora-automation"],
      updated_at: new Date("2026-06-15T00:00:00.000Z"),
    }],
    channelTopicHandoffRows: [],
    channelTopicBindings: new Map([
      ["root-imported", "channel-topic-imported"],
    ]),
    queries: [],
  };
  const topicStore = await PostgresChannelTopicStore.open({
    client: new MutableChannelTopicPostgresClient(tables),
    pool: new MutableChannelTopicPostgresPool(tables),
    companyId: DEFAULT_COMPANY_ID,
  });

  try {
    await topicStore.save({
      channelTopics: [{
        id: "channel-topic-new-slice",
        ownerId: "iris-growth",
        participantIds: ["iris-growth"],
        lastActivityAt: "2026-06-15T00:01:00.000Z",
      }],
      handoffs: [],
    });

    assert.deepEqual(
      tables.channelTopicRows.map((row) => row.id).sort(),
      ["channel-topic-imported", "channel-topic-new-slice"],
    );
    const missingBindings = Array.from(tables.channelTopicBindings ?? [])
      .filter(([, topicId]) => !tables.channelTopicRows.some((row) => row.id === topicId));
    assert.deepEqual(missingBindings, []);
    assert.equal(
      tables.queries?.some((sql) => /DELETE FROM channel_topic/.test(sql)),
      false,
    );
  } finally {
    topicStore.close();
  }
});

test("work repositories use postgres backend for active work tasks, schedules, runs, events, and leases", async () => {
  const pool = new FakeActiveRuntimePostgresPool();
  const repository = await WorkRepository.open("C:\\repo\\TinyOffice", {
    companyId: DEFAULT_COMPANY_ID,
    env: postgresEnv(),
    createPostgresPool: () => pool,
  });

  try {
    const task = repository.createWorkTask({
      id: "work-task-1",
      title: "Review registration drop",
      status: "active",
      createdByMemberId: "nora-automation",
      ownerMemberId: "iris-growth",
      sourceKind: "chat_request",
      sourceId: "post-1",
      acceptanceCriteria: "Findings are posted.",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    });
    repository.createWorkSchedule({
      id: "work-schedule-1",
      workTaskId: task.id,
      status: "enabled",
      kind: "immediate",
      runCount: 0,
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    });
    const run = repository.createWorkRun({
      id: "work-run-1",
      workTaskId: task.id,
      status: "queued",
      assigneeMemberId: "iris-growth",
      triggeredBy: "immediate",
      createdAt: "2026-06-15T00:01:00.000Z",
      updatedAt: "2026-06-15T00:01:00.000Z",
    });
    repository.appendWorkRunEvent({
      id: "work-run-event-1",
      workRunId: run.id,
      timestamp: "2026-06-15T00:02:00.000Z",
      actorMemberId: "iris-growth",
      eventType: "created",
      summary: "Queued for execution.",
      metadata: { source: "test" },
    });

    assert.equal(repository.getWorkTask(task.id)?.acceptanceCriteria, "Findings are posted.");
    assert.equal(repository.getWorkRun(run.id)?.status, "queued");
    assert.equal(repository.listWorkRunEvents(run.id).length, 1);
    await repository.save();
  } finally {
    repository.close();
  }

  const leaseRepository = await WorkDispatchLeaseRepository.open("C:\\repo\\TinyOffice", {
    companyId: DEFAULT_COMPANY_ID,
    env: postgresEnv(),
    createPostgresPool: () => pool,
  });
  try {
    const lease = leaseRepository.createLease({
      id: "lease-1",
      workRunId: "work-run-1",
      assigneeMemberId: "iris-growth",
      sessionKey: "iris-growth|work_run_execution|work-run-1",
      dispatchedAt: "2026-06-15T00:03:00.000Z",
      expiresAt: "2026-06-15T00:05:00.000Z",
      createdBy: "dispatcher",
    });
    leaseRepository.updateLease({
      leaseId: lease.id,
      status: "acknowledged",
      acknowledgedAt: "2026-06-15T00:03:30.000Z",
    });
    assert.equal(leaseRepository.getLatestLeaseForWorkRun("work-run-1")?.status, "acknowledged");
    await leaseRepository.save();
  } finally {
    leaseRepository.close();
  }

  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO work_tasks/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO work_schedules/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO work_runs/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO work_run_events/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO work_dispatch_leases/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^UPDATE work_dispatch_leases/.test(sql)));
  assertNoRetiredRuntimeTables(pool.client);
});

test("active runtime repositories use postgres backend by default", async () => {
  const pool = new FakeActiveRuntimePostgresPool();
  const repository = await WorkRepository.open("C:\\repo\\TinyOffice", {
    companyId: DEFAULT_COMPANY_ID,
    env: defaultPostgresEnv(),
    createPostgresPool: (databaseUrl) => {
      assert.equal(databaseUrl, "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice");
      return pool;
    },
  });

  try {
    const task = repository.createWorkTask({
      id: "work-task-default-postgres",
      title: "Default backend check",
      status: "active",
      createdByMemberId: "nora-automation",
      ownerMemberId: "iris-growth",
      sourceKind: "chat_request",
      sourceId: "post-default",
      acceptanceCriteria: "The task is persisted.",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    });
    repository.createWorkSchedule({
      id: "work-schedule-default-postgres",
      workTaskId: task.id,
      status: "enabled",
      kind: "immediate",
      runCount: 0,
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    });
    await repository.save();
  } finally {
    repository.close();
  }

  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO work_tasks/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO work_schedules/.test(sql)));
});

test("intake operating log and channel topic stores use postgres backend", async () => {
  const pool = new FakeActiveRuntimePostgresPool();
  const createPostgresPool = () => pool;

  const intake = await DbIntakeEventStore.open({
    repoRoot: "C:\\repo\\TinyOffice",
    companyId: DEFAULT_COMPANY_ID,
    env: postgresEnv(),
    createPostgresPool,
  });
  try {
    await intake.save({
      events: [{
        id: "intake-event-1",
        receivedAt: "2026-06-15T00:00:00.000Z",
        status: "processed",
        input: {
          schemaVersion: "2026-06-14",
          source: "article-quality-bot",
          sourceEventId: "article-1",
          category: "website.article_audit",
          routing: { targetMemberId: "quality-editor" },
          payload: { postId: 1591 },
        },
      }],
    });
  } finally {
    intake.close();
  }

  const operatingLog = await OperatingLogRepository.open("C:\\repo\\TinyOffice", {
    companyId: DEFAULT_COMPANY_ID,
    env: postgresEnv(),
    createPostgresPool,
  });
  try {
    operatingLog.appendEvent({
      id: "op-1",
      timestamp: "2026-06-15T00:01:00.000Z",
      actorMemberId: "quality-editor",
      category: "website.article_audit",
      severity: "info",
      title: "Article report received",
      message: "The intake event was triaged.",
      source: { intakeEventId: "intake-event-1" },
    });
    assert.equal(operatingLog.listEvents({ category: "website.article_audit" }).length, 1);
    await operatingLog.save();
  } finally {
    operatingLog.close();
  }

  const topicStore = await DbChannelTopicStore.open({
    repoRoot: "C:\\repo\\TinyOffice",
    companyId: DEFAULT_COMPANY_ID,
    env: postgresEnv(),
    createPostgresPool,
  });
  await topicStore.save({
    channelTopics: [{
      id: "topic-1",
      ownerId: "mira-hr",
      participantIds: ["mira-hr", "iris-growth"],
      lastActivityAt: "2026-06-15T00:02:00.000Z",
    }],
    handoffs: [{
      id: "handoff-1",
      topicId: "topic-1",
      fromId: "mira-hr",
      toId: "iris-growth",
      message: "Please continue.",
      createdAt: "2026-06-15T00:03:00.000Z",
    }],
  });
  assert.equal((await topicStore.load()).handoffs.length, 1);

  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO intake_events/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO operating_events/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO channel_topics/.test(sql)));
  assert.ok(pool.client.queries.some(({ sql }) => /^INSERT INTO channel_topic_handoffs/.test(sql)));
  assertNoRetiredRuntimeTables(pool.client);
});

test("company members use postgres backend without live cutover side effects", async () => {
  const pool = new FakeActiveRuntimePostgresPool();
  const createPostgresPool = () => pool;

  const members = await loadCompanyMemberDirectory(
    "C:\\repo\\TinyOffice",
    {
      companyId: DEFAULT_COMPANY_ID,
      env: postgresEnv(),
      createPostgresPool,
    },
  );
  assert.deepEqual(members.members, []);

  assert.ok(pool.client.queries.some(({ sql }) => /FROM company_members/.test(sql)));
  assertNoRetiredRuntimeTables(pool.client);
});

test("active runtime repository default backend fails fast without database url", async () => {
  await assert.rejects(
      () => WorkRepository.open("C:\\repo\\TinyOffice", {
        companyId: DEFAULT_COMPANY_ID,
        env: {},
      createPostgresPool: () => new FakeActiveRuntimePostgresPool(),
    }),
    /TINYOFFICE_DATABASE_URL is required for the default PostgreSQL runtime backend/,
  );
});
