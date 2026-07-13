import path from "node:path";

import { loadEmployeesAdminState } from "../company-config/employees-admin.js";
import { RuntimeSessionRepository } from "../storage/runtime-session-repository.js";
import {
  buildSessionExplorerViewModel,
  type SessionExplorerViewModel,
  type SessionExplorerViewModelRoutes,
} from "./session-explorer-view-model.js";
import {
  nowIso,
  runtimeDetailToSessionExplorerDetail,
  summarizeRuntimeSessionRecord,
} from "./session-explorer-projection.js";
import type {
  SessionExplorerIndex,
  SessionExplorerSessionDetail,
} from "./session-explorer-types.js";
import type { RuntimeSessionRecord } from "../storage/runtime-session-repository.js";

function isProductVisibleSessionRecord(record: RuntimeSessionRecord) {
  return !record.id.startsWith("tinyoffice-chat-session:");
}

async function loadEmployeeProfileMap(input: {
  repoRoot: string;
  companyId: string;
}) {
  const state = await loadEmployeesAdminState({
    repoRoot: input.repoRoot,
    companyId: input.companyId,
  });
  return new Map(
    state.employees.map((employee) => [
      employee.employeeId,
      {
        displayName: employee.profile.displayName || employee.employeeId,
        role: employee.profile.role,
      },
    ]),
  );
}

export async function loadDatabaseSessionExplorerIndex(
  repoRoot: string,
  companyId: string,
): Promise<SessionExplorerIndex> {
  const [employeeProfiles, runtimeRepository] = await Promise.all([
    loadEmployeeProfileMap({ repoRoot, companyId }),
    RuntimeSessionRepository.open(repoRoot, { companyId }),
  ]);
  try {
    const records = runtimeRepository.listSessionRecords()
      .filter(isProductVisibleSessionRecord);
    const sessions = records.map((record) => {
      const detail = runtimeRepository.getSessionDetail(record.id);
      return summarizeRuntimeSessionRecord({
        record,
        events: detail?.events || [],
        processTraceEvents: runtimeRepository.listProcessTraceEvents({
          sessionKey: record.sessionKey,
        }),
        employeeProfiles,
      });
    });
    return {
      generatedAt: nowIso(),
      employeeCount:
        employeeProfiles.size ||
        new Set(records.map((record) => record.employeeId)).size,
      sessionCount: sessions.length,
      sessions,
    };
  } finally {
    runtimeRepository.close();
  }
}

export async function loadDatabaseSessionExplorerSessionDetail(input: {
  repoRoot: string;
  companyId: string;
  employeeId: string;
  sessionId: string;
}): Promise<SessionExplorerSessionDetail | undefined> {
  if (!input.sessionId || input.sessionId !== path.basename(input.sessionId)) {
    return undefined;
  }

  const [employeeProfiles, runtimeRepository] = await Promise.all([
    loadEmployeeProfileMap({
      repoRoot: input.repoRoot,
      companyId: input.companyId,
    }),
    RuntimeSessionRepository.open(input.repoRoot, { companyId: input.companyId }),
  ]);
  try {
    const detail = runtimeRepository.getSessionDetail(input.sessionId);
    if (
      !detail ||
      detail.record.employeeId !== input.employeeId ||
      !isProductVisibleSessionRecord(detail.record)
    ) {
      return undefined;
    }
    return runtimeDetailToSessionExplorerDetail({
      record: detail.record,
      events: detail.events,
      processTraceEvents: runtimeRepository.listProcessTraceEvents({
        sessionKey: detail.record.sessionKey,
      }),
      collaborationActionEvents: runtimeRepository.listCollaborationActionEvents({
        employeeId: detail.record.employeeId,
      }),
      employeeProfiles,
    });
  } finally {
    runtimeRepository.close();
  }
}

export async function loadDatabaseSessionExplorerViewModel(input: {
  repoRoot: string;
  companyId: string;
  employeeId?: string;
  sessionId?: string;
  query?: string;
  employeeIdFilter?: string;
  routes?: Partial<SessionExplorerViewModelRoutes>;
}): Promise<SessionExplorerViewModel> {
  const index = await loadDatabaseSessionExplorerIndex(input.repoRoot, input.companyId);
  const selectedDetail =
    input.employeeId && input.sessionId
      ? await loadDatabaseSessionExplorerSessionDetail({
          repoRoot: input.repoRoot,
          companyId: input.companyId,
          employeeId: input.employeeId,
          sessionId: input.sessionId,
        })
      : undefined;

  return buildSessionExplorerViewModel({
    index,
    selectedDetail,
    query: input.query,
    employeeIdFilter: input.employeeIdFilter,
    routes: input.routes,
  });
}
