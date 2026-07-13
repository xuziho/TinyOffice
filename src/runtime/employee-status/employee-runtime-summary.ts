import type { EmployeeStatusCurrentItem, EmployeeStatusIssue, EmployeeStatusViewModel } from "./employee-status-view-model.js";

export type EmployeeRuntimeSummaryStatusKind =
  | "needs_approval"
  | "blocked"
  | "working"
  | "idle";

export interface EmployeeRuntimeSummaryCurrentItem {
  kind: EmployeeStatusCurrentItem["kind"];
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  summary?: string;
  href?: string;
}

export interface EmployeeRuntimeSummaryIssue {
  kind: "blocked-work-run";
  title: string;
  summary: string;
  status: string;
  updatedAt: string;
  target: EmployeeStatusIssue["target"];
  relatedTarget?: EmployeeStatusIssue["relatedTarget"];
}

export interface EmployeeRuntimeSummaryCard {
  employeeId: string;
  displayName: string;
  role: string;
  status: {
    kind: EmployeeRuntimeSummaryStatusKind;
    label: string;
    reason: string;
    updatedAt?: string;
  };
  counts: {
    pendingApprovalCount: number;
    blockedWorkRunCount: number;
    activeWorkRunCount: number;
    activeTaskCount: number;
    recentFailureCount: number;
  };
  current: EmployeeRuntimeSummaryCurrentItem[];
  issues: EmployeeRuntimeSummaryIssue[];
}

export interface EmployeeRuntimeSummaryViewModel {
  contract: {
    name: "employee-runtime-summary";
    version: 1;
    productBoundary: "chat-employee-context-runtime-summary";
  };
  routes: {
    summaryJsonPath: string;
  };
  generatedAt: string;
  employees: EmployeeRuntimeSummaryCard[];
}

export function buildEmployeeRuntimeSummaryViewModel(input: {
  source: EmployeeStatusViewModel;
  summaryJsonPath: string;
  employeeId?: string;
}): EmployeeRuntimeSummaryViewModel {
  const employees = input.source.employees
    .filter((employee) => !input.employeeId || employee.employeeId === input.employeeId)
    .map((employee): EmployeeRuntimeSummaryCard => ({
      employeeId: employee.employeeId,
      displayName: employee.displayName,
      role: employee.role,
      status: runtimeSummaryStatusForEmployee(employee),
      counts: {
        pendingApprovalCount: 0,
        blockedWorkRunCount: employee.load.blockedWorkRunCount,
        activeWorkRunCount: employee.load.activeWorkRunCount,
        activeTaskCount: employee.load.activeWorkTaskCount,
        recentFailureCount: employee.load.recentFailureCount,
      },
      current: employee.currentItems.map(sanitizeCurrentItem),
      issues: employee.issues.filter(isActionableIssue).map(sanitizeIssue),
    }));

  return {
    contract: {
      name: "employee-runtime-summary",
      version: 1,
      productBoundary: "chat-employee-context-runtime-summary",
    },
    routes: {
      summaryJsonPath: input.summaryJsonPath,
    },
    generatedAt: input.source.generatedAt,
    employees,
  };
}

function runtimeSummaryStatusForEmployee(
  employee: EmployeeStatusViewModel["employees"][number],
): EmployeeRuntimeSummaryCard["status"] {
  if (
    employee.load.runningSessionCount > 0 ||
    employee.currentItems.some((item) => item.kind === "work-run" && item.status === "in_progress") ||
    employee.primaryStatus.kind === "executing"
  ) {
    return {
      kind: "working",
      label: "Working",
      reason: employee.primaryStatus.reason,
      updatedAt: employee.primaryStatus.updatedAt,
    };
  }
  if (employee.load.blockedWorkRunCount > 0) {
    const blocked = employee.currentItems.find((item) => item.kind === "work-run" && item.status === "blocked");
    return {
      kind: "blocked",
      label: "Blocked",
      reason: blocked?.summary || employee.primaryStatus.reason,
      updatedAt: blocked?.updatedAt || employee.primaryStatus.updatedAt,
    };
  }
  return {
    kind: "idle",
    label: "Idle",
    reason: employee.primaryStatus.reason,
    updatedAt: employee.primaryStatus.updatedAt,
  };
}

function isActionableIssue(issue: EmployeeStatusIssue): issue is EmployeeStatusIssue & { kind: "blocked-work-run" } {
  return issue.kind === "blocked-work-run";
}

function sanitizeIssue(issue: EmployeeStatusIssue): EmployeeRuntimeSummaryIssue {
  return {
    kind: "blocked-work-run",
    title: issue.title,
    summary: issue.summary,
    status: issue.status,
    updatedAt: issue.updatedAt,
    target: issue.target,
    ...(issue.relatedTarget ? { relatedTarget: issue.relatedTarget } : {}),
  };
}

function sanitizeCurrentItem(item: EmployeeStatusCurrentItem): EmployeeRuntimeSummaryCurrentItem {
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    status: item.status,
    updatedAt: item.updatedAt,
    ...(item.summary ? { summary: item.summary } : {}),
    ...(item.href ? { href: item.href } : {}),
  };
}
