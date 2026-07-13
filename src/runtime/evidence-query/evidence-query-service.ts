import type { Approval, ApprovalGrant, ApprovalStatus } from "../../governance/domain/approval.js";
import type { IntakeEventRecord } from "../../intake/domain.js";
import type { IntakeEventStore } from "../../intake/intake-event-store.js";
import type { OperatingEventRecord, OperatingEventSeverity } from "../../operating-log/domain.js";
import type { OperatingLogRepositoryLike } from "../../operating-log/operating-log-repository.js";
import type { CompanyDirectoryEmployeeRecord } from "../company-config/company-directory-repository.js";
import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import type {
  CollaborationActionEvent,
  MemorySummary,
  RuntimeSessionEvent,
  RuntimeSessionRecord,
  RuntimeSessionRepositoryLike,
} from "../storage/runtime-session-repository.js";
import type {
  WorkRunEventRecord,
  WorkRunRecord,
  WorkRunStatus,
  WorkTaskRecord,
} from "../../work/domain.js";
import type { WorkRepositoryLike } from "../../work/work-repository.js";

export type EvidenceQueryCommand =
  | "members"
  | "member"
  | "member-state"
  | "work"
  | "work-run"
  | "work-run-events"
  | "work-queue"
  | "sessions"
  | "session"
  | "session-events"
  | "session-input"
  | "trace"
  | "actions"
  | "intake"
  | "approvals"
  | "grants"
  | "ops"
  | "memory";

export interface EvidenceQuery {
  command: EvidenceQueryCommand;
  memberId?: string;
  status?: string;
  id?: string;
  workRunId?: string;
  sessionRecordId?: string;
  kind?: string;
  severity?: string;
  since?: string;
  limit?: number;
}

export interface EvidenceQueryRepositories {
  directory: {
    loadEmployees(): Promise<CompanyDirectoryEmployeeRecord[]>;
    close?(): void;
  };
  work: Pick<WorkRepositoryLike,
    | "getWorkTask"
    | "listWorkTasks"
    | "listWorkRuns"
    | "getWorkRun"
    | "listWorkRunEvents"
    | "close"
  >;
  runtime: Pick<RuntimeSessionRepositoryLike,
    | "getSessionRecord"
    | "getSessionDetail"
    | "listSessionRecords"
    | "listSessionEvents"
    | "listProcessTraceEvents"
    | "listCollaborationActionEvents"
    | "listMemorySummaries"
    | "close"
  >;
  governance: {
    list(): Promise<Approval[]>;
    listGrants(): Promise<ApprovalGrant[]>;
  };
  intake: Pick<IntakeEventStore, "load" | "close">;
  ops: Pick<OperatingLogRepositoryLike, "listEvents" | "close">;
}

export type EvidenceQueryResult =
  | EvidenceQueryItemsResult
  | EvidenceQueryDetailResult;

export interface EvidenceQueryItemsResult {
  ok: true;
  query: EvidenceQuery;
  generatedAt: string;
  summary: string;
  items: EvidenceQueryItem[];
  evidence?: Record<string, unknown>;
  links?: Record<string, unknown>;
}

export interface EvidenceQueryDetailResult {
  ok: true;
  query: EvidenceQuery;
  generatedAt: string;
  summary: string;
  detail: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  links?: Record<string, unknown>;
}

export type EvidenceQueryItem =
  | CompanyDirectoryEmployeeRecord
  | WorkTaskRecord
  | WorkRunRecord
  | WorkRunEventRecord
  | RuntimeSessionRecord
  | RuntimeSessionEvent
  | ProcessTraceEvent
  | CollaborationActionEvent
  | IntakeEventRecord
  | Approval
  | ApprovalGrant
  | OperatingEventRecord
  | MemorySummary;

export async function runEvidenceQuery(input: {
  query: EvidenceQuery;
  repositories: EvidenceQueryRepositories;
  generatedAt?: string;
}): Promise<EvidenceQueryResult> {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const query = normalizeQuery(input.query);
  const context = {
    query,
    repositories: input.repositories,
    generatedAt,
  };

  switch (query.command) {
    case "members":
      return itemsResult(context, await listEmployees(input.repositories), "members");
    case "member":
      return memberDetail(context);
    case "member-state":
      return memberState(context);
    case "work":
      return workItems(context);
    case "work-run":
      return workRunDetail(context);
    case "work-run-events":
      return itemsResult(context, input.repositories.work.listWorkRunEvents(required(query.id, "id")), "work-run-events");
    case "work-queue":
      return itemsResult(
        context,
        input.repositories.work.listWorkRuns({
          assigneeMemberId: required(query.memberId, "memberId"),
          status: "queued",
        }),
        "queued work runs",
      );
    case "sessions":
      return sessionsItems(context);
    case "session":
      return sessionDetail(context);
    case "session-events":
      return sessionEvents(context);
    case "session-input":
      return sessionInput(context);
    case "trace":
      return traceItems(context);
    case "actions":
      return actionsItems(context);
    case "intake":
      return intakeItems(context);
    case "approvals":
      return approvalsItems(context);
    case "grants":
      return grantsItems(context);
    case "ops":
      return opsItems(context);
    case "memory":
      return memoryItems(context);
  }
}

function normalizeQuery(query: EvidenceQuery): EvidenceQuery {
  const normalized = compactQuery(query);
  if (normalized.command === "work-run-events" && !normalized.id && normalized.workRunId) {
    normalized.id = normalized.workRunId;
  }
  if ((normalized.command === "session" || normalized.command === "session-events" || normalized.command === "session-input") &&
    !normalized.id && normalized.sessionRecordId) {
    normalized.id = normalized.sessionRecordId;
  }
  return normalized;
}

async function listEmployees(repositories: EvidenceQueryRepositories): Promise<CompanyDirectoryEmployeeRecord[]> {
  return (await repositories.directory.loadEmployees())
    .sort((left, right) => left.employeeId.localeCompare(right.employeeId));
}

async function memberDetail(context: QueryContext): Promise<EvidenceQueryDetailResult> {
  const memberId = required(context.query.memberId ?? context.query.id, "memberId");
  const member = (await listEmployees(context.repositories)).find((item) => item.employeeId === memberId);
  return detailResult(
    context,
    { member },
    member ? `member ${memberId}: ${member.enabled ? "enabled" : "disabled"}` : `member ${memberId}: not found`,
  );
}

async function memberState(context: QueryContext): Promise<EvidenceQueryDetailResult> {
  const memberId = required(context.query.memberId ?? context.query.id, "memberId");
  const employees = await listEmployees(context.repositories);
  const employee = employees.find((item) => item.employeeId === memberId);
  const runs = context.repositories.work.listWorkRuns({ assigneeMemberId: memberId });
  const tasks = context.repositories.work.listWorkTasks({ ownerMemberId: memberId });
  const sessions = context.repositories.runtime.listSessionRecords({ employeeId: memberId, limit: limitOf(context.query, 10) });
  const actions = context.repositories.runtime.listCollaborationActionEvents({ employeeId: memberId, limit: limitOf(context.query, 20) });
  const approvals = await filterApprovals(await context.repositories.governance.list(), {
    memberId,
    status: context.query.status,
  });
  const grants = filterGrants(await context.repositories.governance.listGrants(), { memberId });
  const ops = context.repositories.ops.listEvents({ actorMemberId: memberId, limit: limitOf(context.query, 20) });
  const memories = context.repositories.runtime.listMemorySummaries({ employeeId: memberId, limit: limitOf(context.query, 10) });
  const activeRunCount = runs.filter((run) => run.status === "queued" || run.status === "in_progress" || run.status === "blocked").length;
  return detailResult(context, {
    member: employee,
    work: { tasks, runs },
    sessions,
    actions,
    approvals,
    grants,
    ops,
    memories,
  }, `member-state ${memberId}: ${activeRunCount} active work runs, ${sessions.length} sessions`);
}

function workItems(context: QueryContext): EvidenceQueryItemsResult {
  const runs = context.repositories.work.listWorkRuns({
    assigneeMemberId: context.query.memberId,
    status: context.query.status as WorkRunStatus | undefined,
  });
  return itemsResult(context, runs, "work runs");
}

function workRunDetail(context: QueryContext): EvidenceQueryDetailResult {
  const id = required(context.query.id ?? context.query.workRunId, "id");
  const run = context.repositories.work.getWorkRun(id);
  const workTaskId = run?.workTaskId;
  const task = workTaskId ? context.repositories.work.getWorkTask(workTaskId) : undefined;
  const events = context.repositories.work.listWorkRunEvents(id);
  return detailResult(
    context,
    { run, task, events },
    run ? `work-run ${id}: ${run.status}, ${events.length} events` : `work-run ${id}: not found`,
    workTaskId ? { workTaskId } : undefined,
  );
}

function sessionsItems(context: QueryContext): EvidenceQueryItemsResult {
  let records = context.repositories.runtime.listSessionRecords({
    employeeId: context.query.memberId,
    workRunId: context.query.workRunId,
    limit: limitOf(context.query, 50),
  });
  const since = sinceIso(context.query.since, context.generatedAt);
  if (since) {
    records = records.filter((record) => record.updatedAt >= since);
  }
  return itemsResult(context, records, "sessions");
}

function sessionDetail(context: QueryContext): EvidenceQueryDetailResult {
  const id = required(context.query.id ?? context.query.sessionRecordId, "id");
  const detail = context.repositories.runtime.getSessionDetail(id);
  return detailResult(
    context,
    detail || {},
    detail ? `session ${id}: ${detail.events.length} events` : `session ${id}: not found`,
  );
}

function sessionEvents(context: QueryContext): EvidenceQueryItemsResult {
  const id = required(context.query.id ?? context.query.sessionRecordId, "id");
  let events = context.repositories.runtime.listSessionEvents(id);
  if (context.query.kind) {
    events = events.filter((event) => event.kind === context.query.kind);
  }
  return itemsResult(context, events, "session events");
}

function sessionInput(context: QueryContext): EvidenceQueryItemsResult {
  const id = required(context.query.id ?? context.query.sessionRecordId, "id");
  const events = context.repositories.runtime.listSessionEvents(id).filter(isSessionInputEvent);
  return itemsResult(context, events, "session input events");
}

function traceItems(context: QueryContext): EvidenceQueryItemsResult {
  const session = context.query.sessionRecordId || context.query.id
    ? context.repositories.runtime.getSessionRecord(required(context.query.sessionRecordId ?? context.query.id, "session"))
    : undefined;
  const events = context.repositories.runtime.listProcessTraceEvents({
    workRunId: context.query.workRunId,
    employeeId: context.query.memberId,
    sessionKey: session?.sessionKey,
    limit: limitOf(context.query, 100),
  });
  return itemsResult(context, events, "trace events");
}

function actionsItems(context: QueryContext): EvidenceQueryItemsResult {
  const events = context.repositories.runtime.listCollaborationActionEvents({
    employeeId: context.query.memberId,
    workRunId: context.query.workRunId,
    limit: limitOf(context.query, 100),
  });
  return itemsResult(context, events, "actions");
}

async function intakeItems(context: QueryContext): Promise<EvidenceQueryItemsResult> {
  const state = await context.repositories.intake.load();
  let events = state.events;
  if (context.query.id) {
    events = events.filter((event) => event.id === context.query.id);
  }
  if (context.query.status) {
    events = events.filter((event) => event.status === context.query.status);
  }
  if (context.query.memberId) {
    events = events.filter((event) => event.input.routing?.targetMemberId === context.query.memberId);
  }
  return itemsResult(context, events, "intake events");
}

async function approvalsItems(context: QueryContext): Promise<EvidenceQueryItemsResult> {
  const approvals = await filterApprovals(await context.repositories.governance.list(), {
    memberId: context.query.memberId,
    status: context.query.status,
  });
  return itemsResult(context, approvals, "approvals");
}

async function grantsItems(context: QueryContext): Promise<EvidenceQueryItemsResult> {
  const grants = filterGrants(await context.repositories.governance.listGrants(), {
    memberId: context.query.memberId,
  });
  return itemsResult(context, grants, "grants");
}

function opsItems(context: QueryContext): EvidenceQueryItemsResult {
  const events = context.repositories.ops.listEvents({
    actorMemberId: context.query.memberId,
    severity: context.query.severity as OperatingEventSeverity | undefined,
    limit: limitOf(context.query, 100),
  });
  return itemsResult(context, events, "operating events");
}

function memoryItems(context: QueryContext): EvidenceQueryItemsResult {
  const memories = context.repositories.runtime.listMemorySummaries({
    employeeId: context.query.memberId,
    limit: limitOf(context.query, 20),
  });
  return itemsResult(context, memories, "memory summaries");
}

function filterApprovals(
  approvals: Approval[],
  input: { memberId?: string; status?: string },
): Approval[] {
  return approvals
    .filter((approval) => !input.memberId || approval.requestedByMemberId === input.memberId)
    .filter((approval) => !input.status || approval.status === input.status as ApprovalStatus)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function filterGrants(grants: ApprovalGrant[], input: { memberId?: string }): ApprovalGrant[] {
  return grants
    .filter((grant) => !input.memberId || grant.memberId === input.memberId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function isSessionInputEvent(event: RuntimeSessionEvent): boolean {
  return event.visibility === "prompt_context" ||
    event.visibility === "model_input" ||
    event.semanticRole === "user_message" ||
    event.semanticRole === "user_visible_message" ||
    event.kind === "prompt_context" ||
    event.kind === "user_message";
}

interface QueryContext {
  query: EvidenceQuery;
  repositories: EvidenceQueryRepositories;
  generatedAt: string;
}

function itemsResult(
  context: QueryContext,
  items: EvidenceQueryItem[],
  noun: string,
): EvidenceQueryItemsResult {
  return {
    ok: true,
    query: context.query,
    generatedAt: context.generatedAt,
    summary: `${context.query.command}: ${items.length} ${noun}`,
    items,
  };
}

function detailResult(
  context: QueryContext,
  detail: Record<string, unknown>,
  summary: string,
  evidence?: Record<string, unknown>,
): EvidenceQueryDetailResult {
  return {
    ok: true,
    query: context.query,
    generatedAt: context.generatedAt,
    summary,
    detail,
    ...(evidence ? { evidence } : {}),
  };
}

function compactQuery(input: EvidenceQuery): EvidenceQuery {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
  ) as EvidenceQuery;
}

function limitOf(query: EvidenceQuery, fallback: number): number {
  return query.limit && query.limit > 0 ? Math.floor(query.limit) : fallback;
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function sinceIso(duration: string | undefined, generatedAt: string): string | undefined {
  if (!duration) {
    return undefined;
  }
  const match = duration.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error("--since must be a duration like 30m, 12h, or 7d.");
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return new Date(new Date(generatedAt).getTime() - amount * multiplier).toISOString();
}
