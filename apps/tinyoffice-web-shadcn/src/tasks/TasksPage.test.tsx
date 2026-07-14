import assert from "node:assert/strict";
import test from "node:test";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TasksViewModel, TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";

const currentSession: TinyOfficeCurrentSession = {
  schema: "tinyoffice-current-session",
  version: 2,
  user: { id: "user-xu", displayName: "Xu Ziho" },
  currentCompanyId: "ziho-e-com",
  member: { memberId: "xuziho", displayName: "Xu Ziho", role: "boss" },
  needsProfileInitialization: false,
  needsCompanyInitialization: false,
};

function tasksViewModel(): TasksViewModel {
  return {
    contract: { name: "tasks", version: 3, productBoundary: "task-aggregate" },
    routes: {
      htmlPath: "/tasks",
      viewModelJsonPath: "/api/companies/ziho-e-com/tasks/view-model",
    },
    refresh: { indexIntervalMs: 5000, detailIntervalMs: 3000 },
    filters: {
      view: "tasks",
      status: "all",
      sort: "recent",
      selectedWorkTaskId: "work-task-1",
    },
    statusOptions: [
      { id: "all", label: "All", count: 1 },
      { id: "active", label: "Active", count: 1 },
    ],
    sortOptions: [
      { id: "recent", label: "Recent" },
      { id: "status", label: "Status" },
    ],
    summary: {
      runningRunCount: 0,
      blockedRunCount: 1,
      dispatchFailedCount: 0,
      activeTaskCount: 1,
      enabledScheduleCount: 1,
      participantInputCount: 1,
    },
    tasks: [{
      id: "work-task-1",
      title: "Publish weekly social update",
      status: "active",
      ownerMemberId: "alex",
      ownerDisplayName: "Alex",
      sourceKind: "chat_request",
      updatedAt: "2026-07-06T00:00:00.000Z",
      acceptanceCriteria: "Published post URL is recorded.",
      revision: 1,
      nextStep: "Waiting for participant input on work-run-1.",
      schedule: {
        kind: "recurring",
        status: "enabled",
        nextRunAt: "2026-07-07T09:00:00.000Z",
        ruleSummary: "Weekly - Tue 17:00",
        runCount: 1,
        maxRuns: 12,
        timezone: "Asia/Shanghai",
      },
      executionCount: 1,
      latestExecution: {
        id: "work-run-1",
        workTaskId: "work-task-1",
        title: "Publish weekly social update",
        status: "blocked",
        assigneeMemberId: "alex",
        taskRevision: 1,
        sourceKind: "chat_request",
        updatedAt: "2026-07-06T00:05:00.000Z",
        nextStep: "Waiting for participant input.",
        needsParticipantInput: true,
        actions: [{
          id: "cancel-run",
          label: "Cancel",
          method: "post",
          path: "/api/companies/ziho-e-com/tasks/runs/work-run-1/actions/cancel-run",
          enabled: true,
        }],
      },
    }],
    selected: { kind: undefined },
    recentOperatingEvents: [],
  };
}

function taskSelectedViewModel(status: "active" | "canceled" | "archived"): TasksViewModel {
  const model = tasksViewModel();
  model.filters = { view: "tasks", status: "all", sort: "recent", selectedWorkTaskId: "work-task-1" };
  model.selected = {
    kind: "task",
    task: {
      id: "work-task-1",
      title: "Publish weekly social update",
      status,
      ownerMemberId: "alex",
      ownerDisplayName: "Alex",
      sourceKind: "chat_request",
      sourceLink: {
        kind: "conversation-message",
        href: "/app/tasks/source/chat-message/conversation-mira%3Amessage-1",
        label: "Message message-1",
        conversationId: "conversation-mira",
        messageId: "message-1",
        chatEntryId: "chat-entry-mira",
      },
      updatedAt: "2026-07-06T00:00:00.000Z",
      acceptanceCriteria: "Published post URL is recorded.",
      revision: 1,
      nextStep: "Task is ready for lifecycle action.",
      schedule: {
        kind: "recurring",
        status: "enabled",
        nextRunAt: "2026-07-07T09:00:00.000Z",
        ruleSummary: "Weekly - Tue 17:00",
        runCount: 1,
      },
      executionCount: 1,
      revisions: [{
        revision: 1,
        title: "Publish weekly social update",
        acceptanceCriteria: "Published post URL is recorded.",
        changedByMemberId: "xuziho",
        reason: "Initial Task objective confirmed.",
        createdAt: "2026-07-06T00:00:00.000Z",
      }],
      scheduleRecord: {
        id: "work-schedule-1",
        workTaskId: "work-task-1",
        title: "Publish weekly social update",
        status: "enabled",
        ownerMemberId: "alex",
        kind: "recurring",
        nextRunAt: "2026-07-07T09:00:00.000Z",
        updatedAt: "2026-07-06T00:00:00.000Z",
        runCount: 1,
        nextStep: "Next scheduled run at 2026-07-07T09:00:00.000Z.",
      },
      executions: [],
    },
  };
  return model;
}

test("renders Tasks as a background Task operations console", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { TasksPage } = await import("./TasksPage");
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    chatQueryKeys.tasks("ziho-e-com", {
      status: "all",
      sort: "recent",
      workTaskId: undefined,
    }),
    tasksViewModel(),
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TasksPage currentSession={currentSession} />
    </QueryClientProvider>,
  );

  assert.match(html, /Tasks/);
  assert.match(html, /Task command center/);
  assert.doesNotMatch(html, /Task command center · ziho-e-com/);
  assert.doesNotMatch(html, /New Task|Create Task/);
  assert.match(html, />Task</);
  assert.match(html, />State</);
  assert.match(html, />Owner</);
  assert.match(html, />Next action</);
  assert.match(html, />Updated</);
  assert.match(html, /grid-rows-\[auto_minmax\(0,1fr\)\] overflow-hidden/);
  assert.match(html, /role="tab"/);
  assert.match(html, />Current /);
  assert.match(html, />Scheduled /);
  assert.match(html, />History /);
  assert.doesNotMatch(html, /grid-cols-\[minmax\(0,1fr\)_minmax\(420px,26vw\)\]/);
  assert.doesNotMatch(html, /Select Task/);
  assert.doesNotMatch(html, /Back to task list/);
  assert.match(html, /Search tasks\.\.\./);
  assert.match(html, /More filters/);
  assert.match(html, /aria-label="Sort tasks"/);
  assert.match(html, /Publish weekly social update/);
  assert.match(html, /href="\/tasks\?taskId=work-task-1"/);
  assert.match(html, /Needs attention/);
  assert.match(html, /Waiting for participant input\./);
  assert.doesNotMatch(html, />Trigger</);
  assert.doesNotMatch(html, />Plan</);
  assert.doesNotMatch(html, /trigger rule/);
  assert.doesNotMatch(html, /chat_request -/);
  assert.doesNotMatch(html, /Current WorkRun ownership/);
  assert.doesNotMatch(html, /Work command center|New Work|Back to work list|Open work|Cancel Work|Create Work|This Work|>Work</);
  assert.doesNotMatch(html, /automation script/i);
  assert.doesNotMatch(html, /auto repair/i);
});

test("explains AI-created Task paths when the Company has no Tasks", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { TasksPage } = await import("./TasksPage");
  const queryClient = new QueryClient();
  const model = tasksViewModel();
  model.tasks = [];
  model.selected = { kind: undefined };
  queryClient.setQueryData(chatQueryKeys.tasks("ziho-e-com", { status: "all", sort: "recent", workTaskId: undefined }), model);

  const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}><TasksPage currentSession={currentSession} /></QueryClientProvider>);

  assert.match(html, /No Tasks yet/);
  assert.match(html, /created after you confirm background work in Chat/);
  assert.match(html, /href="\/chat"/);
  assert.match(html, /href="\/integrations"/);
  assert.doesNotMatch(html, /Create Task|New Task/);
});

test("constrains long Task table metadata so right columns do not overlap", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { TasksPage } = await import("./TasksPage");
  const model = tasksViewModel();
  model.tasks[0] = {
    ...model.tasks[0]!,
    ownerMemberId: "tinyoffice-company-control-plane-S7yekK-iris-growth",
    ownerDisplayName: "Iris Growth",
    nextStep: "Queued run tinyoffice-company-control-plane-S7yekK-work-run-3 is waiting for dispatch.",
  };
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    chatQueryKeys.tasks("ziho-e-com", {
      status: "all",
      sort: "recent",
      workTaskId: undefined,
    }),
    model,
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TasksPage currentSession={currentSession} />
    </QueryClientProvider>,
  );

  assert.match(html, /Iris Growth/);
  assert.doesNotMatch(html, /title="tinyoffice-company-control-plane-S7yekK-iris-growth"/);
  assert.doesNotMatch(html, /Queued run tinyoffice-company-control-plane-S7yekK-work-run-3 is waiting for dispatch\./);
  assert.match(html, />Current /);
  assert.doesNotMatch(html, /title="tinyoffice-company-control-plane-S7yekK-iris-growth"/);
});

test("renders a selected Task as a full-width detail route with a back action", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { TasksPage } = await import("./TasksPage");
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    chatQueryKeys.tasks("ziho-e-com", {
      status: "all",
      sort: "recent",
      workTaskId: "work-task-1",
    }),
    taskSelectedViewModel("canceled"),
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TasksPage currentSession={currentSession} focus={{ workTaskId: "work-task-1" }} />
    </QueryClientProvider>,
  );

  assert.match(html, /Back to task list/);
  assert.match(html, /href="\/tasks"/);
  assert.match(html, /Current state/);
  assert.match(html, /Objective/);
  assert.match(html, /Source/);
  assert.match(html, /Open source discussion/);
  assert.match(html, /href="\/chat\?roomId=conversation-mira"/);
  assert.match(html, /Schedule/);
  assert.match(html, /History/);
  assert.match(html, /Archive/);
  assert.doesNotMatch(html, /Cancel Work/);
  assert.doesNotMatch(html, /Back to work list|New Work|Open work|Create Work|This Work|>Work</);
  assert.doesNotMatch(html, /Owner member\.\.\./);
  assert.doesNotMatch(html, /grid-cols-\[minmax\(0,1fr\)_minmax\(420px,26vw\)\]/);
});

test("renders retry for a failed WorkRun while its Task remains active", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { TasksPage } = await import("./TasksPage");
  const model = taskSelectedViewModel("active");
  if (model.selected.kind === "task") {
    model.selected.task.latestExecution = {
      id: "work-run-failed",
      workTaskId: "work-task-1",
      title: "Publish weekly social update",
      status: "failed",
      assigneeMemberId: "alex",
      taskRevision: 1,
      sourceKind: "chat_request",
      updatedAt: "2026-07-06T00:05:00.000Z",
      nextStep: "The publishing API was temporarily unavailable.",
      needsParticipantInput: false,
      actions: [{
        id: "retry-run",
        label: "Retry WorkRun",
        method: "post",
        path: "/api/companies/ziho-e-com/tasks/runs/work-run-failed/actions/retry-run",
        enabled: true,
      }],
    };
    model.selected.task.executions = [{
      id: "work-run-failed",
      workTaskId: "work-task-1",
      title: "Publish weekly social update",
      status: "failed",
      assigneeMemberId: "alex",
      taskRevision: 1,
      sourceKind: "chat_request",
      updatedAt: "2026-07-06T00:05:00.000Z",
      nextStep: "The publishing API was temporarily unavailable.",
      needsParticipantInput: false,
      actions: [{
        id: "retry-run",
        label: "Retry WorkRun",
        method: "post",
        path: "/api/companies/ziho-e-com/tasks/runs/work-run-failed/actions/retry-run",
        enabled: true,
      }],
    }];
  }
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    chatQueryKeys.tasks("ziho-e-com", {
      status: "all",
      sort: "recent",
      workTaskId: "work-task-1",
    }),
    model,
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TasksPage currentSession={currentSession} focus={{ workTaskId: "work-task-1" }} />
    </QueryClientProvider>,
  );

  assert.match(html, /Retry WorkRun/);
  assert.match(html, /work-run-failed/);
});

test("renders a source return action when a Task was opened from another surface", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { TasksPage } = await import("./TasksPage");
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    chatQueryKeys.tasks("ziho-e-com", {
      status: "all",
      sort: "recent",
      workTaskId: "work-task-1",
    }),
    taskSelectedViewModel("active"),
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TasksPage
        currentSession={currentSession}
        focus={{ workTaskId: "work-task-1" }}
        returnContext={{ label: "Back to Mira DM", target: { kind: "chat-room", roomId: "conversation-mira", surface: "direct" } }}
        onOpenNavigationTarget={() => {}}
      />
    </QueryClientProvider>,
  );

  assert.match(html, /Back to Mira DM/);
  assert.match(html, /href="\/chat\?roomId=conversation-mira&amp;surface=direct"/);
  assert.doesNotMatch(html, /Back to task list/);
});

test("ignores stale selected detail after returning to the Task list", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { TasksPage } = await import("./TasksPage");
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    chatQueryKeys.tasks("ziho-e-com", {
      status: "all",
      sort: "recent",
      workTaskId: undefined,
    }),
    taskSelectedViewModel("canceled"),
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TasksPage currentSession={currentSession} focus={{ workTaskId: "work-task-1" }} />
    </QueryClientProvider>,
  );

  assert.doesNotMatch(html, /New Task|Create Task/);
  assert.match(html, />Current /);
  assert.match(html, />Scheduled /);
  assert.match(html, />History /);
  assert.doesNotMatch(html, /Back to task list/);
  assert.doesNotMatch(html, /Current state/);
});
