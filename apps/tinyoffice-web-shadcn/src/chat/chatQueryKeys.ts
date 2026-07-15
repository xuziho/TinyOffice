type ViewerKey = {
  memberId?: string;
};

type ActivityFilterKey = {
  sourceMessageId?: string;
  processTraceId?: string;
};

export const chatQueryKeys = {
  all: () => ["tinyoffice"] as const,
  currentSession: () => ["tinyoffice", "current-session"] as const,
  companies: () => ["tinyoffice", "companies"] as const,
  myProfile: () => ["tinyoffice", "my-profile"] as const,
  updates: () => ["tinyoffice", "updates"] as const,
  backups: () => ["tinyoffice", "backups"] as const,
  branding: (companyId?: string) => ["tinyoffice", "company-branding", companyId ?? ""] as const,
  capabilities: (companyId?: string) => ["tinyoffice", "capabilities", companyId ?? ""] as const,
  companySkills: (companyId?: string) => ["tinyoffice", "company-skills", companyId ?? ""] as const,
  companySkill: (companyId?: string, skillId?: string) => [
    ...chatQueryKeys.companySkills(companyId),
    skillId ?? "",
  ] as const,
  projectionScope: (companyId?: string) => ["tinyoffice", "chat", "projection", companyId ?? ""] as const,
  projection: (companyId?: string, viewer?: ViewerKey) => [
    ...chatQueryKeys.projectionScope(companyId),
    viewer?.memberId ? `member:${viewer.memberId}` : "viewer:none",
  ] as const,
  directory: (companyId?: string) => ["tinyoffice", "directory", companyId ?? ""] as const,
  employeeRuntimeSummary: (companyId?: string) => ["tinyoffice", "employees", companyId ?? "", "runtime-summary"] as const,
  employeesScope: (companyId?: string) => ["tinyoffice", "employees", companyId ?? ""] as const,
  employees: (companyId?: string) => [...chatQueryKeys.employeesScope(companyId), "runtime-config"] as const,
  employeePrivateSkills: (companyId?: string, memberId?: string) => [
    ...chatQueryKeys.employeesScope(companyId),
    "private-skills",
    memberId ?? "",
  ] as const,
  employeePrivateSkill: (companyId?: string, memberId?: string, skillId?: string) => [
    ...chatQueryKeys.employeePrivateSkills(companyId, memberId),
    skillId ?? "",
  ] as const,
  roomMessagesScope: (companyId?: string, roomId?: string) => ["tinyoffice", "chat", "room-messages", companyId ?? "", roomId ?? ""] as const,
  roomMessages: (companyId?: string, roomId?: string, viewer?: ViewerKey) => [
    ...chatQueryKeys.roomMessagesScope(companyId, roomId),
    viewer?.memberId ? `member:${viewer.memberId}` : "viewer:none",
  ] as const,
  activeRun: (companyId?: string, roomId?: string, viewer?: ViewerKey) => [
    "tinyoffice", "chat", "active-run", companyId ?? "", roomId ?? "",
    viewer?.memberId ? `member:${viewer.memberId}` : "viewer:none",
  ] as const,
  roomActivityScope: (companyId?: string, roomId?: string) => ["tinyoffice", "chat", "room-activity", companyId ?? "", roomId ?? ""] as const,
  roomActivity: (companyId?: string, roomId?: string, viewer?: ViewerKey, filter?: ActivityFilterKey) => [
    ...chatQueryKeys.roomActivityScope(companyId, roomId),
    viewer?.memberId ? `member:${viewer.memberId}` : "viewer:none",
    filter?.sourceMessageId ? `source:${filter.sourceMessageId}` : "source:none",
    filter?.processTraceId ? `trace:${filter.processTraceId}` : "trace:none",
  ] as const,
  sessionsScope: (companyId?: string) => ["tinyoffice", "sessions", companyId ?? ""] as const,
  sessions: (
    companyId?: string,
    input?: { employeeId?: string; sessionId?: string; query?: string; employeeIdFilter?: string },
  ) => [
    ...chatQueryKeys.sessionsScope(companyId),
    input?.employeeId ?? "",
    input?.sessionId ?? "",
    input?.query ?? "",
    input?.employeeIdFilter ?? "",
  ] as const,
  tasksScope: (companyId?: string) => ["tinyoffice", "tasks", companyId ?? ""] as const,
  tasks: (
    companyId?: string,
    input?: {
      status?: string;
      sort?: string;
      owner?: string;
      workTaskId?: string;
    },
  ) => [
    ...chatQueryKeys.tasksScope(companyId),
    input?.status ?? "",
    input?.sort ?? "",
    input?.owner ?? "",
    input?.workTaskId ?? "",
  ] as const,
  promptPolicy: (companyId?: string) => ["tinyoffice", "prompt-policy", companyId ?? ""] as const,
  accessPolicy: (companyId?: string) => ["tinyoffice", "access-policy", companyId ?? ""] as const,
  accessRequests: (companyId?: string) => ["tinyoffice", "access-requests", companyId ?? ""] as const,
  doctorReport: (companyId?: string) => ["tinyoffice", "doctor", companyId ?? ""] as const,
};
