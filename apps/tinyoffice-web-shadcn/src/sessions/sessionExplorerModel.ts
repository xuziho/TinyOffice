import type {
  SessionExplorerPromptInputPackage,
  SessionExplorerSessionSummary,
  SessionExplorerViewModel,
} from "tinyoffice/frontend-api-contracts";

export function selectedSessionFor(model: SessionExplorerViewModel): SessionExplorerSessionSummary | undefined {
  if (model.detail?.summary) {
    return model.detail.summary;
  }
  const selected = model.selectedSession;
  if (selected) {
    const match = model.list.sessions.find((session) =>
      session.employeeId === selected.employeeId && session.sessionId === selected.sessionId
    );
    if (match) {
      return match;
    }
  }
  return visibleSessionsFor(model)[0];
}

export type SessionSceneFilter = "" | "direct" | "channel" | "work" | "intake";
export type SessionTimeFilter = "" | "24h" | "3d" | "7d";

export interface SessionListFilterState {
  sceneFilter?: SessionSceneFilter;
  timeFilter?: SessionTimeFilter;
  now?: Date;
}

export const SESSION_SCENE_FILTERS: Array<{ value: SessionSceneFilter; label: string }> = [
  { value: "", label: "All scenes" },
  { value: "direct", label: "Direct" },
  { value: "channel", label: "Channel" },
  { value: "work", label: "Work" },
  { value: "intake", label: "Intake" },
];

export const SESSION_TIME_FILTERS: Array<{ value: SessionTimeFilter; label: string }> = [
  { value: "", label: "Any time" },
  { value: "24h", label: "24h" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
];

export function visibleSessionsFor(
  model: SessionExplorerViewModel,
  filters: SessionListFilterState = {},
): SessionExplorerSessionSummary[] {
  const employeeIdFilter = model.filters.employeeIdFilter?.trim();
  const query = model.filters.query?.trim().toLocaleLowerCase();
  const nowMs = filters.now?.getTime() ?? Date.now();
  return model.list.sessions.filter((session) => {
    if (employeeIdFilter && session.employeeId !== employeeIdFilter) {
      return false;
    }
    if (!sessionMatchesSceneFilter(session, filters.sceneFilter ?? "")) {
      return false;
    }
    if (!sessionMatchesTimeFilter(session, filters.timeFilter ?? "", nowMs)) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      session.displayName,
      session.role,
      session.sceneType,
      session.lastUserMessagePreview,
      session.lastAssistantMessagePreview,
      session.sessionId,
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}

function sessionMatchesSceneFilter(session: SessionExplorerSessionSummary, filter: SessionSceneFilter): boolean {
  if (!filter) {
    return true;
  }
  if (filter === "direct") {
    return session.sceneType === "chat_direct_room" || session.sceneType === "dm_thread";
  }
  if (filter === "channel") {
    return session.sceneType === "chat_topic_room" || session.sceneType === "chat_shared_room" || session.sceneType === "channel_thread";
  }
  if (filter === "work") {
    return session.sceneType === "work_run_execution";
  }
  if (filter === "intake") {
    return session.sceneType === "intake_event";
  }
  return false;
}

function sessionMatchesTimeFilter(session: SessionExplorerSessionSummary, filter: SessionTimeFilter, nowMs: number): boolean {
  if (!filter) {
    return true;
  }
  const timestamp = session.lastActivityAt ?? session.startedAt;
  if (!timestamp) {
    return false;
  }
  const sessionMs = new Date(timestamp).getTime();
  if (Number.isNaN(sessionMs)) {
    return false;
  }
  const rangeMs = filter === "24h"
    ? 24 * 60 * 60 * 1000
    : filter === "3d"
      ? 3 * 24 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000;
  return nowMs - sessionMs <= rangeMs;
}

export function sessionPreview(session: SessionExplorerSessionSummary): string {
  const raw = (
    session.lastAssistantMessagePreview?.trim() ||
    session.lastUserMessagePreview?.trim() ||
    session.sessionKey?.trim() ||
    "No preview recorded."
  );
  if (session.sceneType === "intake_event") {
    return /created\s+(?:a\s+)?(?:background\s+)?(?:work|task)|created\s+worktask/i.test(raw)
      ? "External input created a background Task."
      : "External input was processed by the employee.";
  }
  if (session.sceneType === "work_run_execution") {
    if (/blocked|waiting for|need(?:s|ed)?\s+(?:input|access|permission)/i.test(raw)) {
      return "Background Task is waiting for input or access.";
    }
    if (/failed|error|could not/i.test(raw)) {
      return "Background Task execution needs review.";
    }
    if (/completed|finished|done|success/i.test(raw)) {
      return "Background Task execution completed.";
    }
    return "Background Task execution activity.";
  }
  if (/confirmed\s+work\s+created|created\s+(?:and\s+)?(?:triggered\s+)?background\s+task|已创建.*后台任务/i.test(raw)) {
    return "Background Task created from this conversation.";
  }
  return productPreviewText(raw);
}

function productPreviewText(value: string): string {
  const firstLine = value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "No preview recorded.";
  const withoutInternalIds = firstLine
    .replace(/`?(?:work-task|work-run|runtime-session)-[a-z0-9-]+`?/gi, "")
    .replace(/\bWorkTask\b|\bWorkRun\b/g, "Task")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
  if (!withoutInternalIds) {
    return "Session activity recorded.";
  }
  return withoutInternalIds.length > 180 ? `${withoutInternalIds.slice(0, 177).trimEnd()}...` : withoutInternalIds;
}

export function sessionSceneLabel(sceneType?: string): string {
  if (sceneType === "chat_direct_room" || sceneType === "dm_thread") {
    return "Direct message";
  }
  if (sceneType === "chat_topic_room" || sceneType === "chat_shared_room" || sceneType === "channel_thread") {
    return "Channel topic";
  }
  if (sceneType === "work_run_execution") {
    return "Work run";
  }
  if (sceneType === "intake_event") {
    return "Intake";
  }
  return "Session";
}

export function sessionTokenLabel(session: SessionExplorerSessionSummary): string {
  const total = session.tokenInputTotal + session.tokenOutputTotal + session.tokenCacheTotal;
  return total > 0 ? `${total.toLocaleString()} tokens` : "No usage";
}

export function chatReturnTargetForSession(session: SessionExplorerSessionSummary) {
  return session.chatReturnTarget;
}

export interface SessionListPresentation {
  title: string;
  subtitle: string;
  showEmployeeColumn: boolean;
  showSceneColumn: boolean;
}

export function sessionListPresentation(
  model: SessionExplorerViewModel,
  sessions: SessionExplorerSessionSummary[],
): SessionListPresentation {
  const employeeIdFilter = model.filters.employeeIdFilter?.trim();
  const employeeFilter = employeeIdFilter
    ? model.list.employeeFilters.find((filter) => filter.employeeId === employeeIdFilter)
    : undefined;
  const employeeIds = new Set(sessions.map((session) => session.employeeId));
  const sceneLabels = new Set(sessions.map((session) => sessionSceneLabel(session.sceneType)));

  return {
    title: employeeFilter ? `${employeeFilter.displayName} sessions` : "Runtime sessions",
    subtitle: `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`,
    showEmployeeColumn: !employeeIdFilter && employeeIds.size > 1,
    showSceneColumn: sceneLabels.size > 1,
  };
}

export interface SessionExplorerInputPackageFact {
  group: "Prompt input" | "Context input" | "Tools and skills" | "Diagnostics";
  label: string;
  value: string;
}

export function inputPackageReadableFacts(prompt: SessionExplorerPromptInputPackage): SessionExplorerInputPackageFact[] {
  const facts: SessionExplorerInputPackageFact[] = [
    { group: "Prompt input", label: "System", value: prompt.systemPrompt },
    { group: "Prompt input", label: "Runtime prompt", value: prompt.runtimePrompt },
    ...prompt.promptBlocks.map((block) => ({
      group: "Prompt input" as const,
      label: `Prompt block: ${block.id}`,
      value: block.content ?? "Not recorded.",
    })),
    ...prompt.employeeInstructions.map((instruction) => ({
      group: "Prompt input" as const,
      label: `Employee instructions: ${instruction.path}`,
      value: instruction.content ?? "Not recorded.",
    })),
    { group: "Context input", label: "Runtime context", value: prompt.runtimeContext },
    ...prompt.contextBlocks.map((block) => ({
      group: "Context input" as const,
      label: `Context block: ${block.label || block.source || block.role}`,
      value: block.text,
    })),
    { group: "Tools and skills", label: "Tools", value: prompt.tools.join("\n") },
    { group: "Tools and skills", label: "Skills", value: prompt.skills.join("\n") },
    {
      group: "Diagnostics",
      label: "Input hashes",
      value: [
        prompt.cacheEvidence.fullInputSha256 ? `fullInputSha256: ${prompt.cacheEvidence.fullInputSha256}` : "",
        prompt.cacheEvidence.stablePrefixSha256 ? `stablePrefixSha256: ${prompt.cacheEvidence.stablePrefixSha256}` : "",
        typeof prompt.cacheEvidence.estimatedStablePrefixChars === "number"
          ? `estimatedStablePrefixChars: ${prompt.cacheEvidence.estimatedStablePrefixChars}`
          : "",
      ].filter(Boolean).join("\n"),
    },
  ];

  return facts.filter((fact) => fact.value.trim().length > 0);
}
