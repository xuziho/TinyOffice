import assert from "node:assert/strict";
import test from "node:test";

import { assertNoForbiddenPublicCarrierFields } from "../../src/collaboration/contracts/conversation-message-contract.js";
import { buildTasksViewModel } from "../../src/work/tasks-view-model.js";
import type { TasksViewState } from "../../src/work/tasks-view-model.js";

const baseTime = "2026-06-16T00:00:00.000Z";

function buildView(): TasksViewState {
  const scheduledTask = {
    id: "task-scheduled",
    title: "Check article quality later",
    description: "Run the quality review after the publishing window.",
    status: "active",
    createdByMemberId: "nora-automation",
    ownerMemberId: "quality-editor",
    domain: undefined,
    sourceKind: "intake_event",
    sourceId: "article-quality-report-1",
    sourceChannelTopicId: "topic-1",
    requesterId: "xuziho",
    acceptanceCriteria: "Quality findings are verified.",
    revision: 1,
    metadata: undefined,
    createdAt: baseTime,
    updatedAt: baseTime,
    completedAt: undefined,
  } as const;
  const blockedTask = {
    ...scheduledTask,
    id: "task-blocked",
    title: "Repair signup analytics",
    ownerMemberId: "iris-growth",
    sourceKind: "chat_request",
    sourceId: "post-2",
    metadata: {
      conversationId: "conversation-signup-analytics",
      messageId: "message-request-2",
      chatEntryId: "chat-entry-signup-analytics",
    },
  } as const;
  const schedule = {
    id: "schedule-scheduled",
    workTaskId: scheduledTask.id,
    status: "enabled",
    kind: "scheduled_once",
    timezone: "Asia/Shanghai",
    scheduleRule: { scheduledFor: "2026-06-16T09:00:00.000Z" },
    nextRunAt: "2026-06-16T09:00:00.000Z",
    lastRunAt: undefined,
    runCount: 0,
    maxRuns: 1,
    pausedReason: undefined,
    canceledReason: undefined,
    createdAt: baseTime,
    updatedAt: baseTime,
  } as const;
  const blockedRun = {
    id: "run-blocked",
    workTaskId: blockedTask.id,
    workScheduleId: undefined,
    status: "blocked",
    assigneeMemberId: "iris-growth",
    taskRevision: 1,
    triggeredBy: "immediate",
    scheduledFor: undefined,
    startedAt: "2026-06-16T00:10:00.000Z",
    completedAt: undefined,
    blockedReason: "Needs GA access.",
    failedReason: undefined,
    canceledReason: undefined,
    resultSummary: undefined,
    createdAt: "2026-06-16T00:05:00.000Z",
    updatedAt: "2026-06-16T00:20:00.000Z",
  } as const;
  return {
    state: {
      tasks: [scheduledTask, blockedTask],
      schedules: [schedule],
      runs: [{
        run: blockedRun,
        task: blockedTask,
        latestLease: {
          id: "lease-1",
          workRunId: blockedRun.id,
          assigneeMemberId: blockedRun.assigneeMemberId,
          sessionKey: "iris-growth|work_run_execution|run-blocked",
          status: "failed",
          dispatchedAt: "2026-06-16T00:07:00.000Z",
          expiresAt: "2026-06-16T00:09:00.000Z",
          failedAt: "2026-06-16T00:08:00.000Z",
          failureReason: "employee busy",
          createdBy: "runtime",
        },
      }],
    },
    summary: {
      activeCount: 0,
      blockedCount: 1,
      dispatchFailedCount: 0,
      recentOperatingEvents: [],
    },
  };
}

test("tasks view model exposes the Task aggregate product contract", () => {
  const model = buildTasksViewModel(buildView(), {
    requestUrl: new URL("http://localhost/tasks?view=tasks"),
    memberProfiles: [{ id: "quality-editor", avatarSeed: "quality-avatar", displayName: "Quality Editor" }],
  });

  assert.deepEqual(model.contract, {
    name: "tasks",
    version: 3,
    productBoundary: "task-aggregate",
  });
  assert.equal(model.routes.htmlPath, "/tasks");
  assert.equal(model.routes.viewModelJsonPath, "/api/companies/:companyId/tasks/view-model");
  assert.equal(model.filters.view, "tasks");
  assert.equal(model.filters.status, "all");
  assert.equal(model.filters.sort, "recent");
  assert.equal(model.tasks.find((task) => task.ownerMemberId === "quality-editor")?.ownerDisplayName, "Quality Editor");
  assert.equal(model.tasks.find((task) => task.ownerMemberId === "quality-editor")?.ownerAvatarSeed, "quality-avatar");
  assert.equal("schedules" in model, false);
  assert.equal("runs" in model, false);
  assert.deepEqual(model.statusOptions.map((option) => option.id), [
    "all",
    "active",
    "completed",
    "canceled",
    "archived",
  ]);
  assert.deepEqual(model.sortOptions.map((option) => option.id), ["recent", "status", "owner"]);
  assert.equal("plans" in model, false);
  assert.doesNotMatch(
    JSON.stringify(model),
    /\/console\/tasks|\/api\/console\/tasks|\/console\/employee-status|employeeStatusHref|tasks-open-native|renderTasksHtml/i,
  );
});

test("tasks view model rejects retired schedule view routes", () => {
  assert.throws(
    () => buildTasksViewModel(buildView(), {
      requestUrl: new URL("http://localhost/api/companies/default-company/tasks/view-model?view=schedules"),
      routes: {
        htmlPath: "/tasks",
        viewModelJsonPath: "/api/companies/default-company/tasks/view-model",
      },
    }),
    /Tasks view only supports view=tasks/,
  );
});

test("tasks view model accepts direct Task route overrides", () => {
  const model = buildTasksViewModel(buildView(), {
    requestUrl: new URL("http://localhost/api/companies/default-company/tasks/view-model?view=tasks"),
    routes: {
      htmlPath: "/tasks",
      viewModelJsonPath: "/api/companies/default-company/tasks/view-model",
    },
  });

  assert.equal(model.routes.htmlPath, "/tasks");
  assert.equal(model.routes.viewModelJsonPath, "/api/companies/default-company/tasks/view-model");
  assert.equal(model.filters.view, "tasks");
});

test("tasks view model projects source links without exposing old carrier language", () => {
  const model = buildTasksViewModel(buildView(), new URL("http://localhost/tasks?view=tasks"));

  assertNoForbiddenPublicCarrierFields(model);
  assert.doesNotMatch(JSON.stringify(model), /\brootPostId\b/);
  assert.deepEqual(
    model.tasks.map((task) => [task.id, task.sourceLink]),
    [
      ["task-blocked", {
        kind: "conversation-message",
        href: "/app/tasks/source/chat-message/conversation-signup-analytics%3Amessage-request-2",
        label: "Message message-request-2",
        conversationId: "conversation-signup-analytics",
        messageId: "message-request-2",
        chatEntryId: "chat-entry-signup-analytics",
      }],
      ["task-scheduled", {
        kind: "intake-event",
        href: "/app/tasks/source/intake-event/article-quality-report-1",
        label: "Intake event article-quality-report-1",
        sourceId: "article-quality-report-1",
      }],
    ],
  );
  assert.doesNotMatch(JSON.stringify(model), /legacy-carrier|Mattermost/i);
});

test("tasks view model keeps owner and assignee facts as metadata without native Employee Status hrefs", () => {
  const model = buildTasksViewModel(buildView(), new URL("http://localhost/tasks"));

  assert.deepEqual(
    model.tasks.map((task) => [task.id, task.ownerMemberId]),
    [
      ["task-blocked", "iris-growth"],
      ["task-scheduled", "quality-editor"],
    ],
  );
  assert.deepEqual(model.tasks.map((task) => [task.id, task.latestExecution?.assigneeMemberId]), [
    ["task-blocked", "iris-growth"],
    ["task-scheduled", undefined],
  ]);
  assert.equal(model.tasks[0]?.requesterMemberId, "xuziho");
  assert.deepEqual(
    model.tasks[0]?.latestExecution?.actions.filter((action) => action.enabled).map((action) => action.id),
    ["cancel-run"],
  );
  assert.doesNotMatch(JSON.stringify(model), /\/console\/employee-status|employeeStatusHref/i);
});

test("tasks view model keeps future scheduled tasks visible before a run exists", () => {
  const model = buildTasksViewModel(buildView(), new URL("http://localhost/tasks?view=tasks"));

  assert.equal(model.summary.activeTaskCount, 2);
  assert.equal(model.summary.enabledScheduleCount, 1);
  assert.equal(model.summary.participantInputCount, 1);
  assert.deepEqual(
    model.tasks.map((task) => [task.id, task.schedule.kind, task.executionCount, task.nextStep]),
    [
      ["task-blocked", "none", 1, "Waiting for participant input on run-blocked."],
      ["task-scheduled", "scheduled_once", 0, "Next scheduled run at 2026-06-16T09:00:00.000Z."],
    ],
  );
});

test("tasks view model describes completed Tasks from the latest execution result", () => {
  const view = buildView();
  const task = {
    ...view.state.tasks[0]!,
    id: "task-completed",
    title: "Create automation employee",
    status: "completed",
    completedAt: "2026-06-16T00:40:00.000Z",
    updatedAt: "2026-06-16T00:40:00.000Z",
  } as const;
  view.state.tasks = [task];
  view.state.schedules = [];
  view.state.runs = [{
    run: {
      id: "run-completed",
      workTaskId: task.id,
      workScheduleId: undefined,
      status: "done",
      assigneeMemberId: "quality-editor",
      triggeredBy: "immediate",
      scheduledFor: undefined,
      startedAt: "2026-06-16T00:10:00.000Z",
      completedAt: "2026-06-16T00:40:00.000Z",
      blockedReason: undefined,
      failedReason: undefined,
      canceledReason: undefined,
      resultSummary: "Automation employee Avery was created and verified.",
      createdAt: "2026-06-16T00:05:00.000Z",
      updatedAt: "2026-06-16T00:40:00.000Z",
    },
    task,
  }];

  const model = buildTasksViewModel(view, new URL("http://localhost/tasks"));

  assert.equal(model.tasks[0]?.nextStep, "Completed: Automation employee Avery was created and verified.");
});

test("tasks view model filters only the Task primary view against Task status", () => {
  const view = buildView();
  view.state.tasks = [
    { ...view.state.tasks[0]!, id: "task-active", status: "active", updatedAt: "2026-06-16T00:10:00.000Z" },
    { ...view.state.tasks[0]!, id: "task-canceled", status: "canceled", canceledReason: "Withdrawn.", updatedAt: "2026-06-16T00:30:00.000Z" },
  ];
  view.state.schedules = [
    { ...view.state.schedules[0]!, id: "schedule-enabled", status: "enabled", updatedAt: "2026-06-16T00:10:00.000Z" },
    { ...view.state.schedules[0]!, id: "schedule-paused", status: "paused", pausedReason: "Waiting.", updatedAt: "2026-06-16T00:20:00.000Z" },
  ];

  const taskModel = buildTasksViewModel(view, new URL("http://localhost/tasks?view=tasks&status=canceled"));
  assert.throws(
    () => buildTasksViewModel(view, new URL("http://localhost/tasks?view=schedules&status=paused")),
    /Tasks view only supports view=tasks/,
  );

  assert.deepEqual(taskModel.tasks.map((task) => [task.id, task.status]), [["task-canceled", "canceled"]]);
});

test("tasks view model hides archived WorkTasks from the default task list", () => {
  const view = buildView();
  view.state.tasks = [
    { ...view.state.tasks[0]!, id: "task-active", status: "active", updatedAt: "2026-06-16T00:10:00.000Z" },
    { ...view.state.tasks[0]!, id: "task-archived", status: "archived", updatedAt: "2026-06-16T00:30:00.000Z" },
  ];

  const defaultModel = buildTasksViewModel(view, new URL("http://localhost/tasks?view=tasks&status=all"));
  const archivedModel = buildTasksViewModel(view, new URL("http://localhost/tasks?view=tasks&status=archived"));

  assert.deepEqual(defaultModel.tasks.map((task) => [task.id, task.status]), [["task-active", "active"]]);
  assert.deepEqual(archivedModel.tasks.map((task) => [task.id, task.status]), [["task-archived", "archived"]]);
});

test("tasks view model rejects retired run view routes", () => {
  assert.throws(
    () => buildTasksViewModel(buildView(), new URL("http://localhost/tasks?view=runs")),
    /Tasks view only supports view=tasks/,
  );
});

test("tasks view model exposes selected Task detail with schedule and executions nested inside", () => {
  const taskView = buildView();
  taskView.state.selectedWorkTaskId = "task-scheduled";
  taskView.state.selectedTaskDetail = {
    task: taskView.state.tasks[0]!,
    revisions: [{
      id: "revision-task-scheduled-1",
      workTaskId: "task-scheduled",
      revision: 1,
      title: "Check article quality later",
      description: "Run the quality review after the publishing window.",
      acceptanceCriteria: "Quality findings are verified.",
      changedByMemberId: "nora-automation",
      reason: "Initial Task objective confirmed.",
      createdAt: baseTime,
    }],
    schedules: [taskView.state.schedules[0]!],
    runs: [],
  };

  const taskModel = buildTasksViewModel(taskView, new URL("http://localhost/tasks?view=tasks"));

  assert.equal(taskModel.selected.kind, "task");
  assert.equal(taskModel.selected.kind === "task" ? taskModel.selected.task.schedule.kind : undefined, "scheduled_once");
  assert.equal(taskModel.selected.kind === "task" ? taskModel.selected.task.scheduleRecord?.kind : undefined, "scheduled_once");
  assert.equal(taskModel.selected.kind === "task" ? taskModel.selected.task.executions.length : 0, 0);
  assert.equal(taskModel.selected.kind === "task" ? taskModel.selected.task.revisions[0]?.revision : undefined, 1);
});
