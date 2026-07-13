import type {
  SessionExplorerIndex,
  SessionExplorerSessionDetail,
  SessionExplorerSessionSummary,
} from "./session-explorer-types.js";

export type SessionExplorerListMode = "flat" | "employee_grouped";

export type SessionExplorerDetailSectionId =
  | "session-overview"
  | "runtime-turns"
  | "evidence-package";

export interface SessionExplorerViewModelRoutes {
  indexJsonPath: string;
  detailJsonPath: string;
  viewModelJsonPath: string;
}

export interface SessionExplorerRefreshContract {
  strategy: "runtime-events";
  snapshotUses: Array<"initial-load" | "manual-refresh" | "reconnect-reconciliation">;
  eventSources: Array<"session" | "employee" | "process_trace">;
  expectsRunningSessions: boolean;
  expectsIncrementalDetailEvents: boolean;
}

export interface SessionExplorerDetailSection {
  id: SessionExplorerDetailSectionId;
  title: string;
  defaultOpen: boolean;
  factLayer: boolean;
}

export interface SessionExplorerEmployeeFilterOption {
  employeeId: string;
  displayName: string;
  count: number;
}

export interface SessionExplorerViewModel {
  contract: {
    name: "session-explorer";
    version: 1;
    runtimeBoundary: "runtime-session-inspector";
  };
  routes: SessionExplorerViewModelRoutes;
  refresh: SessionExplorerRefreshContract;
  filters: {
    query: string;
    employeeIdFilter: string;
  };
  index: SessionExplorerIndex;
  selectedSession: {
    employeeId: string;
    sessionId: string;
  } | null;
  list: {
    mode: SessionExplorerListMode;
    sessions: SessionExplorerSessionSummary[];
    queryMatchedSessionCount: number;
    employeeFilters: SessionExplorerEmployeeFilterOption[];
    selectedKey?: string;
  };
  sections: SessionExplorerDetailSection[];
  detail?: SessionExplorerSessionDetail & {
    sections: SessionExplorerDetailSection[];
  };
}

export interface BuildSessionExplorerViewModelInput {
  index: SessionExplorerIndex;
  selectedDetail?: SessionExplorerSessionDetail;
  query?: string;
  employeeIdFilter?: string;
  routes?: Partial<SessionExplorerViewModelRoutes>;
}

const DEFAULT_ROUTES: SessionExplorerViewModelRoutes = {
  indexJsonPath: "/api/companies/:companyId/sessions/view-model",
  detailJsonPath: "/api/companies/:companyId/sessions/view-model",
  viewModelJsonPath: "/api/companies/:companyId/sessions/view-model",
};

const REFRESH_CONTRACT: SessionExplorerRefreshContract = {
  strategy: "runtime-events",
  snapshotUses: ["initial-load", "manual-refresh", "reconnect-reconciliation"],
  eventSources: ["session", "employee", "process_trace"],
  expectsRunningSessions: true,
  expectsIncrementalDetailEvents: true,
};

const DETAIL_SECTIONS: SessionExplorerDetailSection[] = [
  {
    id: "session-overview",
    title: "Session Overview",
    defaultOpen: true,
    factLayer: false,
  },
  {
    id: "runtime-turns",
    title: "Runtime Turns",
    defaultOpen: true,
    factLayer: false,
  },
  {
    id: "evidence-package",
    title: "Evidence Package",
    defaultOpen: true,
    factLayer: false,
  },
];

export function keyForSessionSummary(session: SessionExplorerSessionSummary) {
  return `${session.employeeId}::${session.sessionId}`;
}

export function matchesExplorerQuery(
  session: SessionExplorerSessionSummary,
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return [
    session.employeeId,
    session.displayName,
    session.role,
    session.sessionId,
    session.sessionKey,
    ...session.evidenceLinks.flatMap((link) => [
      link.label,
      link.targetId,
    ]),
    session.requesterUsername,
    session.lastAssistantMessagePreview,
    session.lastUserMessagePreview,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase()
    .includes(normalized);
}

export function getEmployeeFilterOptions(
  sessions: SessionExplorerSessionSummary[],
): SessionExplorerEmployeeFilterOption[] {
  const groups = new Map<string, SessionExplorerSessionSummary[]>();
  for (const session of sessions) {
    const group = groups.get(session.employeeId) || [];
    group.push(session);
    groups.set(session.employeeId, group);
  }

  return Array.from(groups.values()).map((group) => {
    const first = group[0] as SessionExplorerSessionSummary;
    return {
      employeeId: first.employeeId,
      displayName: first.displayName,
      count: group.length,
    };
  });
}

export function buildSessionExplorerViewModel(
  input: BuildSessionExplorerViewModelInput,
): SessionExplorerViewModel {
  const query = input.query || "";
  const employeeIdFilter = input.employeeIdFilter || "";
  const queryFilteredSessions = input.index.sessions.filter((session) =>
    matchesExplorerQuery(session, query),
  );
  const filteredSessions = queryFilteredSessions.filter(
    (session) => !employeeIdFilter || session.employeeId === employeeIdFilter,
  );
  const selectedSession = input.selectedDetail
    ? {
        employeeId: input.selectedDetail.summary.employeeId,
        sessionId: input.selectedDetail.summary.sessionId,
      }
    : null;

  return {
    contract: {
      name: "session-explorer",
      version: 1,
      runtimeBoundary: "runtime-session-inspector",
    },
    routes: {
      ...DEFAULT_ROUTES,
      ...input.routes,
    },
    refresh: { ...REFRESH_CONTRACT },
    filters: {
      query,
      employeeIdFilter,
    },
    index: input.index,
    selectedSession,
    list: {
      mode: employeeIdFilter ? "employee_grouped" : "flat",
      sessions: filteredSessions,
      queryMatchedSessionCount: queryFilteredSessions.length,
      employeeFilters: getEmployeeFilterOptions(queryFilteredSessions),
      selectedKey: input.selectedDetail
        ? keyForSessionSummary(input.selectedDetail.summary)
        : undefined,
    },
    sections: DETAIL_SECTIONS.map((section) => ({ ...section })),
    detail: input.selectedDetail
      ? {
          ...input.selectedDetail,
          sections: DETAIL_SECTIONS.map((section) => ({ ...section })),
        }
      : undefined,
  };
}
