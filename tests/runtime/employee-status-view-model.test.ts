import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelTopic } from "../../src/channel-topics/domain/channel-topic.js";
import type { EmployeeAdminRecord } from "../../src/runtime/company-config/employees-admin.js";
import type { RuntimeSessionRecord } from "../../src/runtime/storage/runtime-session-repository.js";
import type { WorkRunRecord } from "../../src/work/domain.js";
import type { WorkDispatchLeaseRecord } from "../../src/work/work-dispatch-lease.js";
import {
  buildEmployeeStatusViewModel,
  type ScheduledWorkTaskRecord,
} from "../../src/runtime/employee-status/employee-status-view-model.js";
import { buildEmployeeRuntimeSummaryViewModel } from "../../src/runtime/employee-status/employee-runtime-summary.js";

const now = "2026-06-16T08:00:00.000Z";

function employee(employeeId: string, displayName: string): EmployeeAdminRecord {
  return {
    employeeId,
    enabled: true,
    profile: {
      employeeId,
      role: "quality",
      displayName,
      presenceMode: "resident",
    },
    resourcePolicy: {
      version: 1,
      filesystem: {},
    },
    runtime: {
      version: 1,
      modelProvider: "openai-codex",
      modelId: "gpt-5.4",
      thinkingLevel: "minimal",
    },
  };
}

function workTask(id: string, ownerMemberId: string): ScheduledWorkTaskRecord {
  return {
    id,
    title: `WorkTask ${id}`,
    status: "active",
    createdByMemberId: ownerMemberId,
    ownerMemberId,
    sourceKind: "intake_event",
    sourceId: `source-${id}`,
    acceptanceCriteria: "Done with evidence.",
    kind: "immediate",
    runCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function run(
  id: string,
  workTaskId: string,
  assigneeMemberId: string,
  status: WorkRunRecord["status"],
  updatedAt = now,
): WorkRunRecord {
  return {
    id,
    workTaskId,
    assigneeMemberId,
    status,
    triggeredBy: "immediate",
    blockedReason: status === "blocked" ? "Need source credentials." : undefined,
    failedReason: status === "failed" ? "Tool failed." : undefined,
    createdAt: now,
    updatedAt,
  };
}

function session(
  id: string,
  employeeId: string,
  status: RuntimeSessionRecord["status"],
  updatedAt = now,
): RuntimeSessionRecord {
  return {
    id,
    employeeId,
    sessionKey: `${employeeId}|work_run_execution|run-1`,
    sessionId: `session-${id}`,
    sceneType: "work_run_execution",
    workRunId: "run-1",
    status,
    title: `Session ${id}`,
    summary: "Visible summary only.",
    startedAt: now,
    updatedAt,
    eventCount: 37,
    userMessageCount: 2,
    assistantMessageCount: 3,
    toolCallCount: 4,
    toolResultCount: 4,
    tokenInputTotal: 100,
    tokenOutputTotal: 50,
    tokenCacheTotal: 0,
    byteSize: 2048,
    truncated: false,
  };
}

function lease(
  id: string,
  workRunId: string,
  assigneeMemberId: string,
  status: WorkDispatchLeaseRecord["status"],
): WorkDispatchLeaseRecord {
  return {
    id,
    workRunId,
    assigneeMemberId,
    sessionKey: `${assigneeMemberId}|work_run_execution|${workRunId}`,
    status,
    dispatchedAt: now,
    expiresAt: "2026-06-16T08:02:00.000Z",
    failedAt: status === "failed" ? "2026-06-16T08:01:00.000Z" : undefined,
    failureReason: status === "failed" ? "Employee did not acknowledge dispatch." : undefined,
    createdBy: "runtime",
  };
}

function topic(id: string, ownerId: string): ChannelTopic {
  return {
    id,
    ownerId,
    participantIds: [ownerId, "xuziho"],
    lastActivityAt: now,
  };
}

test("employee status view model aggregates identity, work, sessions, and Topic responsibility without raw events", () => {
  const model = buildEmployeeStatusViewModel({
    generatedAt: now,
    employees: [
      employee("quality-editor", "Quality Editor"),
      employee("nora-automation", "Nora Automation"),
    ],
    workTasks: [
      workTask("task-1", "quality-editor"),
      workTask("task-2", "quality-editor"),
      workTask("task-3", "quality-editor"),
      workTask("task-4", "quality-editor"),
    ],
    workRuns: [
      run("run-1", "task-1", "quality-editor", "in_progress"),
      run("run-2", "task-2", "quality-editor", "blocked"),
      run("run-3", "task-3", "quality-editor", "failed"),
      run("run-4", "task-4", "quality-editor", "queued"),
    ],
    dispatchLeases: [
      lease("lease-2", "run-2", "quality-editor", "failed"),
    ],
    sessions: [
      session("session-1", "quality-editor", "running"),
      session("session-2", "quality-editor", "failed"),
    ],
    channelTopics: [
      topic("topic-1", "quality-editor"),
      topic("topic-2", "quality-editor"),
    ],
    routes: {
      viewModelJsonPath: "/api/companies/acme/employees/status",
    },
  });

  assert.deepEqual(model.contract, {
    name: "employee-status",
    version: 1,
    productBoundary: "employee-centered-runtime-status",
  });
  assert.equal(model.routes.viewModelJsonPath, "/api/companies/acme/employees/status");
  assert.deepEqual(model.refresh, {
    strategy: "runtime-events",
    reconnectRecovery: true,
  });

  const quality = model.employees.find((candidate) => candidate.employeeId === "quality-editor");
  assert.ok(quality);
  assert.equal(quality.displayName, "Quality Editor");
  assert.equal(quality.runtime.modelProvider, "openai-codex");
  assert.equal(quality.runtime.modelId, "gpt-5.4");
  assert.equal(quality.runtime.modelConfigured, true);
  assert.equal(quality.runtime.modelDisplay, "openai-codex / gpt-5.4");
  assert.equal(quality.primaryStatus.kind, "executing");
  assert.equal(quality.primaryStatus.label, "Executing");
  assert.equal(quality.primaryStatus.label.includes("Need Attention"), false);
  assert.equal(quality.primaryStatus.reason, "Runtime session or WorkRun is in progress.");
  assert.deepEqual(quality.evidence, {
    persistedWorkRunStatus: "in_progress",
    runtimeSessionStatus: "running",
    dispatchLeaseStatus: "not_observed",
    latestEventAt: now,
  });
  assert.equal(quality.load.runningSessionCount, 1);
  assert.equal(quality.load.topicInHandCount, 2);
  assert.equal(quality.load.activeWorkRunCount, 3);
  assert.equal(quality.load.blockedWorkRunCount, 1);
  assert.equal(quality.load.activeWorkTaskCount, 4);
  assert.equal(quality.load.recentFailureCount, 2);
  assert.equal(quality.currentItems.length, 3);
  assert.deepEqual(
    quality.currentItems.map((item) => item.kind),
    ["session", "work-run", "work-run"],
  );
  assert.deepEqual(
    quality.currentItems.map((item) => [item.kind, item.href]),
    [
      ["session", "/app/sessions?employeeId=quality-editor&sessionId=session-1"],
      ["work-run", "/app/tasks?workTaskId=task-1"],
      ["work-run", "/app/tasks?workTaskId=task-4"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(quality), /\/console\/tasks|\/console\/sessions/);
  assert.equal(JSON.stringify(quality).includes("rawEvents"), false);
  assert.equal(JSON.stringify(quality).includes("root-topic"), false);
  assert.doesNotMatch(JSON.stringify(model), /WorkPlan|work-plan|active-work-plan|activePlanCount|view=plans/);
  assert.equal(quality.currentItems.filter((item) => item.kind === "topic").length, 0);

  const nora = model.employees.find((candidate) => candidate.employeeId === "nora-automation");
  assert.ok(nora);
  assert.equal(nora.primaryStatus.kind, "idle");
  assert.equal(nora.load.activeWorkRunCount, 0);
});

test("employee status view model keeps the employee list while selecting one employee detail", () => {
  const model = buildEmployeeStatusViewModel({
    generatedAt: now,
    employeeId: "quality-editor",
    employees: [
      employee("quality-editor", "Quality Editor"),
      employee("nora-automation", "Nora Automation"),
    ],
    workTasks: [workTask("task-1", "quality-editor")],
    workRuns: [run("run-1", "task-1", "quality-editor", "queued")],
    sessions: [],
    channelTopics: [],
  });

  assert.deepEqual(model.filters, {
    employeeId: "quality-editor",
    status: "all",
    sort: "recent",
  });
  assert.deepEqual(
    model.employees.map((employee) => employee.employeeId),
    ["quality-editor", "nora-automation"],
  );
  assert.equal(model.selected.employee?.employeeId, "quality-editor");
  assert.deepEqual(
    model.selected.detailSections.map((section) => section.id),
    ["current-work-run", "active-work-task", "running-session", "failed-session", "topics-in-hand"],
  );
  assert.deepEqual(
    model.selected.detailSections.find((section) => section.id === "current-work-run")?.items,
    [
      ["WorkRun", "run-1"],
      ["Status", "queued"],
      ["WorkTask", "task-1"],
      ["Title", "WorkTask task-1"],
      ["Persisted WorkRun status", "queued"],
      ["Runtime session evidence", "not_observed"],
      ["Dispatch lease evidence", "not_observed"],
      ["Latest event / updated", now],
      ["Updated", now],
    ],
  );
  assert.deepEqual(
    model.selected.detailSections.flatMap((section) => section.links.map((link) => [section.id, link.href])),
    [
      ["current-work-run", "/app/tasks?workTaskId=task-1"],
      ["active-work-task", "/app/tasks?workTaskId=task-1"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(model.selected.detailSections), /\/console\/tasks|\/console\/sessions/);
});

test("employee status view model supports status filters and severity ordering", () => {
  const model = buildEmployeeStatusViewModel({
    generatedAt: now,
    status: "running",
    sort: "severity",
    employees: [
      employee("idle-employee", "Idle Employee"),
      employee("blocked-employee", "Blocked Employee"),
      employee("failed-employee", "Failed Employee"),
      employee("running-employee", "Running Employee"),
    ],
    workTasks: [
      workTask("task-blocked", "blocked-employee"),
      workTask("task-failed", "failed-employee"),
      workTask("task-running", "running-employee"),
    ],
    workRuns: [
      run("run-blocked", "task-blocked", "blocked-employee", "blocked", "2026-06-16T08:05:00.000Z"),
      run("run-failed", "task-failed", "failed-employee", "failed", "2026-06-16T08:04:00.000Z"),
      run("run-running", "task-running", "running-employee", "in_progress", "2026-06-16T08:03:00.000Z"),
    ],
    sessions: [],
    channelTopics: [],
  });

  assert.equal(model.filters.status, "running");
  assert.equal(model.filters.sort, "severity");
  assert.deepEqual(
    model.statusOptions.map((option) => [option.id, option.count]),
    [
      ["all", 4],
      ["configuration", 0],
      ["running", 1],
      ["blocked", 1],
      ["failed", 1],
      ["idle", 1],
    ],
  );
  assert.deepEqual(model.sortOptions.map((option) => option.id), ["recent", "severity", "name"]);
  assert.deepEqual(
    model.employees.map((employee) => employee.employeeId),
    ["running-employee"],
  );

  const severityModel = buildEmployeeStatusViewModel({
    generatedAt: now,
    sort: "severity",
    employees: [
      employee("idle-employee", "Idle Employee"),
      employee("blocked-employee", "Blocked Employee"),
      employee("failed-employee", "Failed Employee"),
      employee("running-employee", "Running Employee"),
    ],
    workTasks: [
      workTask("task-blocked", "blocked-employee"),
      workTask("task-failed", "failed-employee"),
      workTask("task-running", "running-employee"),
    ],
    workRuns: [
      run("run-blocked", "task-blocked", "blocked-employee", "blocked", "2026-06-16T08:05:00.000Z"),
      run("run-failed", "task-failed", "failed-employee", "failed", "2026-06-16T08:06:00.000Z"),
      run("run-running", "task-running", "running-employee", "in_progress", "2026-06-16T08:07:00.000Z"),
    ],
    sessions: [],
    channelTopics: [],
  });

  assert.deepEqual(
    severityModel.employees.map((employee) => employee.employeeId),
    ["blocked-employee", "failed-employee", "running-employee", "idle-employee"],
  );
});

test("employee status treats missing runtime model as pending configuration", () => {
  const pendingEmployee = employee("employee-hr", "Company HR");
  pendingEmployee.runtime = {
    version: 1,
    thinkingLevel: "minimal",
  };
  const model = buildEmployeeStatusViewModel({
    generatedAt: now,
    status: "configuration",
    employees: [
      pendingEmployee,
      employee("configured-employee", "Configured Employee"),
    ],
    workTasks: [workTask("task-pending", "employee-hr")],
    workRuns: [run("run-pending", "task-pending", "employee-hr", "queued")],
    sessions: [],
    channelTopics: [],
  });

  assert.deepEqual(
    model.statusOptions.map((option) => [option.id, option.count]),
    [
      ["all", 2],
      ["configuration", 1],
      ["running", 0],
      ["blocked", 0],
      ["failed", 0],
      ["idle", 1],
    ],
  );
  assert.deepEqual(model.employees.map((candidate) => candidate.employeeId), ["employee-hr"]);
  const pending = model.employees[0];
  assert.equal(pending?.runtime.modelConfigured, false);
  assert.equal(pending?.runtime.modelDisplay, "configure-runtime-model-first");
  assert.equal(pending?.primaryStatus.kind, "configuration_needed");
  assert.equal(pending?.primaryStatus.label, "Needs config");
  assert.match(pending?.primaryStatus.reason || "", /Configure a runtime model/);
  assert.equal(pending?.load.activeWorkRunCount, 1);
});

test("employee runtime summary projects chat-scoped status without page or configuration fields", () => {
  const model = buildEmployeeStatusViewModel({
    generatedAt: now,
    employeeId: "quality-editor",
    employees: [
      employee("quality-editor", "Quality Editor"),
      employee("nora-automation", "Nora Automation"),
    ],
    workTasks: [workTask("task-1", "quality-editor"), workTask("task-2", "quality-editor")],
    workRuns: [
      run("run-1", "task-1", "quality-editor", "in_progress"),
      run("run-2", "task-2", "quality-editor", "blocked"),
      run("run-other", "task-other", "nora-automation", "blocked"),
    ],
    dispatchLeases: [lease("lease-2", "run-2", "quality-editor", "failed")],
    sessions: [
      session("session-1", "quality-editor", "running"),
      session("session-failed", "quality-editor", "failed"),
      session("session-other", "nora-automation", "running"),
    ],
    channelTopics: [topic("topic-1", "quality-editor"), topic("topic-other", "nora-automation")],
    routes: {
      viewModelJsonPath: "/api/companies/acme/employees/status",
    },
  });

  const summary = buildEmployeeRuntimeSummaryViewModel({
    summaryJsonPath: "/api/companies/acme/employees/runtime-summary",
    employeeId: "quality-editor",
    source: model,
  });

  assert.deepEqual(summary.contract, {
    name: "employee-runtime-summary",
    version: 1,
    productBoundary: "chat-employee-context-runtime-summary",
  });
  assert.equal(summary.routes.summaryJsonPath, "/api/companies/acme/employees/runtime-summary");
  assert.equal(summary.employees.length, 1);
  assert.equal(summary.employees[0]?.employeeId, "quality-editor");
  assert.equal(summary.employees[0]?.displayName, "Quality Editor");
  assert.equal(summary.employees[0]?.status.kind, "working");
  assert.equal(summary.employees[0]?.status.reason, "Runtime session or WorkRun is in progress.");
  assert.deepEqual(summary.employees[0]?.counts, {
    pendingApprovalCount: 0,
    blockedWorkRunCount: 1,
    activeWorkRunCount: 2,
    activeTaskCount: 2,
    recentFailureCount: 1,
  });
  assert.equal(summary.employees[0]?.issues[0]?.kind, "blocked-work-run");
  assert.equal(summary.employees[0]?.issues[0]?.target.id, "run-2");
  assert.equal(summary.employees[0]?.issues.length, 1);
  assert.deepEqual(
    summary.employees[0]?.current.map((item) => [item.kind, item.id, "href" in item]),
    [
      ["session", "session-1", true],
      ["work-run", "run-1", true],
      ["work-run", "run-2", true],
    ],
  );

  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /nora-automation|run-other|session-other|topic-other/);
  assert.doesNotMatch(serialized, /openai-codex|gpt-5\.4|modelProvider|modelId|thinkingLevel|rawEvents|transcript|payload/);
  assert.doesNotMatch(serialized, /acceptanceCriteria|verificationPlan|Done with evidence|Read result summary/);
  assert.doesNotMatch(serialized, /filters|statusOptions|sortOptions|detailSections|evidence|\/console\/|Mattermost|rootPostId/);
});

test("employee runtime summary keeps terminal failures out of Chat attention", () => {
  const model = buildEmployeeStatusViewModel({
    generatedAt: now,
    employeeId: "quality-editor",
    employees: [employee("quality-editor", "Quality Editor")],
    workTasks: [workTask("task-failed", "quality-editor")],
    workRuns: [run("run-failed", "task-failed", "quality-editor", "failed")],
    sessions: [session("session-failed", "quality-editor", "failed")],
    channelTopics: [],
  });

  const summary = buildEmployeeRuntimeSummaryViewModel({
    summaryJsonPath: "/api/companies/acme/employees/runtime-summary",
    employeeId: "quality-editor",
    source: model,
  });

  assert.equal(summary.employees[0]?.counts.recentFailureCount, 2);
  assert.notEqual(summary.employees[0]?.status.kind, "failed");
  assert.equal(summary.employees[0]?.issues.length, 0);
  assert.deepEqual(
    summary.employees[0]?.current.map((item) => item.kind),
    ["work-task"],
  );
});

test("employee runtime summary treats failed sessions as evidence-only when no current work exists", () => {
  const model = buildEmployeeStatusViewModel({
    generatedAt: now,
    employeeId: "quality-editor",
    employees: [employee("quality-editor", "Quality Editor")],
    workTasks: [],
    workRuns: [],
    sessions: [session("session-failed", "quality-editor", "failed")],
    channelTopics: [],
  });

  const summary = buildEmployeeRuntimeSummaryViewModel({
    summaryJsonPath: "/api/companies/acme/employees/runtime-summary",
    employeeId: "quality-editor",
    source: model,
  });

  assert.equal(summary.employees[0]?.counts.recentFailureCount, 1);
  assert.equal(summary.employees[0]?.status.kind, "idle");
  assert.equal(summary.employees[0]?.issues.length, 0);
  assert.equal(summary.employees[0]?.current.length, 0);
});

test("employee status ignores blocked WorkRuns whose WorkTask is no longer active", () => {
  const canceledTask = workTask("task-canceled", "quality-editor");
  canceledTask.status = "canceled";
  const model = buildEmployeeStatusViewModel({
    generatedAt: now,
    employees: [employee("quality-editor", "Quality Editor")],
    workTasks: [canceledTask],
    workRuns: [run("run-stale-blocker", canceledTask.id, "quality-editor", "blocked")],
    sessions: [],
    channelTopics: [],
  });

  assert.equal(model.employees[0]?.primaryStatus.kind, "idle");
  assert.equal(model.employees[0]?.load.blockedWorkRunCount, 0);
  assert.equal(model.employees[0]?.issues.length, 0);
  assert.equal(model.employees[0]?.currentItems.length, 0);
});
