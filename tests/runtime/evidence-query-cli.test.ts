import assert from "node:assert/strict";
import test from "node:test";

import {
  parseEvidenceQueryCliArgs,
  runEvidenceQueryCli,
} from "../../src/cli/evidence-query-cli.js";
import {
  runEvidenceQuery,
  type EvidenceQueryRepositories,
} from "../../src/runtime/evidence-query/evidence-query-service.js";

const generatedAt = "2026-06-21T10:00:00.000Z";

function createRepositories(): EvidenceQueryRepositories {
  const employees = [
    {
      employeeId: "iris-growth",
      enabled: true,
      profile: {
        employeeId: "iris-growth",
        displayName: "Smoke Runtime Member",
        role: "growth",
        presenceMode: "resident" as const,
      },
      resourcePolicy: { version: 1, resources: [] },
      runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-mini", thinkingLevel: "minimal" as const },
    },
  ];
  const workTask = {
    id: "work-task-1",
    title: "Investigate onboarding drop",
    status: "active" as const,
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request" as const,
    sourceId: "post-1",
    acceptanceCriteria: "Find the drop.",
    createdAt: "2026-06-21T09:00:00.000Z",
    updatedAt: "2026-06-21T09:05:00.000Z",
  };
  const workRun = {
    id: "work-run-1",
    workTaskId: workTask.id,
    status: "blocked" as const,
    assigneeMemberId: "iris-growth",
    triggeredBy: "immediate" as const,
    blockedReason: "Need analytics approval.",
    createdAt: "2026-06-21T09:01:00.000Z",
    updatedAt: "2026-06-21T09:10:00.000Z",
  };
  const workRunEvent = {
    id: "work-run-event-1",
    workRunId: workRun.id,
    timestamp: "2026-06-21T09:10:00.000Z",
    actorMemberId: "iris-growth",
    eventType: "blocked",
    summary: "Blocked on analytics access.",
  };
  const sessionRecord = {
    id: "session-record-1",
    memberId: "iris-growth",
    sessionKey: "iris-growth|work_run_execution|work-run-1",
    sessionId: "pi-session-1",
    sceneType: "work_run_execution",
    workRunId: workRun.id,
    status: "completed" as const,
    title: "Onboarding work run",
    startedAt: "2026-06-21T09:02:00.000Z",
    updatedAt: "2026-06-21T09:12:00.000Z",
    eventCount: 3,
    userMessageCount: 1,
    assistantMessageCount: 1,
    toolCallCount: 1,
    toolResultCount: 0,
    tokenInputTotal: 100,
    tokenOutputTotal: 20,
    tokenCacheTotal: 0,
    byteSize: 300,
    truncated: false,
  };
  const sessionEvents = [
    {
      id: "session-event-1",
      sessionRecordId: sessionRecord.id,
      sequence: 1,
      timestamp: "2026-06-21T09:03:00.000Z",
      kind: "user_message",
      role: "user",
      visibility: "user_visible" as const,
      semanticRole: "user_message",
      preview: "Why is onboarding down?",
      byteSize: 50,
      truncated: false,
    },
    {
      id: "session-event-2",
      sessionRecordId: sessionRecord.id,
      sequence: 2,
      timestamp: "2026-06-21T09:04:00.000Z",
      kind: "prompt_context",
      visibility: "prompt_context" as const,
      semanticRole: "work_run_context",
      preview: "WorkRun package",
      payload: { workRunId: workRun.id },
      byteSize: 100,
      truncated: false,
    },
    {
      id: "session-event-3",
      sessionRecordId: sessionRecord.id,
      sequence: 3,
      timestamp: "2026-06-21T09:05:00.000Z",
      kind: "assistant_message",
      role: "assistant",
      visibility: "user_visible" as const,
      semanticRole: "assistant_visible_message",
      preview: "I need analytics approval.",
      byteSize: 75,
      truncated: false,
    },
  ];
  const traceEvent = {
    id: "trace-1",
    timestamp: "2026-06-21T09:06:00.000Z",
    kind: "progress_update" as const,
    sessionKey: sessionRecord.sessionKey,
    workTaskId: workTask.id,
    workRunId: workRun.id,
    employeeId: "iris-growth",
    title: "Progress update",
    summary: "Found blocker.",
    status: "running" as const,
  };
  const actionEvent = {
    id: "action-1",
    timestamp: "2026-06-21T09:07:00.000Z",
    employeeId: "iris-growth",
    actionName: "progress",
    workRunId: workRun.id,
    status: "allowed",
    emitted: true,
    progressSummary: "Blocked on analytics access.",
  };
  const approval = {
    id: "approval-1",
    contextKind: "work_run" as const,
    contextId: workRun.id,
    sessionKey: sessionRecord.sessionKey,
    requestedByMemberId: "iris-growth",
    requestedAction: "read",
    requestedResource: "analytics",
    status: "pending" as const,
    reason: "Need analytics access.",
    createdAt: "2026-06-21T09:08:00.000Z",
    updatedAt: "2026-06-21T09:08:00.000Z",
  };
  const grant = {
    id: "grant-1",
    approvalId: approval.id,
    memberId: "iris-growth",
    action: "read",
    resource: "analytics",
    scope: "work_run" as const,
    contextKind: "work_run" as const,
    contextId: workRun.id,
    createdAt: "2026-06-21T09:09:00.000Z",
  };
  const intakeEvent = {
    id: "intake-1",
    receivedAt: "2026-06-21T08:55:00.000Z",
    processedAt: "2026-06-21T08:56:00.000Z",
    status: "processed" as const,
    input: {
      schemaVersion: "1",
      source: "owned_chat",
      sourceEventId: "source-1",
      category: "request",
      routing: { targetMemberId: "iris-growth" },
      summary: "Investigate onboarding.",
      payload: { text: "Investigate onboarding." },
    },
    result: { kind: "work_created", workRunId: workRun.id },
  };
  const operatingEvent = {
    id: "ops-1",
    timestamp: "2026-06-21T09:11:00.000Z",
    actorMemberId: "iris-growth",
    category: "runtime",
    severity: "warning" as const,
    title: "Approval required",
    message: "Analytics access was blocked.",
    source: { kind: "work_run", id: workRun.id },
  };

  return {
    directory: {
      loadEmployees: async () => employees,
      close() {},
    },
    work: {
      getWorkTask: (id: string) => id === workTask.id ? workTask : undefined,
      listWorkTasks: () => [workTask],
      listWorkRuns: (input = {}) => input.assigneeMemberId === "iris-growth" && input.status === "blocked"
        ? [workRun]
        : [workRun],
      getWorkRun: (id: string) => id === workRun.id ? workRun : undefined,
      listWorkRunEvents: (id: string) => id === workRun.id ? [workRunEvent] : [],
      close() {},
    },
    runtime: {
      getSessionRecord: (id: string) => id === sessionRecord.id ? sessionRecord : undefined,
      getSessionDetail: (id: string) => id === sessionRecord.id ? { record: sessionRecord, events: sessionEvents } : undefined,
      listSessionRecords: () => [sessionRecord],
      listSessionEvents: (id: string) => id === sessionRecord.id ? sessionEvents : [],
      listProcessTraceEvents: () => [traceEvent],
      listCollaborationActionEvents: () => [actionEvent],
      listMemorySummaries: () => [],
      close() {},
    },
    governance: {
      list: async () => [approval],
      listGrants: async () => [grant],
    },
    intake: {
      load: async () => ({ events: [intakeEvent] }),
      close() {},
    },
    ops: {
      listEvents: () => [operatingEvent],
      close() {},
    },
  };
}

test("evidence query returns stable member-state detail from repository-backed evidence", async () => {
  const result = await runEvidenceQuery({
    query: { command: "member-state", memberId: "iris-growth" },
    repositories: createRepositories(),
    generatedAt,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.query, {
    command: "member-state",
    memberId: "iris-growth",
  });
  assert.equal(result.generatedAt, generatedAt);
  assert.match(result.summary, /iris-growth/);
  assert.equal(result.detail.member.employeeId, "iris-growth");
  assert.equal(result.detail.work.runs[0]?.id, "work-run-1");
  assert.equal(result.detail.sessions[0]?.id, "session-record-1");
  assert.equal(result.detail.approvals[0]?.id, "approval-1");
  assert.equal(result.detail.grants[0]?.id, "grant-1");
  assert.equal(result.detail.ops[0]?.id, "ops-1");
});

test("evidence query returns work run, session input, trace, action, intake, approval, grant, and ops items", async () => {
  const repositories = createRepositories();

  const workRun = await runEvidenceQuery({
    query: { command: "work-run", id: "work-run-1" },
    repositories,
    generatedAt,
  });
  assert.equal(workRun.detail.run.id, "work-run-1");
  assert.equal(workRun.detail.events[0]?.eventType, "blocked");
  assert.equal(workRun.evidence?.workTaskId, "work-task-1");

  const sessionInput = await runEvidenceQuery({
    query: { command: "session-input", id: "session-record-1" },
    repositories,
    generatedAt,
  });
  assert.deepEqual(sessionInput.items.map((event) => event.id), ["session-event-1", "session-event-2"]);

  const trace = await runEvidenceQuery({
    query: { command: "trace", workRunId: "work-run-1" },
    repositories,
    generatedAt,
  });
  assert.equal(trace.items[0]?.id, "trace-1");

  const actions = await runEvidenceQuery({
    query: { command: "actions", memberId: "iris-growth" },
    repositories,
    generatedAt,
  });
  assert.equal(actions.items[0]?.actionName, "progress");

  const intake = await runEvidenceQuery({
    query: { command: "intake", memberId: "iris-growth" },
    repositories,
    generatedAt,
  });
  assert.equal(intake.items[0]?.id, "intake-1");

  const approvals = await runEvidenceQuery({
    query: { command: "approvals", status: "pending", memberId: "iris-growth" },
    repositories,
    generatedAt,
  });
  assert.equal(approvals.items[0]?.id, "approval-1");

  const grants = await runEvidenceQuery({
    query: { command: "grants", memberId: "iris-growth" },
    repositories,
    generatedAt,
  });
  assert.equal(grants.items[0]?.id, "grant-1");

  const ops = await runEvidenceQuery({
    query: { command: "ops", severity: "warning", memberId: "iris-growth" },
    repositories,
    generatedAt,
  });
  assert.equal(ops.items[0]?.id, "ops-1");
});

test("evidence query CLI parses stable commands and rejects raw SQL", async () => {
  assert.deepEqual(parseEvidenceQueryCliArgs(["work", "--member", "iris-growth", "--status", "blocked"]), {
    command: "work",
    memberId: "iris-growth",
    status: "blocked",
    output: "json",
  });
  assert.deepEqual(parseEvidenceQueryCliArgs(["trace", "--work-run", "work-run-1", "--summary"]), {
    command: "trace",
    workRunId: "work-run-1",
    output: "summary",
  });
  assert.throws(
    () => parseEvidenceQueryCliArgs(["sql", "select", "*", "from", "session_records"]),
    /Raw SQL evidence queries are not supported/,
  );
  assert.throws(
    () => parseEvidenceQueryCliArgs(["work", "--employee", "iris-growth"]),
    /--employee is retired; use --member/,
  );
});

test("evidence query CLI can render human summary without changing JSON default", async () => {
  const json = await runEvidenceQueryCli(["session", "--id", "session-record-1"], {
    repositories: createRepositories(),
    generatedAt,
  });
  assert.match(json, /"ok": true/);
  assert.match(json, /"command": "session"/);

  const summary = await runEvidenceQueryCli(["session", "--id", "session-record-1", "--summary"], {
    repositories: createRepositories(),
    generatedAt,
  });
  assert.equal(summary, "session session-record-1: 3 events");
});
