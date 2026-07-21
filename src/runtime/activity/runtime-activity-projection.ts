import type { ProcessTraceEvent, ProcessTraceEventStatus } from "../contracts/process-trace-event.js";

export type RuntimeActivityKind =
  | "run_started"
  | "thinking"
  | "provider_retry"
  | "handoff"
  | "tool_call"
  | "tool_result"
  | "run_completed"
  | "failure";

export interface RuntimeActivityPrimary {
  toolName?: string;
  arguments?: unknown;
  targetMemberId?: string;
  replyMessageId?: string;
}

export interface RuntimeActivityRawDetails {
  eventIds: string[];
  events: ProcessTraceEvent[];
}

export interface RuntimeActivityItem {
  id: string;
  kind: RuntimeActivityKind;
  title: string;
  details?: string;
  status?: ProcessTraceEventStatus;
  timestamp?: string;
  primary?: RuntimeActivityPrimary;
  raw: RuntimeActivityRawDetails;
}

export interface RuntimeActivity {
  items: RuntimeActivityItem[];
}

export function buildRuntimeActivity(events: ProcessTraceEvent[]): RuntimeActivity {
  const groups = new Map<string, ProcessTraceEvent[]>();
  for (const event of events) {
    const key = activityGroupKey(event);
    if (!key) {
      continue;
    }
    groups.set(key, [...(groups.get(key) || []), event]);
  }

  const items = [...groups.entries()]
    .map(([key, group]) => activityItemForGroup(key, group))
    .filter((item): item is RuntimeActivityItem => Boolean(item))
    .sort((left, right) => (left.timestamp || "").localeCompare(right.timestamp || "") || left.id.localeCompare(right.id));

  return { items };
}

function activityGroupKey(event: ProcessTraceEvent): string | undefined {
  const metadata = event.metadata || {};
  const runId = metadataString(metadata.runId) || metadataString(metadata.eventKey) || event.sessionKey;
  switch (event.kind) {
    case "employee_reply_started":
      return `run_started:${runId}`;
    case "model_reasoning_observed":
      return `thinking:${metadataString(metadata.modelCallId) || metadataString(metadata.piModelCallId) || runId}`;
    case "provider_retry":
      return `provider_retry:${runId}:${metadataString(metadata.attempt) || event.id}`;
    case "tool_activity": {
      const key = durableToolTraceKey(event);
      return key ? `${isHandoffToolEvent(event) ? "handoff" : "tool_step"}:${runId}:${key}` : undefined;
    }
    case "model_tool_call": {
      const key = durableToolTraceKey(event);
      if (!key && metadataString(metadata.streamEventType)) return undefined;
      return `${isHandoffToolEvent(event) ? "handoff" : "tool_step"}:${runId}:${key || event.id}`;
    }
    case "model_tool_result": {
      const key = durableToolTraceKey(event) || event.id;
      return `${isHandoffToolEvent(event) ? "handoff" : "tool_step"}:${runId}:${key}`;
    }
    case "turn_completed":
      return `run_completed:${runId}`;
    case "turn_failed":
      return `failure:${runId}`;
    case "model_reply_observed":
      return undefined;
    default:
      return undefined;
  }
}

function durableToolTraceKey(event: ProcessTraceEvent): string | undefined {
  return metadataString(event.metadata?.toolCallId) ||
    metadataString(event.metadata?.sessionRecordId);
}

function activityItemForGroup(key: string, events: ProcessTraceEvent[]): RuntimeActivityItem | undefined {
  const sorted = [...events];
  const latest = sorted.at(-1);
  if (!latest) {
    return undefined;
  }
  const raw = {
    eventIds: sorted.map((event) => event.id),
    events: sorted,
  };
  if (key.startsWith("run_started:")) {
    return {
      id: `activity:${key}`,
      kind: "run_started",
      title: "Run started",
      details: activityDetails(latest.summary || latest.title),
      status: latest.status,
      timestamp: latest.timestamp,
      primary: objectWithValues({
        targetMemberId: metadataString(latest.metadata?.targetMemberId),
      }),
      raw,
    };
  }
  if (key.startsWith("thinking:")) {
    return {
      id: `activity:${key}`,
      kind: "thinking",
      title: "Thinking",
      details: activityDetails(latest.summary || latest.preview || latest.title),
      status: latest.status,
      timestamp: latest.timestamp,
      raw,
    };
  }
  if (key.startsWith("provider_retry:")) {
    const attempt = metadataString(latest.metadata?.attempt);
    const delayMs = metadataNumber(latest.metadata?.delayMs);
    const error = metadataString(latest.metadata?.errorMessage) || metadataString(latest.metadata?.finalError);
    return {
      id: `activity:${key}`,
      kind: "provider_retry",
      title: attempt ? `Provider retry ${attempt}` : "Provider retry",
      details: error || (delayMs !== undefined ? `Waiting ${Math.max(1, Math.round(delayMs / 1000))} seconds before retrying.` : "Retrying after a transient provider error."),
      status: latest.status,
      timestamp: latest.timestamp,
      raw,
    };
  }
  if (key.startsWith("handoff:")) {
    const call = latestMatching(sorted, "model_tool_call") || latest;
    const activity = latestMatching(sorted, "tool_activity");
    const target = handoffTarget(activity) || handoffTarget(call);
    return {
      id: `activity:${key}`,
      kind: "handoff",
      title: "Handoff",
      details: activityDetails(activity?.summary || call.summary || call.title),
      status: bestStatus(sorted),
      timestamp: call.timestamp || latest.timestamp,
      primary: objectWithValues({
        toolName: metadataString(call.metadata?.toolName) || "handoff_topic_turn",
        targetMemberId: target,
        arguments: call.metadata?.arguments,
      }),
      raw,
    };
  }
  if (key.startsWith("tool_step:")) {
    const call = latestMatching(sorted, "model_tool_call");
    const result = latestMatching(sorted, "model_tool_result");
    const activity = latestMatching(sorted, "tool_activity");
    const representative = call || result || activity || latest;
    const toolName = metadataString(representative.metadata?.toolName);
    const argumentsValue = call?.metadata?.arguments;
    return {
      id: `activity:${key}`,
      kind: "tool_call",
      title: toolName ? `Tool · ${toolName}` : "Tool activity",
      details: activityDetails(result?.summary || result?.preview || activity?.summary || call?.summary || representative.title),
      status: bestStatus(sorted),
      timestamp: call?.timestamp || activity?.timestamp || representative.timestamp,
      primary: objectWithValues({
        toolName,
        arguments: argumentsValue,
      }),
      raw,
    };
  }
  if (key.startsWith("run_completed:")) {
    return {
      id: `activity:${key}`,
      kind: "run_completed",
      title: "Run completed",
      details: "Reply posted to conversation.",
      status: latest.status,
      timestamp: latest.timestamp,
      primary: objectWithValues({
        replyMessageId: metadataString(latest.metadata?.replyMessageId),
      }),
      raw,
    };
  }
  if (key.startsWith("failure:")) {
    return {
      id: `activity:${key}`,
      kind: "failure",
      title: "Run failed",
      details: activityDetails(latest.summary || latest.preview || latest.title),
      status: latest.status,
      timestamp: latest.timestamp,
      raw,
    };
  }
  return undefined;
}

function isHandoffToolEvent(event: ProcessTraceEvent): boolean {
  return metadataString(event.metadata?.activityKind) === "topic_handoff" ||
    metadataString(event.metadata?.toolName) === "handoff_topic_turn";
}

function handoffTarget(event: ProcessTraceEvent | undefined): string | undefined {
  if (!event) {
    return undefined;
  }
  const argumentRecord = recordFromUnknown(event.metadata?.arguments);
  return metadataString(event.metadata?.activityTarget) ||
    metadataString(event.metadata?.targetMemberId) ||
    metadataString(argumentRecord?.toId) ||
    metadataString(argumentRecord?.targetMemberId) ||
    metadataString(argumentRecord?.recipientParticipantId);
}

function latestMatching(events: ProcessTraceEvent[], kind: ProcessTraceEvent["kind"]): ProcessTraceEvent | undefined {
  return [...events].reverse().find((event) => event.kind === kind);
}

function bestStatus(events: ProcessTraceEvent[]): ProcessTraceEventStatus | undefined {
  if (events.some((event) => event.status === "failed")) {
    return "failed";
  }
  if (events.some((event) => event.status === "succeeded")) {
    return "succeeded";
  }
  return events.at(-1)?.status;
}

function metadataString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function metadataNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function activityDetails(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  return value;
}

function objectWithValues<T extends Record<string, unknown>>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, child]) => child !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) as T : undefined;
}
