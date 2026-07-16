import { buildRuntimeSessionInspection } from "../session-inspector/session-inspector.js";
import { FORBIDDEN_PUBLIC_CARRIER_FIELD_NAMES } from "../../collaboration/contracts/conversation-message-contract.js";
import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import type { CollaborationActionEvent, RuntimeSessionEvent, RuntimeSessionRecord } from "../storage/runtime-session-repository.js";
import { buildRuntimeActivity } from "../activity/runtime-activity-projection.js";
import type { SessionExplorerActionSummary, SessionExplorerConversationTurn, SessionExplorerMessageEvent, SessionExplorerPromptInputPackage, SessionExplorerRawEvidence, SessionExplorerRuntimeTurn, SessionExplorerSessionDetail, SessionExplorerSessionOverview, SessionExplorerSessionSummary, SessionExplorerUsage, SessionExplorerUsageTotals, SessionExplorerWorkDone } from "./session-explorer-types.js";
import { buildPromptInputPackages } from "./session-explorer-projection-prompts.js";
import { buildActionSummary, summarizeRuntimeSessionRecord } from "./session-explorer-projection-summary.js";
import { buildAiCallTranscript, dedupeReadableTraceTranscriptEvents, isReadableTraceTranscriptEvent, transcriptTextForTraceEvent } from "./session-explorer-projection-transcript.js";
import { collectRuntimeModelCallUsage, runtimeUsageTotals } from "../usage/runtime-token-usage.js";
import { addUsage, compactLine, isGenericAssistantReply, sessionModelDisplay, textForRuntimeSessionEvent, turnKeyForEvent, usageMagnitude, usageTotals } from "./session-explorer-projection-utils.js";

export function runtimeEventToExplorerEvent(
  event: RuntimeSessionEvent,
): SessionExplorerMessageEvent {
  return {
    index: event.sequence,
    timestamp: event.timestamp,
    eventType: event.kind,
    role: event.role,
    text: textForRuntimeSessionEvent(event),
    fileName: "database",
  };
}

export function buildTurnUsage(events: RuntimeSessionEvent[]) {
  const usageByTurn = new Map<string, { modelCallId?: string; usage: SessionExplorerUsageTotals }>();
  const usageByModelCall = new Map<string, { turnId: string; usage: SessionExplorerUsageTotals }>();
  for (const modelCall of collectRuntimeModelCallUsage(events)) {
    const turnId = modelCall.turnId;
    if (!turnId) {
      continue;
    }
    const usage = runtimeUsageTotals([modelCall]);
    const existing = usageByTurn.get(turnId);
    usageByTurn.set(turnId, {
      modelCallId: existing?.modelCallId || modelCall.modelCallId,
      usage: addUsage(existing?.usage || usageTotals(), usage),
    });
    if (modelCall.modelCallId) {
      usageByModelCall.set(modelCall.modelCallId, { turnId, usage });
    }
  }
  return { usageByTurn, usageByModelCall };
}

export function toolNameFromTraceEvent(event: ProcessTraceEvent) {
  const title = event.title || "";
  const calledMatch = title.match(/\bcalled\s+([A-Za-z0-9_.-]+)/i);
  if (calledMatch?.[1]) {
    return calledMatch[1];
  }
  const resultMatch = title.match(/^([A-Za-z0-9_.-]+)\s+returned/i);
  if (resultMatch?.[1]) {
    return resultMatch[1];
  }
  return title || event.kind;
}

export function buildWorkDone(input: {
  processTraceEvents: ProcessTraceEvent[];
  collaborationActionEvents: CollaborationActionEvent[];
  actionSummary: SessionExplorerActionSummary;
}): SessionExplorerWorkDone {
  const readableTrace = dedupeReadableTraceTranscriptEvents(input.processTraceEvents.filter(isReadableTraceTranscriptEvent));
  const toolCalls = readableTrace
    .filter((event) => event.kind === "model_tool_call" || event.kind === "tool_activity")
    .map((event) => ({
      name: toolNameFromTraceEvent(event),
      summary: compactLine(transcriptTextForTraceEvent(event) || event.title || event.kind),
      timestamp: event.timestamp,
    }))
    .filter((entry) => entry.summary);
  const toolResults = readableTrace
    .filter((event) => event.kind === "model_tool_result")
    .map((event) => ({
      name: toolNameFromTraceEvent(event),
      summary: compactLine(transcriptTextForTraceEvent(event) || event.title || event.kind),
      timestamp: event.timestamp,
    }))
    .filter((entry) => entry.summary);
  return {
    toolCalls,
    toolResults,
    actions: input.actionSummary.items,
    artifacts: [],
  };
}

export function buildConversationTurns(input: {
  record: RuntimeSessionRecord;
  events: RuntimeSessionEvent[];
  processTraceEvents: ProcessTraceEvent[];
}): SessionExplorerConversationTurn[] {
  const { usageByTurn } = buildTurnUsage(input.events);
  const turns = new Map<string, SessionExplorerConversationTurn>();
  const allVisibleEvents = input.events
    .filter((event) => event.kind === "user_message" || event.kind === "assistant_message")
    .sort((left, right) => left.sequence - right.sequence);
  const hasStructuredTurns = allVisibleEvents.some((event) => Boolean(turnKeyForEvent(event)));
  const visibleEvents = hasStructuredTurns
    ? allVisibleEvents.filter((event) => Boolean(turnKeyForEvent(event)))
    : allVisibleEvents;

  let fallbackTurnNumber = 0;
  let currentFallbackTurnId: string | undefined;
  const ensureTurn = (turnId: string, event?: RuntimeSessionEvent) => {
    const existing = turns.get(turnId);
    if (existing) {
      return existing;
    }
    const usage = usageByTurn.get(turnId);
    const turn: SessionExplorerConversationTurn = {
      index: turns.size + 1,
      turnId,
      startedAt: event?.timestamp,
      completedAt: event?.timestamp,
      modelCallId: event?.modelCallId || usage?.modelCallId,
      usage: usage?.usage || usageTotals(),
      toolCalls: [],
    };
    turns.set(turnId, turn);
    return turn;
  };

  for (const event of visibleEvents) {
    const key = turnKeyForEvent(event) || (() => {
      if (event.kind === "user_message" || !currentFallbackTurnId) {
        currentFallbackTurnId = `${input.record.id}|turn|${++fallbackTurnNumber}`;
      }
      return currentFallbackTurnId;
    })();
    const turn = ensureTurn(key, event);
    turn.startedAt = turn.startedAt && turn.startedAt < event.timestamp ? turn.startedAt : event.timestamp;
    turn.completedAt = !turn.completedAt || turn.completedAt < event.timestamp ? event.timestamp : turn.completedAt;
    turn.modelCallId = turn.modelCallId || event.modelCallId;
    if (event.kind === "user_message") {
      turn.userMessage = {
        messageId: stringFromPayload(event.payload, "messageId"),
        timestamp: event.timestamp,
        text: textForRuntimeSessionEvent(event),
      };
    } else if (event.kind === "assistant_message" && !isGenericAssistantReply(textForRuntimeSessionEvent(event))) {
      turn.employeeReply = {
        timestamp: event.timestamp,
        text: textForRuntimeSessionEvent(event),
      };
    }
  }

  return [...turns.values()]
    .sort((left, right) => (left.startedAt || "").localeCompare(right.startedAt || "") || left.index - right.index)
    .map((turn, index) => ({ ...turn, index: index + 1 }));
}

export function buildRuntimeTurns(input: {
  conversationTurns: SessionExplorerConversationTurn[];
  promptInputPackages: SessionExplorerPromptInputPackage[];
  processTraceEvents: ProcessTraceEvent[];
  actionSummary: SessionExplorerActionSummary;
}): SessionExplorerRuntimeTurn[] {
  const promptsByTurn = new Map<string, SessionExplorerPromptInputPackage>();
  for (const prompt of input.promptInputPackages) {
    if (prompt.turnId) {
      promptsByTurn.set(prompt.turnId, prompt);
    }
    if (prompt.modelCallId) {
      promptsByTurn.set(prompt.modelCallId, prompt);
    }
  }

  const turns = input.conversationTurns.map((turn, index) => {
    const inputPackage = promptsByTurn.get(turn.turnId) ||
      (turn.modelCallId ? promptsByTurn.get(turn.modelCallId) : undefined) ||
      (input.conversationTurns.length === 1 ? input.promptInputPackages[0] : undefined);
    const processTraceEvents = processTraceEventsForRuntimeTurn({
      turn,
      nextTurn: input.conversationTurns[index + 1],
      processTraceEvents: input.processTraceEvents,
      turnCount: input.conversationTurns.length,
    });
    const activityItems = buildRuntimeActivity(processTraceEvents).items;
    return {
      index: turn.index,
      turnId: turn.turnId,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
      modelCallId: turn.modelCallId,
      usage: turn.usage,
      triggerMessage: turn.userMessage
        ? {
            label: "Trigger message",
            timestamp: turn.userMessage.timestamp,
            text: turn.userMessage.text,
            source: "session_events",
          }
        : inputPackage?.triggerMessage
          ? {
              label: "Trigger message",
              timestamp: inputPackage.createdAt,
              text: inputPackage.triggerMessage,
              source: "prompt_input_package",
            }
          : undefined,
      inputPackage,
      activity: {
        items: activityItems,
      },
      outputMessage: turn.employeeReply
        ? {
            label: "Output message",
            timestamp: turn.employeeReply.timestamp,
            text: turn.employeeReply.text,
            source: "session_events",
          }
        : undefined,
    };
  });

  if (turns.length > 0) {
    return turns;
  }

  const activityItems = buildRuntimeActivity(input.processTraceEvents).items;
  return input.promptInputPackages.map((prompt, index) => ({
    index: index + 1,
    turnId: prompt.turnId || prompt.modelCallId || `prompt-input-${index + 1}`,
    startedAt: prompt.createdAt,
    completedAt: prompt.createdAt,
    modelCallId: prompt.modelCallId,
    usage: usageTotals(),
    triggerMessage: prompt.triggerMessage
      ? {
          label: "Trigger message",
          timestamp: prompt.createdAt,
          text: prompt.triggerMessage,
          source: "prompt_input_package",
        }
      : undefined,
    inputPackage: prompt,
    activity: {
      items: activityItems,
    },
  }));
}

function processTraceEventsForRuntimeTurn(input: {
  turn: SessionExplorerConversationTurn;
  nextTurn?: SessionExplorerConversationTurn;
  processTraceEvents: ProcessTraceEvent[];
  turnCount: number;
}): ProcessTraceEvent[] {
  if (input.turnCount <= 1) {
    return input.processTraceEvents;
  }

  const explicitMatches = input.processTraceEvents.filter((event) =>
    processTraceEventMatchesTurn(event, input.turn),
  );
  if (explicitMatches.length > 0) {
    return explicitMatches;
  }

  const startedAt = input.turn.startedAt || input.turn.completedAt;
  if (!startedAt) {
    return [];
  }
  const nextStartedAt = input.nextTurn?.startedAt || input.nextTurn?.completedAt;
  return input.processTraceEvents.filter((event) => {
    if (processTraceEventHasExplicitTurnReference(event)) {
      return false;
    }
    if (event.timestamp < startedAt) {
      return false;
    }
    if (nextStartedAt && event.timestamp >= nextStartedAt) {
      return false;
    }
    return true;
  });
}

function processTraceEventMatchesTurn(
  event: ProcessTraceEvent,
  turn: SessionExplorerConversationTurn,
): boolean {
  if (turn.userMessage?.messageId && processTraceEventSourceMessageIds(event).includes(turn.userMessage.messageId)) {
    return true;
  }
  const explicitRefs = processTraceEventTurnReferences(event);
  if (explicitRefs.length === 0) {
    return false;
  }
  return explicitRefs.includes(turn.turnId) ||
    (turn.modelCallId ? explicitRefs.includes(turn.modelCallId) : false);
}

function processTraceEventHasExplicitTurnReference(event: ProcessTraceEvent): boolean {
  return processTraceEventTurnReferences(event).length > 0 || processTraceEventSourceMessageIds(event).length > 0;
}

function processTraceEventSourceMessageIds(event: ProcessTraceEvent): string[] {
  const metadata = event.metadata || {};
  return [
    metadata.sourceMessageId,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

function processTraceEventTurnReferences(event: ProcessTraceEvent): string[] {
  const metadata = event.metadata || {};
  return [
    metadata.turnId,
    metadata.runtimeTurnId,
    metadata.conversationTurnId,
    metadata.modelCallId,
    metadata.piModelCallId,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

function stringFromPayload(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function buildUsage(input: {
  record: RuntimeSessionRecord;
  events: RuntimeSessionEvent[];
  conversationTurns: SessionExplorerConversationTurn[];
}): SessionExplorerUsage {
  const total = usageTotals({
    inputTokens: input.record.tokenInputTotal,
    outputTokens: input.record.tokenOutputTotal,
    cacheTokens: input.record.tokenCacheTotal,
  });
  const turnUsageTotal = input.conversationTurns.reduce(
    (sum, turn) => addUsage(sum, turn.usage),
    usageTotals(),
  );
  const useTurnTotals =
    usageMagnitude(turnUsageTotal) > 0 &&
    usageMagnitude(turnUsageTotal) === usageMagnitude(total);
  return {
    total,
    byTurn: input.conversationTurns.map((turn) => ({
      turnId: turn.turnId,
      modelCallId: turn.modelCallId,
      usage: useTurnTotals || usageMagnitude(turn.usage) > 0 ? turn.usage : usageTotals(),
    })),
  };
}

export function buildRawEvidence(input: {
  record: RuntimeSessionRecord;
  events: RuntimeSessionEvent[];
  processTraceEvents: ProcessTraceEvent[];
  collaborationActionEvents: CollaborationActionEvent[];
  runtimeInspection: ReturnType<typeof buildRuntimeSessionInspection>;
}): SessionExplorerRawEvidence {
  return {
    sessionEventCount: input.events.length,
    processTraceEventCount: input.processTraceEvents.length,
    collaborationActionEventCount: input.collaborationActionEvents.length,
    rawEventCount: input.events.length + input.processTraceEvents.length + input.collaborationActionEvents.length,
    sources: ["session_events", "process_trace_events", "collaboration_action_events"],
    diagnostics: input.runtimeInspection.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
  };
}

export function buildOverview(input: {
  summary: SessionExplorerSessionSummary;
  conversationTurns: SessionExplorerConversationTurn[];
  usage: SessionExplorerUsage;
  runtimeInspection: ReturnType<typeof buildRuntimeSessionInspection>;
}): SessionExplorerSessionOverview {
  return {
    status: input.summary.lastActivityAt ? input.runtimeInspection.header.liveStatus : "unknown",
    surface: input.summary.sceneType || "unknown",
    turns: input.conversationTurns.length,
    messages: {
      user: input.summary.userMessageCount,
      employee: input.summary.assistantMessageCount,
    },
    modelCalls: input.runtimeInspection.modelCalls.length || input.conversationTurns.length,
    tools: input.summary.toolCallCount,
    usage: input.usage.total,
    startedAt: input.summary.startedAt,
    lastActivityAt: input.summary.lastActivityAt,
    requester: input.summary.requesterUsername,
    model: sessionModelDisplay(input.summary),
    cwd: input.summary.cwd,
  };
}

export function runtimeDetailToSessionExplorerDetail(input: {
  record: RuntimeSessionRecord;
  events: RuntimeSessionEvent[];
  processTraceEvents: ProcessTraceEvent[];
  collaborationActionEvents: CollaborationActionEvent[];
  employeeProfiles: Map<string, { displayName: string; role: string }>;
}): SessionExplorerSessionDetail {
  const runtimeInspection = sanitizePublicRuntimeInspection(buildRuntimeSessionInspection(input));
  const summary = summarizeRuntimeSessionRecord(input);
  const actionSummary = buildActionSummary(input);
  const conversationTurns = buildConversationTurns(input);
  const promptInputPackages = buildPromptInputPackages(input.events);
  const usage = buildUsage({
    record: input.record,
    events: input.events,
    conversationTurns,
  });
  const workDone = buildWorkDone({
    processTraceEvents: input.processTraceEvents,
    collaborationActionEvents: input.collaborationActionEvents,
    actionSummary,
  });
  const runtimeTurns = buildRuntimeTurns({
    conversationTurns,
    promptInputPackages,
    processTraceEvents: input.processTraceEvents,
    actionSummary,
  });
  const rawEvidence = buildRawEvidence({
    ...input,
    runtimeInspection,
  });
  return {
    summary,
    overview: buildOverview({
      summary,
      conversationTurns,
      usage,
      runtimeInspection,
    }),
    runtimeTurns,
    conversationTurns,
    promptInputPackages,
    workDone,
    usage,
    rawEvidence,
    transcriptFiles: ["database:session_events"],
    events: input.events.map(runtimeEventToExplorerEvent),
    aiCallTranscript: buildAiCallTranscript(input),
    runtimeInspection,
    actionSummary,
  };
}

const forbiddenPublicCarrierFieldNames = new Set<string>(FORBIDDEN_PUBLIC_CARRIER_FIELD_NAMES);

function sanitizePublicRuntimeInspection(
  inspection: ReturnType<typeof buildRuntimeSessionInspection>,
): ReturnType<typeof buildRuntimeSessionInspection> {
  return {
    ...inspection,
    rawEvidence: inspection.rawEvidence.map((entry) => ({
      ...entry,
      payload: sanitizePublicRawEvidencePayload(entry.payload),
    })),
  };
}

function sanitizePublicRawEvidencePayload(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizePublicRawEvidencePayload);
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenPublicCarrierFieldNames.has(key)) {
      continue;
    }
    output[key] = sanitizePublicRawEvidencePayload(child);
  }
  return output;
}
