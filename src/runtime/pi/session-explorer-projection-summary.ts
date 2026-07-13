import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import type { CollaborationActionEvent, RuntimeSessionEvent, RuntimeSessionRecord } from "../storage/runtime-session-repository.js";
import type { SessionExplorerActionSummary, SessionExplorerChatReturnTarget, SessionExplorerEvidenceLink, SessionExplorerSessionSummary } from "./session-explorer-types.js";
import { logicalToolCallCount, logicalToolResultCount } from "./session-explorer-projection-transcript.js";
import { compactLine, isGenericAssistantReply, summarizeText, textForRuntimeSessionEvent, turnKeyForEvent } from "./session-explorer-projection-utils.js";

export function firstRuntimeText(
  events: RuntimeSessionEvent[],
  kind: string,
): string | undefined {
  return events
    .filter((event) => event.kind === kind)
    .map((event) => compactLine(textForRuntimeSessionEvent(event)))
    .filter(Boolean)[0];
}

export function lastRuntimeText(
  events: RuntimeSessionEvent[],
  kind: string,
): string | undefined {
  return events
    .filter((event) => event.kind === kind)
    .map((event) => compactLine(textForRuntimeSessionEvent(event)))
    .filter(Boolean)
    .at(-1);
}

export function latestTraceSummary(
  events: ProcessTraceEvent[],
  kind: ProcessTraceEvent["kind"],
): string | undefined {
  return events
    .filter((event) => event.kind === kind)
    .map((event) => compactLine(event.summary || event.title || event.preview || ""))
    .filter(Boolean)
    .at(-1);
}

export function traceText(event: ProcessTraceEvent) {
  return compactLine(event.preview || event.summary || event.title || "");
}

export function formatHighSignalTrace(event: ProcessTraceEvent): string | undefined {
  const text = traceText(event);
  if (!text || (event.kind === "model_tool_call" && text === "{}")) {
    return undefined;
  }
  if (event.kind === "progress_update") {
    return `Progress update: ${text}`;
  }
  if (event.kind === "model_tool_call") {
    return `Tool call: ${compactLine([event.title, text].filter(Boolean).join(" - "))}`;
  }
  if (event.kind === "model_tool_result") {
    return `Tool result: ${compactLine([event.title, text].filter(Boolean).join(" - "))}`;
  }
  return undefined;
}

export function highSignalTraceItems(events: ProcessTraceEvent[]) {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const event of events) {
    const item = formatHighSignalTrace(event);
    if (!item) {
      continue;
    }
    const key = event.kind === "model_tool_call"
      ? `${event.kind}:${event.title || ""}:${traceText(event)}`
      : item;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(item);
  }
  return items;
}

export function formatCollaborationAction(event: CollaborationActionEvent) {
  const message = event.message
    ? `: ${compactLine(event.message)}`
    : "";
  const status = event.status ? ` (${event.status})` : "";
  const recipient = event.recipientId ? ` to ${event.recipientId}` : "";
  const decision = event.emitted ? "" : " (not emitted)";
  return `Called ${event.actionName}${status}${recipient}${decision}${message}.`;
}

export function latestHandoffMessage(events: CollaborationActionEvent[]) {
  return events
    .filter((event) => event.actionName === "handoff" && event.message)
    .map((event) => compactLine(event.message || ""))
    .filter(Boolean)
    .at(-1);
}

export function buildActionSummary(input: {
  record: RuntimeSessionRecord;
  events: RuntimeSessionEvent[];
  processTraceEvents: ProcessTraceEvent[];
  collaborationActionEvents: CollaborationActionEvent[];
}): SessionExplorerActionSummary {
  const items: string[] = [];
  const userMessage = firstRuntimeText(input.events, "user_message");
  if (userMessage) {
    items.push(`Received ${sceneMessageLabel(input.record.sceneType)}: ${userMessage}`);
  }

  const contextSummary = latestTraceSummary(input.processTraceEvents, "channel_topic_context_ready");
  if (contextSummary) {
    items.push(`Loaded conversation context: ${contextSummary}`);
  }

  items.push(...highSignalTraceItems(input.processTraceEvents));

  for (const action of input.collaborationActionEvents.filter((event) => event.employeeId === input.record.employeeId)) {
    items.push(formatCollaborationAction(action));
  }

  const failedSummary = latestTraceSummary(input.processTraceEvents, "turn_failed");
  if (failedSummary) {
    items.push(`Turn failed: ${failedSummary}`);
  }

  const assistantMessage = lastRuntimeText(input.events, "assistant_message");
  const finishTurnMessage = latestHandoffMessage(input.collaborationActionEvents);
  const visibleReply = isGenericAssistantReply(assistantMessage)
    ? finishTurnMessage
    : assistantMessage;
  if (visibleReply) {
    items.push(`Sent reply: ${visibleReply}`);
  } else {
    const completedSummary = latestTraceSummary(input.processTraceEvents, "turn_completed");
    if (completedSummary) {
      items.push(`Completed turn: ${completedSummary}`);
    }
  }

  return {
    items,
    sourceEventCount:
      input.events.length +
      input.processTraceEvents.length +
      input.collaborationActionEvents.length,
  };
}

export function sceneMessageLabel(sceneType?: string) {
  if (sceneType === "dm_thread") {
    return "DM message";
  }
  if (sceneType === "channel_thread") {
    return "Channel thread message";
  }
  if (sceneType === "intake_event") {
    return "External intake";
  }
  if (sceneType === "work_run_execution") {
    return "Work run message";
  }
  return "Message";
}

export function buildSessionEvidenceLinks(input: {
  record: RuntimeSessionRecord;
  processTraceEvents: ProcessTraceEvent[];
}): SessionExplorerEvidenceLink[] {
  const links: SessionExplorerEvidenceLink[] = [{
    kind: "session",
    label: `Session ${input.record.id}`,
    targetId: input.record.id,
    href: `/app/sessions?employeeId=${encodeURIComponent(input.record.employeeId)}&sessionId=${encodeURIComponent(input.record.id)}`,
  }];
  for (const event of input.processTraceEvents) {
    links.push({
      kind: "process_trace",
      label: `Process Trace ${event.id}`,
      targetId: event.id,
      href: `/api/process-trace?processTraceId=${encodeURIComponent(event.id)}`,
    });
  }
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.kind}:${link.targetId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function chatReturnTargetFromSessionKey(sessionKey?: string): SessionExplorerChatReturnTarget | undefined {
  const parts = sessionKey?.split("|") ?? [];
  if (parts.length < 3) {
    return undefined;
  }
  const sceneType = parts[1];
  const conversationId = parts.slice(2).join("|").trim();
  if (!conversationId) {
    return undefined;
  }
  if (sceneType === "chat_direct_room" || sceneType === "dm_thread") {
    return { surface: "direct", conversationId };
  }
  if (sceneType === "chat_topic_room" || sceneType === "channel_thread") {
    return { surface: "channel", conversationId };
  }
  return undefined;
}

export function summarizeRuntimeSessionRecord(input: {
  record: RuntimeSessionRecord;
  events: RuntimeSessionEvent[];
  processTraceEvents?: ProcessTraceEvent[];
  employeeProfiles: Map<string, { displayName: string; role: string }>;
}): SessionExplorerSessionSummary {
  const profile = input.employeeProfiles.get(input.record.employeeId);
  const visibleEvents = input.events.filter((event) => event.kind === "user_message" || event.kind === "assistant_message");
  const hasStructuredVisibleEvents = visibleEvents.some((event) => Boolean(turnKeyForEvent(event)));
  const countableVisibleEvents = hasStructuredVisibleEvents
    ? visibleEvents.filter((event) => Boolean(turnKeyForEvent(event)))
    : visibleEvents;
  const lastUserMessagePreview = countableVisibleEvents
    .filter((event) => event.kind === "user_message")
    .map((event) => summarizeText(textForRuntimeSessionEvent(event)))
    .filter(Boolean)
    .at(-1);
  const lastAssistantMessagePreview = countableVisibleEvents
    .filter((event) => event.kind === "assistant_message")
    .map((event) => summarizeText(textForRuntimeSessionEvent(event)))
    .filter((text) => !isGenericAssistantReply(text))
    .filter(Boolean)
    .at(-1);

  const processTraceEvents = input.processTraceEvents || [];
  const fallbackToolCalls = input.record.toolCallCount ||
    input.events.filter((event) => event.kind === "tool_call").length;
  const fallbackToolResults = input.record.toolResultCount ||
    input.events.filter((event) => event.kind === "tool_result").length;

  return {
    employeeId: input.record.employeeId,
    displayName: profile?.displayName || input.record.employeeId,
    role: profile?.role || "employee",
    sessionId: input.record.id,
    sessionDirPath: `database:session_records/${input.record.id}`,
    cwd: input.record.runtimeMetadata?.cwd?.value,
    sessionKey: input.record.sessionKey,
    sceneType: input.record.sceneType,
    requesterUsername: input.record.requesterId,
    startedAt: input.record.startedAt,
    lastActivityAt: input.record.updatedAt,
    transcriptFileCount: 0,
    eventCount: input.record.eventCount,
    userMessageCount: countableVisibleEvents.filter((event) => event.kind === "user_message").length,
    assistantMessageCount: countableVisibleEvents.filter((event) => event.kind === "assistant_message").length,
    toolCallCount: logicalToolCallCount(processTraceEvents, fallbackToolCalls),
    toolResultCount: logicalToolResultCount(processTraceEvents, fallbackToolResults),
    tokenInputTotal: input.record.tokenInputTotal,
    tokenOutputTotal: input.record.tokenOutputTotal,
    tokenCacheTotal: input.record.tokenCacheTotal,
    modelProvider: input.record.modelProvider,
    modelId: input.record.modelId,
    lastUserMessagePreview,
    lastAssistantMessagePreview,
    chatReturnTarget: chatReturnTargetFromSessionKey(input.record.sessionKey),
    evidenceLinks: buildSessionEvidenceLinks({
      record: input.record,
      processTraceEvents,
    }),
  };
}
