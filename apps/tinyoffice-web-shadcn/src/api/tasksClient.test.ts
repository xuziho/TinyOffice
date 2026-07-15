import assert from "node:assert/strict";
import test from "node:test";

import { executeTasksRunAction, executeWorkTaskLifecycleAction, getTasksViewModel } from "./tasksClient";

test("getTasksViewModel reads the company-scoped Tasks API with filters", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/tasks") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      contract: { name: "tasks", version: 3, productBoundary: "task-aggregate" },
      routes: { htmlPath: "/tasks", viewModelJsonPath: "/api/companies/ziho-co/tasks/view-model" },
      refresh: { indexIntervalMs: 5000, detailIntervalMs: 3000 },
      filters: { view: "tasks", status: "active", sort: "status", selectedWorkTaskId: "task-1" },
      statusOptions: [],
      sortOptions: [],
      summary: {
        runningRunCount: 0,
        blockedRunCount: 1,
        dispatchFailedCount: 0,
        activeTaskCount: 1,
        enabledScheduleCount: 0,
        participantInputCount: 1,
      },
      tasks: [],
      selected: { kind: undefined },
      recentOperatingEvents: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await getTasksViewModel({
      companyId: "ziho-co",
      status: "active",
      sort: "status",
      workTaskId: "task-1",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(
    requests[0]?.url,
    "http://127.0.0.1:5175/api/companies/ziho-co/tasks/view-model?status=active&sort=status&workTaskId=task-1",
  );
  assert.deepEqual(requests[0]?.init, {
    headers: {
      Accept: "application/json",
    },
  });
});

test("executeTasksRunAction posts the selected Tasks action path", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/tasks") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      accepted: true,
      actionId: "cancel-run",
      workRunId: "run-1",
      status: "canceled",
      message: "Cancel accepted.",
    }), { status: 202, headers: { "Content-Type": "application/json" } });
  };

  try {
    await executeTasksRunAction({
      path: "/api/companies/ziho-co/tasks/runs/run-1/actions/cancel-run",
      reason: "Canceled from Tasks.",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/companies/ziho-co/tasks/runs/run-1/actions/cancel-run");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    reason: "Canceled from Tasks.",
  });
});

test("executeWorkTaskLifecycleAction posts WorkTask lifecycle confirmations", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/tasks") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ task: { id: "work-task-1", status: "archived" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await executeWorkTaskLifecycleAction({
      companyId: "ziho-co",
      workTaskId: "work-task-1",
      action: "archive",
      reason: "Hide from default Tasks.",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/companies/ziho-co/work/work-task-1/archive");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(requests[0]?.init?.headers, {
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    companyId: "ziho-co",
    workTaskId: "work-task-1",
    confirmation: "ARCHIVE",
    reason: "Hide from default Tasks.",
  });
});
