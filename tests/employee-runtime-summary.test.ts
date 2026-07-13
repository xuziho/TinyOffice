import assert from "node:assert/strict";
import test from "node:test";

import { buildEmployeeRuntimeSummaryViewModel } from "../src/runtime/employee-status/employee-runtime-summary.js";
import type { EmployeeStatusViewModel } from "../src/runtime/employee-status/employee-status-view-model.js";

test("employee runtime summary preserves current work hrefs for chat context navigation", () => {
  const source: EmployeeStatusViewModel = {
    contract: {
      name: "employee-status",
      version: 1,
      productBoundary: "employee-centered-runtime-status",
    },
    routes: {
      viewModelJsonPath: "/api/companies/acme/employees/status",
    },
    refresh: {
      strategy: "runtime-events",
      reconnectRecovery: true,
    },
    filters: {
      status: "all",
      sort: "recent",
    },
    statusOptions: [],
    sortOptions: [],
    generatedAt: "2026-07-09T00:00:00.000Z",
    employees: [{
      employeeId: "avery",
      displayName: "Avery",
      role: "automation",
      presenceMode: "resident",
      runtime: {
        modelConfigured: true,
        modelDisplay: "openai / gpt",
        thinkingLevel: "medium",
      },
      primaryStatus: {
        kind: "executing",
        label: "Executing",
        reason: "WorkRun is in progress.",
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
      evidence: {
        persistedWorkRunStatus: "in_progress",
        runtimeSessionStatus: "running",
        dispatchLeaseStatus: "active",
      },
      load: {
        runningSessionCount: 0,
        topicInHandCount: 0,
        activeWorkRunCount: 1,
        blockedWorkRunCount: 0,
        activeWorkTaskCount: 1,
        recentFailureCount: 0,
      },
      currentItems: [{
        kind: "work-run",
        id: "work-run-1",
        title: "Avery current work",
        status: "in_progress",
        updatedAt: "2026-07-09T00:00:00.000Z",
        summary: "WorkRun in progress",
        href: "/app/tasks?workTaskId=work-task-1",
      }],
      issues: [],
    }],
    selected: {
      detailSections: [],
    },
  };

  const summary = buildEmployeeRuntimeSummaryViewModel({
    source,
    summaryJsonPath: "/api/companies/acme/employees/runtime-summary",
  });

  assert.equal(summary.employees[0]?.current[0]?.href, "/app/tasks?workTaskId=work-task-1");
});

test("employee runtime summary does not mark active unscheduled tasks as working", () => {
  const source: EmployeeStatusViewModel = {
    contract: {
      name: "employee-status",
      version: 1,
      productBoundary: "employee-centered-runtime-status",
    },
    routes: {
      viewModelJsonPath: "/api/companies/acme/employees/status",
    },
    refresh: {
      strategy: "runtime-events",
      reconnectRecovery: true,
    },
    filters: {
      status: "all",
      sort: "recent",
    },
    statusOptions: [],
    sortOptions: [],
    generatedAt: "2026-07-09T00:00:00.000Z",
    employees: [{
      employeeId: "olivia",
      displayName: "Olivia",
      role: "seo",
      presenceMode: "resident",
      runtime: {
        modelConfigured: true,
        modelDisplay: "openai / gpt",
        thinkingLevel: "medium",
      },
      primaryStatus: {
        kind: "active-task",
        label: "Active task",
        reason: "Has saved WorkTasks but no active runtime execution.",
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
      evidence: {
        persistedWorkRunStatus: "none",
        runtimeSessionStatus: "none",
        dispatchLeaseStatus: "none",
      },
      load: {
        runningSessionCount: 0,
        topicInHandCount: 0,
        activeWorkRunCount: 0,
        blockedWorkRunCount: 0,
        activeWorkTaskCount: 1,
        recentFailureCount: 0,
      },
      currentItems: [{
        kind: "work-task",
        id: "work-task-1",
        title: "Saved manual task",
        status: "active",
        updatedAt: "2026-07-09T00:00:00.000Z",
        summary: "Manual task is saved but not running.",
        href: "/app/tasks?workTaskId=work-task-1",
      }],
      issues: [],
    }],
    selected: {
      detailSections: [],
    },
  };

  const summary = buildEmployeeRuntimeSummaryViewModel({
    source,
    summaryJsonPath: "/api/companies/acme/employees/runtime-summary",
  });

  assert.equal(summary.employees[0]?.status.kind, "idle");
  assert.equal(summary.employees[0]?.counts.activeTaskCount, 1);
  assert.equal(summary.employees[0]?.current[0]?.title, "Saved manual task");
});

test("employee runtime summary does not mark a queued WorkRun as working before execution starts", () => {
  const source = {
    contract: { name: "employee-status", version: 1, productBoundary: "employee-centered-runtime-status" },
    routes: { viewModelJsonPath: "/api/companies/acme/employees/status" },
    refresh: { strategy: "runtime-events", reconnectRecovery: true },
    filters: { status: "all", sort: "recent" },
    statusOptions: [],
    sortOptions: [],
    generatedAt: "2026-07-09T00:00:00.000Z",
    employees: [{
      employeeId: "seasonal-analyst",
      displayName: "Seasonal Analyst",
      role: "analytics",
      presenceMode: "resident",
      runtime: { modelConfigured: true, modelDisplay: "openai / gpt", thinkingLevel: "low" },
      primaryStatus: {
        kind: "has-work",
        label: "Has work",
        reason: "Employee owns a queued WorkRun.",
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
      evidence: {
        persistedWorkRunStatus: "queued",
        runtimeSessionStatus: "not_observed",
        dispatchLeaseStatus: "pending",
      },
      load: {
        runningSessionCount: 0,
        topicInHandCount: 0,
        activeWorkRunCount: 1,
        blockedWorkRunCount: 0,
        activeWorkTaskCount: 1,
        recentFailureCount: 0,
      },
      currentItems: [{
        kind: "work-run",
        id: "work-run-queued",
        title: "Queued analysis",
        status: "queued",
        updatedAt: "2026-07-09T00:00:00.000Z",
        href: "/app/tasks?workTaskId=work-task-queued",
      }],
      issues: [],
    }],
    selected: { detailSections: [] },
  } satisfies EmployeeStatusViewModel;

  const summary = buildEmployeeRuntimeSummaryViewModel({
    source,
    summaryJsonPath: "/api/companies/acme/employees/runtime-summary",
  });

  assert.equal(summary.employees[0]?.status.kind, "idle");
  assert.equal(summary.employees[0]?.counts.activeWorkRunCount, 1);
});
