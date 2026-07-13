import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCompany } from "../../src/runtime/company-config/companies-admin.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { WorkDispatcher } from "../../src/work/work-dispatcher.js";
import { WorkRepository } from "../../src/work/work-repository.js";
import { WorkService } from "../../src/work/work-service.js";

function createDeterministicClock() {
  let tick = 0;
  return () => `2026-06-13T00:00:${String(tick++).padStart(2, "0")}.000Z`;
}

function createDeterministicIds() {
  let tick = 0;
  return (prefix: string) => `${prefix}-${++tick}`;
}

const fixtureRunId = randomUUID().slice(0, 8);
let fixtureCount = 0;

async function createManualRun(repoRoot: string, input: {
  companyId: string;
  id: string;
  workTaskId: string;
  status?: "queued" | "in_progress";
}) {
  const repository = await WorkRepository.open(repoRoot, { companyId: input.companyId });
  try {
    const run = repository.createWorkRun({
      id: input.id,
      workTaskId: input.workTaskId,
      status: input.status || "in_progress",
      assigneeMemberId: "iris-growth",
      triggeredBy: "immediate",
      scheduledFor: "2026-06-13T00:00:30.000Z",
      createdAt: "2026-06-13T00:00:30.000Z",
      updatedAt: "2026-06-13T00:00:30.000Z",
    });
    await repository.save();
    return run;
  } finally {
    repository.close();
  }
}

async function createFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-work-"));
  const companyId = `work-service-${fixtureRunId}-${++fixtureCount}`;
  await createCompany({ repoRoot, companyId, displayName: `Work Service ${fixtureCount}` });
  const directory = await CompanyDirectoryRepository.open(repoRoot, { companyId });
  try {
    for (const employeeId of ["nora-automation", "iris-growth"]) {
      await directory.upsertEmployee({
        employeeId,
        enabled: true,
        profile: {
          employeeId,
          displayName: employeeId,
          role: "employee",
          presenceMode: "resident",
          mountedActions: [],
        },
        permissions: [],
        runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
      });
    }
    await directory.save();
  } finally {
    directory.close();
  }

  return {
    repoRoot,
    companyId,
    service: new WorkService({
      repoRoot,
      companyId,
      now: createDeterministicClock(),
      createId: createDeterministicIds(),
    }),
  };
}

test("work service creates an immediate WorkTask with a queued WorkRun", async () => {
  const { service } = await createFixture();

  const result = await service.createWork({
    title: "Check registration funnel conversion drop",
    description: "The boss asked Growth to investigate the new-user registration flow.",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "post-registration-drop",
    acceptanceCriteria: "A concise diagnosis and recommended next step are posted back to the requester.",
    trigger: { kind: "immediate" },
  });

  assert.equal(result.task.id, "work-task-1");
  assert.equal(result.task.status, "active");
  assert.equal(result.task.ownerMemberId, "iris-growth");
  assert.equal(result.task.acceptanceCriteria, "A concise diagnosis and recommended next step are posted back to the requester.");
  assert.equal(Object.prototype.hasOwnProperty.call(result.task, "successCondition"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.task, "verificationPlan"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.task, "failureCondition"), false);
  assert.equal(result.schedule, undefined);
  assert.equal(result.run?.id, "work-run-2");
  assert.equal(result.run?.workTaskId, result.task.id);
  assert.equal(result.run?.status, "queued");
  assert.equal(result.run?.assigneeMemberId, "iris-growth");
  assert.equal(Object.prototype.hasOwnProperty.call(result.run as object, "verificationStatus"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.run as object, "verificationSummary"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.run as object, "resultPayload"), false);

  const detail = await service.getWorkTaskDetail(result.task.id);
  assert.equal(detail?.schedules.length, 0);
  assert.equal(detail?.runs.length, 1);
  assert.equal(detail?.runs[0]?.id, result.run?.id);
});

test("work service rejects create, due schedule, and retry when the assignee is inactive", async () => {
  const fixture = await createFixture();
  const scheduled = await fixture.service.createWork({
    title: "Inactive lifecycle schedule",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "conversation-lifecycle",
    acceptanceCriteria: "The run is created only while the owner is active.",
    trigger: { kind: "scheduled_once", scheduledFor: "2026-06-13T00:00:00.000Z" },
  });
  const immediate = await fixture.service.createWork({
    title: "Inactive lifecycle retry",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "conversation-lifecycle",
    acceptanceCriteria: "Retries require an active assignee.",
    trigger: { kind: "immediate" },
  });
  await fixture.service.moveWorkRun({
    workRunId: immediate.run!.id,
    actorMemberId: "iris-growth",
    status: "in_progress",
  });
  await fixture.service.moveWorkRun({
    workRunId: immediate.run!.id,
    actorMemberId: "iris-growth",
    status: "failed",
    reason: "fixture failure",
  });

  const directory = await CompanyDirectoryRepository.open(fixture.repoRoot, { companyId: fixture.companyId });
  try {
    await directory.setEmployeeEnabled("iris-growth", false);
  } finally {
    directory.close();
  }

  await assert.rejects(
    fixture.service.createWork({
      title: "Rejected inactive work",
      createdByMemberId: "nora-automation",
      ownerMemberId: "iris-growth",
      sourceKind: "chat_request",
      sourceId: "conversation-lifecycle",
      acceptanceCriteria: "No WorkTask is created.",
      trigger: { kind: "immediate" },
    }),
    /not an active runtime-capable member/,
  );
  await assert.rejects(
    fixture.service.createDueWorkRun({
      workScheduleId: scheduled.schedule!.id,
      actorMemberId: "nora-automation",
    }),
    /not an active runtime-capable member/,
  );
  await assert.rejects(
    fixture.service.retryWorkRun({
      workRunId: immediate.run!.id,
      actorMemberId: "nora-automation",
    }),
    /not an active runtime-capable member/,
  );
});

test("work service notifies work changes for realtime projections", async () => {
  const fixture = await createFixture();
  const changes: Array<{ kind: string; workTaskId?: string; workRunId?: string; employeeId: string; status: string }> = [];
  const service = new WorkService({
    repoRoot: fixture.repoRoot,
    companyId: fixture.companyId,
    now: createDeterministicClock(),
    createId: createDeterministicIds(),
    observer: {
      workTaskChanged(event) {
        changes.push({
          kind: "work-task",
          workTaskId: event.task.id,
          employeeId: event.task.ownerMemberId,
          status: event.task.status,
        });
      },
      workRunChanged(event) {
        changes.push({
          kind: "work-run",
          workTaskId: event.run.workTaskId,
          workRunId: event.run.id,
          employeeId: event.run.assigneeMemberId,
          status: event.run.status,
        });
      },
    },
  });

  const created = await service.createWork({
    title: "Realtime status work",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "post-realtime-status-work",
    acceptanceCriteria: "Realtime changes are observable.",
    trigger: { kind: "immediate" },
  });
  await service.moveWorkRun({
    workRunId: created.run!.id,
    actorMemberId: "iris-growth",
    status: "in_progress",
    summary: "Started realtime status work.",
  });
  await service.cancelWorkTask({
    workTaskId: created.task.id,
    actorMemberId: "nora-automation",
    reason: "Realtime observer cancellation.",
  });

  assert.deepEqual(changes.map((change) => [change.kind, change.workTaskId, change.workRunId, change.employeeId, change.status]), [
    ["work-task", "work-task-1", undefined, "iris-growth", "active"],
    ["work-run", "work-task-1", "work-run-2", "iris-growth", "queued"],
    ["work-run", "work-task-1", "work-run-2", "iris-growth", "in_progress"],
    ["work-task", "work-task-1", undefined, "iris-growth", "canceled"],
    ["work-run", "work-task-1", "work-run-2", "iris-growth", "canceled"],
  ]);
});

test("work service stores scheduled one-time WorkTasks as WorkSchedules without creating a WorkRun early", async () => {
  const { service } = await createFixture();

  const result = await service.createWork({
    title: "Send the weekly growth digest",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "post-weekly-digest",
    acceptanceCriteria: "The digest is sent to the growth channel.",
    trigger: {
      kind: "scheduled_once",
      scheduledFor: "2026-06-15T01:00:00.000Z",
      timezone: "Asia/Shanghai",
    },
  });

  assert.equal(result.task.id, "work-task-1");
  assert.equal(result.schedule?.id, "work-schedule-2");
  assert.equal(result.schedule?.workTaskId, result.task.id);
  assert.equal(result.schedule?.kind, "scheduled_once");
  assert.equal(result.schedule?.nextRunAt, "2026-06-15T01:00:00.000Z");
  assert.equal(result.schedule?.timezone, "Asia/Shanghai");
  assert.deepEqual(result.schedule?.scheduleRule, { scheduledFor: "2026-06-15T01:00:00.000Z" });
  assert.equal(Object.prototype.hasOwnProperty.call(result.schedule as object, "triggerKind"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.schedule as object, "scheduleTimezone"), false);
  assert.equal(result.run, undefined);

  const detail = await service.getWorkTaskDetail(result.task.id);
  assert.equal(detail?.schedules.length, 1);
  assert.equal(detail?.runs.length, 0);
});

test("work service normalizes offset scheduled timestamps to UTC", async () => {
  const { service } = await createFixture();

  const result = await service.createWork({
    title: "Review the Shanghai morning report",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "post-shanghai-report",
    acceptanceCriteria: "The report is reviewed at 09:30 Shanghai time.",
    trigger: {
      kind: "scheduled_once",
      scheduledFor: "2026-07-11T09:30:00+08:00",
      timezone: "Asia/Shanghai",
    },
  });

  assert.equal(result.schedule?.nextRunAt, "2026-07-11T01:30:00.000Z");
  assert.deepEqual(result.schedule?.scheduleRule, { scheduledFor: "2026-07-11T01:30:00.000Z" });
  assert.equal(result.schedule?.timezone, "Asia/Shanghai");
});

test("work service rejects invalid scheduled and recurring triggers before persistence", async () => {
  const { service } = await createFixture();

  await assert.rejects(
    service.createWork({
      title: "Invalid recurring work",
      createdByMemberId: "nora-automation",
      ownerMemberId: "iris-growth",
      sourceKind: "chat_request",
      sourceId: "invalid-recurring-work",
      acceptanceCriteria: "This Task must never persist.",
      trigger: { kind: "recurring", scheduledFor: "2026-06-15T01:00:00.000Z" },
    }),
    /positive trigger\.intervalMs/,
  );
  await assert.rejects(
    service.createWork({
      title: "Invalid scheduled work",
      createdByMemberId: "nora-automation",
      ownerMemberId: "iris-growth",
      sourceKind: "chat_request",
      sourceId: "invalid-scheduled-work",
      acceptanceCriteria: "This Task must never persist.",
      trigger: { kind: "scheduled_once", scheduledFor: "tomorrow-ish" },
    }),
    /valid ISO timestamp/,
  );
  await assert.rejects(
    service.createWork({
      title: "Ambiguous scheduled work",
      createdByMemberId: "nora-automation",
      ownerMemberId: "iris-growth",
      sourceKind: "chat_request",
      sourceId: "ambiguous-scheduled-work",
      acceptanceCriteria: "This Task must never persist.",
      trigger: {
        kind: "scheduled_once",
        scheduledFor: "2026-07-11T09:30:00",
        timezone: "Asia/Shanghai",
      },
    }),
    /explicit UTC offset or Z/,
  );

  assert.deepEqual(await service.listWorkTasks(), []);
  assert.deepEqual(await service.listWorkSchedules(), []);
  assert.deepEqual(await service.listWorkRuns(), []);
});

test("work service pauses resumes and cancels WorkSchedules without creating WorkRuns", async () => {
  const { service } = await createFixture();
  const created = await service.createWork({
    title: "Scheduled quality review",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "post-schedule-controls",
    acceptanceCriteria: "The scheduled review runs when enabled.",
    trigger: {
      kind: "scheduled_once",
      scheduledFor: "2026-06-15T01:00:00.000Z",
      timezone: "Asia/Shanghai",
    },
  });
  const scheduleId = created.schedule?.id as string;

  const paused = await service.moveWorkSchedule({
    workScheduleId: scheduleId,
    actorMemberId: "nora-automation",
    status: "paused",
    reason: "Waiting for the publishing window.",
  });
  assert.equal(paused.status, "paused");
  assert.equal(paused.pausedReason, "Waiting for the publishing window.");
  assert.equal(paused.nextRunAt, "2026-06-15T01:00:00.000Z");

  const resumed = await service.moveWorkSchedule({
    workScheduleId: scheduleId,
    actorMemberId: "nora-automation",
    status: "enabled",
    reason: "Publishing window restored.",
  });
  assert.equal(resumed.status, "enabled");
  assert.equal(resumed.pausedReason, undefined);
  assert.equal(resumed.canceledReason, undefined);

  const canceled = await service.moveWorkSchedule({
    workScheduleId: scheduleId,
    actorMemberId: "nora-automation",
    status: "canceled",
    reason: "The request was withdrawn.",
  });
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.canceledReason, "The request was withdrawn.");
  assert.equal(canceled.completedAt, "2026-06-13T00:00:03.000Z");

  const detail = await service.getWorkTaskDetail(created.task.id);
  assert.equal(detail?.task.status, "canceled");
  assert.equal(detail?.runs.length, 0);
  await assert.rejects(
    service.moveWorkSchedule({
      workScheduleId: scheduleId,
      actorMemberId: "nora-automation",
      status: "enabled",
      reason: "Canceled schedules should not be resumed.",
    }),
    /Cannot move WorkSchedule from canceled to enabled/,
  );
});

test("work service cancels active WorkTasks and archives only inactive WorkTasks without deleting WorkRun evidence", async () => {
  const { service } = await createFixture();
  const created = await service.createWork({
    title: "Archive completed launch review",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "post-archive-task",
    acceptanceCriteria: "The launch review is complete.",
    trigger: { kind: "immediate" },
  });
  const runId = created.run?.id as string;

  await assert.rejects(
    service.archiveWorkTask({
      workTaskId: created.task.id,
      actorMemberId: "nora-automation",
      reason: "Hide from the active Tasks list.",
    }),
    /Cannot archive active WorkTask/,
  );

  const canceled = await service.cancelWorkTask({
    workTaskId: created.task.id,
    actorMemberId: "nora-automation",
    reason: "The launch review was withdrawn.",
  });
  assert.equal(canceled.task.status, "canceled");
  assert.equal(canceled.task.canceledReason, "The launch review was withdrawn.");
  assert.equal(canceled.runs[0]?.status, "canceled");
  assert.equal(canceled.runs[0]?.canceledReason, "The launch review was withdrawn.");

  const archived = await service.archiveWorkTask({
    workTaskId: created.task.id,
    actorMemberId: "nora-automation",
    reason: "Hide from the active Tasks list.",
  });
  assert.equal(archived.task.status, "archived");
  assert.equal(archived.runs[0]?.id, runId);
  assert.equal(archived.runs[0]?.status, "canceled");

  const restored = await service.restoreWorkTask({
    workTaskId: created.task.id,
    actorMemberId: "nora-automation",
  });
  assert.equal(restored.task.status, "canceled");
  assert.equal(restored.task.canceledReason, "The launch review was withdrawn.");
  assert.equal(restored.runs[0]?.id, runId);
});

test("work service advances WorkRun status and records events", async () => {
  const { service } = await createFixture();
  const created = await service.createWork({
    title: "Review signup analytics",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "post-signup-analytics",
    acceptanceCriteria: "Signup conversion findings are summarized.",
    trigger: { kind: "immediate" },
  });
  const runId = created.run?.id as string;

  await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "iris-growth",
    status: "in_progress",
    summary: "Started analytics review.",
  });
  const blocked = await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "iris-growth",
    status: "blocked",
    reason: "Need access to the analytics dashboard.",
    summary: "Blocked on analytics access.",
  });

  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockedReason, "Need access to the analytics dashboard.");

  const detail = await service.getWorkRunDetail(runId);
  assert.deepEqual(
    detail?.events.map((event) => event.eventType),
    ["created", "started", "blocked"],
  );
});

test("work service invokes terminal cleanup only after a WorkRun reaches a terminal status", async () => {
  const { repoRoot, companyId } = await createFixture();
  const terminalRuns: string[] = [];
  const service = new WorkService({
    repoRoot,
    companyId,
    now: createDeterministicClock(),
    createId: createDeterministicIds(),
    async onWorkRunTerminal(run) {
      terminalRuns.push(`${run.id}:${run.status}`);
    },
  });
  const created = await service.createWork({
    title: "Close terminal approvals",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "post-terminal-approval-cleanup",
    acceptanceCriteria: "Terminal cleanup is invoked after completion.",
    trigger: { kind: "immediate" },
  });
  const runId = created.run!.id;

  await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "iris-growth",
    status: "in_progress",
  });
  assert.deepEqual(terminalRuns, []);
  await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "iris-growth",
    status: "done",
    summary: "Cleanup verified.",
    evidence: "The terminal hook observed the completed Run.",
  });

  assert.deepEqual(terminalRuns, [`${runId}:done`]);
});

test("work service allows a blocked WorkRun to complete with evidence after recovery", async () => {
  const { service } = await createFixture();
  const created = await service.createWork({
    title: "Repair article quality issue",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "intake_event",
    sourceId: "intake-article-quality",
    acceptanceCriteria: "The article quality check passes.",
    trigger: { kind: "immediate" },
  });
  const runId = created.run?.id as string;

  await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "iris-growth",
    status: "in_progress",
    summary: "Started article repair.",
  });
  await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "iris-growth",
    status: "blocked",
    reason: "Need external CMS editing access.",
    summary: "Blocked on external CMS access.",
  });

  const completed = await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "iris-growth",
    status: "done",
    summary: "Article repaired and verified.",
    evidence: "Quality check passed after external CMS access was provided.",
  });

  assert.equal(completed.status, "done");
  assert.equal(completed.resultSummary, "Article repaired and verified.");
  assert.equal(Object.prototype.hasOwnProperty.call(completed, "verificationStatus"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(completed, "resultPayload"), false);

  const detail = await service.getWorkRunDetail(runId);
  assert.deepEqual(
    detail?.events.map((event) => event.eventType),
    ["created", "started", "blocked", "completed"],
  );
});

test("work service records confirmed Task revisions and moves the active Run to the new objective", async () => {
  const { service } = await createFixture();
  const created = await service.createWork({
    title: "Publish launch draft",
    description: "Publish the original launch draft.",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "revise-launch-draft",
    requesterId: "xuziho",
    acceptanceCriteria: "The original draft is published.",
    trigger: { kind: "immediate" },
  });
  assert.ok(created.run);
  await service.moveWorkRun({
    workRunId: created.run.id,
    actorMemberId: "iris-growth",
    status: "in_progress",
  });
  await service.moveWorkRun({
    workRunId: created.run.id,
    actorMemberId: "iris-growth",
    status: "blocked",
    reason: "The operator is changing the campaign direction.",
  });

  const revised = await service.reviseWorkTask({
    workTaskId: created.task.id,
    sourceWorkRunId: created.run.id,
    actorMemberId: "xuziho",
    reason: "The campaign now targets returning customers.",
    title: "Publish returning-customer launch draft",
    description: "Rewrite and publish the launch draft for returning customers.",
    acceptanceCriteria: "The returning-customer draft is published and its URL is recorded.",
  });

  assert.equal(revised.task.revision, 2);
  assert.equal(revised.task.title, "Publish returning-customer launch draft");
  assert.equal(revised.runs[0]?.taskRevision, 2);
  assert.deepEqual(revised.revisions.map((revision) => revision.revision), [1, 2]);
  assert.equal(revised.revisions[1]?.sourceWorkRunId, created.run.id);
  assert.equal((await service.getWorkRunDetail(created.run.id))?.events.at(-1)?.eventType, "task_revised");
});

test("work service completes one-shot WorkTasks when their WorkRun is done", async () => {
  const { service } = await createFixture();
  const created = await service.createWork({
    title: "Repair article quality issue",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "intake_event",
    sourceId: "intake-one-shot-complete",
    acceptanceCriteria: "The article quality check passes.",
    trigger: { kind: "immediate" },
  });
  const runId = created.run?.id as string;

  await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "iris-growth",
    status: "in_progress",
    summary: "Started article repair.",
  });
  await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "iris-growth",
    status: "done",
    summary: "Article repaired and verified.",
    evidence: "Quality check passed.",
  });

  const detail = await service.getWorkTaskDetail(created.task.id);
  assert.equal(detail?.task.status, "completed");
  assert.equal(detail?.task.completedAt, "2026-06-13T00:00:02.000Z");
  assert.equal(detail?.runs.length, 1);
});

test("work service cancels one-shot WorkTasks when their WorkRun is canceled", async () => {
  const { service } = await createFixture();
  const created = await service.createWork({
    title: "Check withdrawn request",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "post-one-shot-cancel",
    acceptanceCriteria: "The withdrawn request should not continue running.",
    trigger: { kind: "immediate" },
  });
  const runId = created.run?.id as string;

  await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "nora-automation",
    status: "canceled",
    reason: "The request was withdrawn.",
    summary: "Canceled withdrawn request.",
  });

  const detail = await service.getWorkTaskDetail(created.task.id);
  assert.equal(detail?.task.status, "canceled");
  assert.equal(detail?.task.canceledReason, "The request was withdrawn.");
  assert.equal(detail?.task.completedAt, "2026-06-13T00:00:01.000Z");
});

test("work service keeps one-shot WorkTasks active when their WorkRun fails", async () => {
  const { service } = await createFixture();
  const created = await service.createWork({
    title: "Repair article quality issue",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "intake_event",
    sourceId: "intake-one-shot-fail",
    acceptanceCriteria: "The article quality check passes.",
    trigger: { kind: "immediate" },
  });
  const runId = created.run?.id as string;

  await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "iris-growth",
    status: "in_progress",
    summary: "Started article repair.",
  });
  await service.moveWorkRun({
    workRunId: runId,
    actorMemberId: "iris-growth",
    status: "failed",
    reason: "The external CMS returned a permission error.",
    summary: "Article repair failed.",
  });

  const detail = await service.getWorkTaskDetail(created.task.id);
  assert.equal(detail?.task.status, "active");
  assert.equal(detail?.task.completedAt, undefined);
});

test("work service retries a failed WorkRun by creating a linked queued WorkRun", async () => {
  const { service } = await createFixture();
  const created = await service.createWork({
    title: "Repair article quality issue",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "intake_event",
    sourceId: "intake-retry-failed-run",
    acceptanceCriteria: "The article quality check passes.",
    trigger: { kind: "immediate" },
  });
  const failedRunId = created.run?.id as string;
  await service.moveWorkRun({
    workRunId: failedRunId,
    actorMemberId: "iris-growth",
    status: "in_progress",
  });
  await service.moveWorkRun({
    workRunId: failedRunId,
    actorMemberId: "iris-growth",
    status: "failed",
    reason: "The CMS was temporarily unavailable.",
  });

  const retriedRun = await service.retryWorkRun({
    workRunId: failedRunId,
    actorMemberId: "iris-growth",
  });
  const taskDetail = await service.getWorkTaskDetail(created.task.id);
  const failedRunDetail = await service.getWorkRunDetail(failedRunId);
  const retriedRunDetail = await service.getWorkRunDetail(retriedRun.id);

  assert.notEqual(retriedRun.id, failedRunId);
  assert.equal(retriedRun.status, "queued");
  assert.equal(retriedRun.triggeredBy, "retry");
  assert.equal(taskDetail?.task.status, "active");
  assert.equal(taskDetail?.runs.length, 2);
  assert.equal(failedRunDetail?.events.at(-1)?.eventType, "retry_created");
  assert.equal(failedRunDetail?.events.at(-1)?.metadata?.retryWorkRunId, retriedRun.id);
  assert.equal(retriedRunDetail?.events[0]?.metadata?.retryOfWorkRunId, failedRunId);
  await assert.rejects(
    service.retryWorkRun({
      workRunId: failedRunId,
      actorMemberId: "iris-growth",
    }),
    /while active WorkRun .* is queued/,
  );

  await service.moveWorkRun({
    workRunId: retriedRun.id,
    actorMemberId: "iris-growth",
    status: "in_progress",
  });
  await service.moveWorkRun({
    workRunId: retriedRun.id,
    actorMemberId: "iris-growth",
    status: "done",
    summary: "Article quality issue repaired on retry.",
    evidence: "The quality check passed after the CMS recovered.",
  });
  assert.equal((await service.getWorkTaskDetail(created.task.id))?.task.status, "completed");
});

test("work service completes the exhausted recurring schedule but keeps its WorkTask active when the final WorkRun fails", async () => {
  const { repoRoot, companyId, service } = await createFixture();
  const created = await service.createWork({
    title: "Recurring quality check",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "manual",
    sourceId: "recurring-quality-check",
    acceptanceCriteria: "Each scheduled quality check finishes with evidence.",
    trigger: {
      kind: "recurring",
      scheduledFor: "2026-06-13T00:00:01.000Z",
      intervalMs: 60_000,
    },
    maxRuns: 1,
  });
  const run = await createManualRun(repoRoot, {
    companyId,
    id: "recurring-run-1",
    workTaskId: created.task.id,
  });

  await service.moveWorkRun({
    workRunId: run.id,
    actorMemberId: "iris-growth",
    status: "failed",
    reason: "The quality check could not access the external CMS.",
    summary: "Recurring quality check failed.",
  });

  const detail = await service.getWorkTaskDetail(created.task.id);
  assert.equal(detail?.task.status, "active");
  assert.equal(detail?.schedules[0]?.status, "completed");
  assert.equal(detail?.schedules[0]?.runCount, 1);
  assert.equal(detail?.schedules[0]?.lastRunAt, "2026-06-13T00:00:01.000Z");
});

test("work service repositories isolate tasks and runs by company", async () => {
  const { repoRoot, companyId } = await createFixture();
  const otherCompanyId = `${companyId}-support`;
  await createCompany({ repoRoot, companyId: otherCompanyId, displayName: "Support Work Service" });
  const otherDirectory = await CompanyDirectoryRepository.open(repoRoot, { companyId: otherCompanyId });
  try {
    await otherDirectory.upsertEmployee({
      employeeId: "iris-growth",
      enabled: true,
      profile: {
        employeeId: "iris-growth",
        displayName: "Iris Growth",
        role: "employee",
        presenceMode: "resident",
      },
      resourcePolicy: {},
      runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
    });
  } finally {
    otherDirectory.close();
  }

  const defaultService = new WorkService({
    repoRoot,
    companyId,
    now: () => "2026-06-13T01:00:00.000Z",
    createId: (() => {
      let eventCount = 0;
      return (prefix) => prefix === "work-run-event"
        ? `${prefix}-default-${++eventCount}`
        : `${prefix}-shared`;
    })(),
  });
  const otherService = new WorkService({
    repoRoot,
    companyId: otherCompanyId,
    now: () => "2026-06-13T01:00:00.000Z",
    createId: (() => {
      let eventCount = 0;
      return (prefix) => prefix === "work-run-event"
        ? `${prefix}-support-${++eventCount}`
        : `${prefix}-shared`;
    })(),
  });

  await defaultService.createWork({
    title: "Default company work",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "shared-source",
    acceptanceCriteria: "Default company success.",
    trigger: { kind: "immediate" },
  });
  await otherService.createWork({
    title: "Support company work",
    createdByMemberId: "nora-automation",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "shared-source",
    acceptanceCriteria: "Support company success.",
    trigger: { kind: "immediate" },
  });

  assert.deepEqual(
    (await defaultService.listWorkTasks()).map((task) => task.title),
    ["Default company work"],
  );
  assert.deepEqual(
    (await otherService.listWorkTasks()).map((task) => task.title),
    ["Support company work"],
  );
  assert.deepEqual(
    (await defaultService.listWorkRuns()).map((run) => run.workTaskId),
    ["work-task-shared"],
  );
  assert.deepEqual(
    (await otherService.listWorkRuns()).map((run) => run.workTaskId),
    ["work-task-shared"],
  );

  const defaultDispatcher = new WorkDispatcher(defaultService);
  const otherDispatcher = new WorkDispatcher(otherService);
  assert.equal((await defaultDispatcher.findNextDispatchCandidate())?.package.title, "Default company work");
  assert.equal((await otherDispatcher.findNextDispatchCandidate())?.package.title, "Support company work");

  await defaultService.moveWorkRun({
    workRunId: "work-run-shared",
    actorMemberId: "iris-growth",
    status: "in_progress",
    summary: "Default company dispatcher started the run.",
  });
  await defaultService.moveWorkRun({
    workRunId: "work-run-shared",
    actorMemberId: "iris-growth",
    status: "canceled",
    reason: "Default company cancellation.",
    summary: "Default company run was canceled.",
  });

  assert.deepEqual(
    (await defaultService.listWorkRuns()).map((run) => run.status),
    ["canceled"],
  );
  assert.deepEqual(
    (await otherService.listWorkRuns()).map((run) => run.status),
    ["queued"],
  );
  assert.deepEqual(
    (await defaultService.getWorkRunDetail("work-run-shared"))?.events.map((event) => event.eventType),
    ["created", "started", "canceled"],
  );
  assert.deepEqual(
    (await otherService.getWorkRunDetail("work-run-shared"))?.events.map((event) => event.eventType),
    ["created"],
  );
});
