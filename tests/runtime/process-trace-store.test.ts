import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { beforeEach } from "node:test";

import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { createCompany } from "../../src/runtime/company-config/companies-admin.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import {
  ProcessTracePublisher,
  appendProcessTraceEvent,
  listProcessTraceEvents,
  projectProcessTraceNavigationEvent,
} from "../../src/runtime/realtime/process-trace-store.js";
import { resetRuntimePostgresTables } from "./postgres-test-utils.js";

beforeEach(resetRuntimePostgresTables);

async function createRepoRoot() {
  return mkdtemp(path.join(tmpdir(), "tinyoffice-process-trace-"));
}

async function touchRuntimeStore(repoRoot: string) {
  const directory = await CompanyDirectoryRepository.open(repoRoot, {
    companyId: DEFAULT_COMPANY_ID,
  });
  try {
    await directory.upsertEmployee({
      employeeId: "nora-automation",
      enabled: true,
      profile: {
        employeeId: "nora-automation",
        displayName: "Nora",
        role: "automation",
        presenceMode: "resident",
        mountedActions: [],
      },
      permissions: [],
      runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
    });
    await directory.save();
  } finally {
    directory.close();
  }
}

test("process trace events can be appended and queried by owned ids", async () => {
  const repoRoot = await createRepoRoot();

  await appendProcessTraceEvent(repoRoot, DEFAULT_COMPANY_ID, {
    id: "trace-owned-1",
    kind: "turn_received",
    sessionKey: "mira|chat_topic_room|conversation-1",
    workTaskId: "work-task-1",
    workRunId: "work-run-1",
    employeeId: "mira",
    title: "Turn received",
    status: "running",
    timestamp: "2026-06-09T00:00:01.000Z",
    metadata: {
      conversationId: "conversation-1",
      messageId: "message-1",
      chatEntryId: "chat-entry-1",
    },
  });
  await appendProcessTraceEvent(repoRoot, DEFAULT_COMPANY_ID, {
    kind: "turn_received",
    sessionKey: "iris|chat_topic_room|conversation-2",
    channelTopicId: "channel-topic-2",
    workRunId: "work-run-2",
    employeeId: "iris",
    title: "Turn received",
    status: "running",
    timestamp: "2026-06-09T00:00:02.000Z",
  });

  assert.equal((await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { sessionKey: "mira|chat_topic_room|conversation-1" })).length, 1);
  assert.equal((await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { sessionKey: "iris|chat_topic_room|conversation-2" })).length, 1);
  assert.equal((await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { channelTopicId: "channel-topic-2" })).length, 1);
  assert.equal((await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { processTraceId: "trace-owned-1" })).length, 1);
  assert.equal((await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { processTraceId: "trace-missing" })).length, 0);
  const ownedTrace = await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, {
    conversationId: "conversation-1",
    messageId: "message-1",
    chatEntryId: "chat-entry-1",
  });
  assert.equal(ownedTrace.length, 1);
  assert.equal(ownedTrace[0]?.id, "trace-owned-1");
  assert.equal(ownedTrace[0]?.channelTopicId, undefined);
  assert.equal((await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { workTaskId: "work-task-1" })).length, 1);
  assert.equal((await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { workRunId: "work-run-1" })).length, 1);
  assert.equal((await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { employeeId: "iris" })).length, 1);
  assert.deepEqual(
    (await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, {
      since: "2026-06-09T00:00:02.000Z",
    })).map((event) => event.sessionKey),
    ["iris|chat_topic_room|conversation-2"],
  );
  await assert.rejects(stat(path.join(repoRoot, ".scratch", "process-trace.jsonl")), {
    code: "ENOENT",
  });
});

test("process trace source message query keeps the full run lifecycle", async () => {
  const repoRoot = await createRepoRoot();

  await appendProcessTraceEvent(repoRoot, DEFAULT_COMPANY_ID, {
    id: "trace-source-started",
    kind: "employee_reply_started",
    sessionKey: "mira|chat_direct_room|conversation-1",
    employeeId: "mira",
    title: "Mira started a reply",
    status: "running",
    timestamp: "2026-06-09T00:00:01.000Z",
    metadata: {
      conversationId: "conversation-1",
      messageId: "message-source-1",
      sourceMessageId: "message-source-1",
      runId: "run-1",
    },
  });
  await appendProcessTraceEvent(repoRoot, DEFAULT_COMPANY_ID, {
    id: "trace-source-completed",
    kind: "turn_completed",
    sessionKey: "mira|chat_direct_room|conversation-1",
    employeeId: "mira",
    title: "Mira posted a reply",
    status: "succeeded",
    timestamp: "2026-06-09T00:00:03.000Z",
    metadata: {
      conversationId: "conversation-1",
      messageId: "message-reply-1",
      sourceMessageId: "message-source-1",
      replyMessageId: "message-reply-1",
      runId: "run-1",
    },
  });
  await appendProcessTraceEvent(repoRoot, DEFAULT_COMPANY_ID, {
    id: "trace-other-source-started",
    kind: "employee_reply_started",
    sessionKey: "mira|chat_direct_room|conversation-1",
    employeeId: "mira",
    title: "Mira started a different reply",
    status: "running",
    timestamp: "2026-06-09T00:00:04.000Z",
    metadata: {
      conversationId: "conversation-1",
      messageId: "message-source-2",
      sourceMessageId: "message-source-2",
      runId: "run-2",
    },
  });

  assert.deepEqual(
    (await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, {
      conversationId: "conversation-1",
      sourceMessageId: "message-source-1",
    })).map((event) => event.kind),
    ["employee_reply_started", "turn_completed"],
  );
});

test("process trace navigation projection uses owned runtime links", async () => {
  const repoRoot = await createRepoRoot();

  await appendProcessTraceEvent(repoRoot, DEFAULT_COMPANY_ID, {
    id: "trace-owned-navigation",
    kind: "turn_received",
    sessionKey: "nora|work_run_execution|work-run-owned-navigation",
    workTaskId: "work-task-owned-navigation",
    workRunId: "work-run-owned-navigation",
    employeeId: "nora",
    title: "Owned navigation trace",
    timestamp: "2026-06-09T00:00:03.000Z",
    metadata: {
      conversationId: "conversation-owned-navigation",
      messageId: "message-owned-navigation",
      chatEntryId: "chat-entry-owned-navigation",
    },
  });

  const [event] = await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, {
    processTraceId: "trace-owned-navigation",
  });
  assert.ok(event);
  const projected = projectProcessTraceNavigationEvent(event);

  assert.equal(projected.processTraceId, "trace-owned-navigation");
  assert.equal(projected.workTaskId, "work-task-owned-navigation");
  assert.equal(projected.workRunId, "work-run-owned-navigation");
  assert.equal(projected.conversationId, "conversation-owned-navigation");
  assert.equal(projected.messageId, "message-owned-navigation");
  assert.equal(projected.chatEntryId, "chat-entry-owned-navigation");
  assert.deepEqual(
    projected.runtimeLinks.map((link) => [
      link.kind,
      link.targetId,
      link.href,
      link.processTraceId,
      link.workTaskId,
      link.workRunId,
      link.conversationId,
      link.messageId,
      link.chatEntryId,
    ]),
    [
      [
        "process-trace",
        "trace-owned-navigation",
        "/api/process-trace?processTraceId=trace-owned-navigation",
        "trace-owned-navigation",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
      [
        "work-task",
        "work-task-owned-navigation",
        "/app/tasks?workTaskId=work-task-owned-navigation",
        "trace-owned-navigation",
        "work-task-owned-navigation",
        undefined,
        undefined,
        undefined,
        undefined,
      ],
      [
        "work-run",
        "work-run-owned-navigation",
        "/app/tasks?workTaskId=work-task-owned-navigation",
        "trace-owned-navigation",
        "work-task-owned-navigation",
        "work-run-owned-navigation",
        undefined,
        undefined,
        undefined,
      ],
      [
        "message",
        "message-owned-navigation",
        "/app/tasks/source/chat-message/conversation-owned-navigation%3Amessage-owned-navigation",
        "trace-owned-navigation",
        undefined,
        undefined,
        "conversation-owned-navigation",
        "message-owned-navigation",
        "chat-entry-owned-navigation",
      ],
      [
        "chat-entry",
        "chat-entry-owned-navigation",
        "/app/tasks/source/chat-entry/chat-entry-owned-navigation",
        "trace-owned-navigation",
        undefined,
        undefined,
        "conversation-owned-navigation",
        "message-owned-navigation",
        "chat-entry-owned-navigation",
      ],
    ],
  );
  assert.doesNotMatch(JSON.stringify(projected.runtimeLinks), /WorkPlan|workPlanId=/);
  assert.doesNotMatch(JSON.stringify(projected.runtimeLinks), /\b(rootPostId|channelTopicId|channelId)\b/);
});

test("process trace queries are isolated by company even when ids match", async () => {
  const repoRoot = await createRepoRoot();
  const otherCompanyId = "support-ops";
  await createCompany({
    repoRoot,
    companyId: otherCompanyId,
    displayName: "Support Ops",
  });

  await appendProcessTraceEvent(repoRoot, DEFAULT_COMPANY_ID, {
    id: "trace-shared-id",
    kind: "turn_received",
    sessionKey: "mira|chat_topic_room|conversation-shared",
    channelTopicId: "channel-topic-shared",
    employeeId: "mira",
    title: "Default company trace",
    status: "running",
    timestamp: "2026-06-09T00:00:01.000Z",
  });
  await appendProcessTraceEvent(repoRoot, otherCompanyId, {
    id: "trace-shared-id",
    kind: "turn_received",
    sessionKey: "mira|chat_topic_room|conversation-shared",
    channelTopicId: "channel-topic-shared",
    employeeId: "mira",
    title: "Support company trace",
    status: "running",
    timestamp: "2026-06-09T00:00:02.000Z",
  });

  assert.deepEqual(
    (await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { channelTopicId: "channel-topic-shared" })).map((event) => event.title),
    ["Default company trace"],
  );
  assert.deepEqual(
    (await listProcessTraceEvents(repoRoot, otherCompanyId, { channelTopicId: "channel-topic-shared" })).map((event) => event.title),
    ["Support company trace"],
  );
});

test("process trace appends retry when the runtime store changes before save", async () => {
  const repoRoot = await createRepoRoot();
  let touched = false;

  await appendProcessTraceEvent(
    repoRoot,
    DEFAULT_COMPANY_ID,
    {
      kind: "tool_activity",
      sessionKey: "nora|work_run_execution|work-run-1",
      workRunId: "work-run-1",
      employeeId: "nora",
      title: "WorkRun complete",
      status: "succeeded",
    },
    {
      beforeSave: async () => {
        if (!touched) {
          touched = true;
          await touchRuntimeStore(repoRoot);
        }
      },
    },
  );

  assert.equal(touched, true);
  const events = await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { workRunId: "work-run-1" });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.title, "WorkRun complete");
});

test("process trace ids stay unique for same-millisecond repeated events", async () => {
  const repoRoot = await createRepoRoot();
  const originalNow = Date.now;
  Date.now = () => 1781325718121;
  try {
    for (let index = 0; index < 3; index += 1) {
      await appendProcessTraceEvent(repoRoot, DEFAULT_COMPANY_ID, {
        kind: "model_action_plan",
        sessionKey: "mira|dm_thread|conversation-1",
        channelTopicId: "channel-topic-1",
        employeeId: "mira",
        title: `Phase ${index + 1}`,
        summary: `Summary ${index + 1}`,
        status: "succeeded",
      });
    }
  } finally {
    Date.now = originalNow;
  }

  const events = await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { channelTopicId: "channel-topic-1" });
  assert.equal(events.length, 3);
  assert.equal(new Set(events.map((event) => event.id)).size, 3);
  assert.deepEqual(events.map((event) => event.title), ["Phase 1", "Phase 2", "Phase 3"]);
});

test("process trace publisher serializes concurrent database writes", async () => {
  const repoRoot = await createRepoRoot();
  const publisher = new ProcessTracePublisher(repoRoot, DEFAULT_COMPANY_ID);

  await Promise.all(Array.from({ length: 8 }, (_, index) =>
    publisher.publish({
      kind: "model_action_plan",
      sessionKey: "mira|dm_thread|conversation-concurrent",
      channelTopicId: "channel-topic-concurrent",
      employeeId: "mira",
      title: `Concurrent phase ${index + 1}`,
      summary: `Concurrent summary ${index + 1}`,
      status: "succeeded",
    })
  ));
  await publisher.drain();

  const events = await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { channelTopicId: "channel-topic-concurrent" });
  assert.equal(events.length, 8);
  assert.deepEqual(
    events.map((event) => event.title).sort(),
    Array.from({ length: 8 }, (_, index) => `Concurrent phase ${index + 1}`).sort(),
  );
});

test("process trace publisher exposes observations before background persistence", async () => {
  const repoRoot = await createRepoRoot();
  const publisher = new ProcessTracePublisher(repoRoot, DEFAULT_COMPANY_ID);
  const observed: string[] = [];
  publisher.subscribe("*", (event) => observed.push(event.id));

  const event = await publisher.publish({
    id: "trace-live-before-persist",
    kind: "employee_reply_started",
    sessionKey: "mira|chat_direct_room|conversation-live",
    employeeId: "mira",
    title: "Live run started",
  });

  assert.deepEqual(observed, [event.id]);
  assert.equal(publisher.writerSnapshot().queued, 1);
  await publisher.drain();
  assert.equal(publisher.writerSnapshot().queued, 0);
  assert.equal(publisher.writerSnapshot().persisted, 1);
});

test("process trace evidence writer drains a dense 100-event run in bounded batches", async () => {
  const repoRoot = await createRepoRoot();
  const publisher = new ProcessTracePublisher(repoRoot, DEFAULT_COMPANY_ID);

  await Promise.all(Array.from({ length: 100 }, (_, index) => publisher.publish({
    id: `trace-dense-${index + 1}`,
    kind: "progress_update",
    sessionKey: "mira|chat_direct_room|conversation-dense",
    runId: "run-dense",
    sequenceInRun: index + 1,
    conversationId: "conversation-dense",
    sourceMessageId: "message-dense",
    employeeId: "mira",
    title: `Progress ${index + 1}`,
  })));
  await publisher.drain();

  const snapshot = publisher.writerSnapshot();
  assert.equal(snapshot.queued, 0);
  assert.equal(snapshot.inFlight, 0);
  assert.equal(snapshot.persisted, 100);
  assert.equal(snapshot.failed, 0);
  assert.equal((await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { runId: "run-dense" })).length, 100);
});

test("process trace publisher stores events and notifies matching subscribers", async () => {
  const repoRoot = await createRepoRoot();
  const publisher = new ProcessTracePublisher(repoRoot, DEFAULT_COMPANY_ID);
  const received: unknown[] = [];

  const unsubscribe = publisher.subscribe("mira|chat_topic_room|conversation-1", (event) => {
    received.push(event);
  });

  await publisher.publish({
    kind: "employee_reply_started",
    sessionKey: "mira|chat_topic_room|conversation-1",
    channelTopicId: "channel-topic-1",
    employeeId: "mira",
    title: "Mira is preparing a reply",
    metadata: {
      authorization: "Bearer secret-token-value",
      nested: {
        apiKey: "sk-abcdefghijklmnop",
      },
    },
  });
  unsubscribe();
  await publisher.publish({
    kind: "turn_completed",
    sessionKey: "mira|chat_topic_room|conversation-1",
    channelTopicId: "channel-topic-1",
    employeeId: "mira",
    title: "Turn returned_to_user",
  });
  await publisher.drain();

  assert.equal(received.length, 1);
  const events = await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, { channelTopicId: "channel-topic-1" });
  assert.equal(events.length, 2);
  const started = events.find((event) => event.kind === "employee_reply_started");
  assert.equal(started?.metadata?.authorization, "<redacted>");
  assert.deepEqual(started?.metadata?.nested, { apiKey: "<redacted>" });
});

test("process trace publisher notifies wildcard subscribers for side-panel streams", async () => {
  const repoRoot = await createRepoRoot();
  const publisher = new ProcessTracePublisher(repoRoot, DEFAULT_COMPANY_ID);
  const received: string[] = [];

  const unsubscribe = publisher.subscribe("*", (event) => {
    received.push(event.sessionKey);
  });

  await publisher.publish({
    kind: "target_resolved",
    sessionKey: "mira|chat_topic_room|conversation-1",
    channelTopicId: "channel-topic-1",
    employeeId: "mira",
    title: "Routed to Mira",
  });
  await publisher.publish({
    kind: "target_resolved",
    sessionKey: "iris|chat_topic_room|conversation-2",
    channelTopicId: "channel-topic-2",
    employeeId: "iris",
    title: "Routed to Iris",
  });
  unsubscribe();
  await publisher.drain();

  assert.deepEqual(received, [
    "mira|chat_topic_room|conversation-1",
    "iris|chat_topic_room|conversation-2",
  ]);
});
