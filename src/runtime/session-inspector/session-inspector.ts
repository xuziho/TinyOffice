import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import type {
  CollaborationActionEvent,
  RuntimeSessionEvent,
  RuntimeSessionMetadataField,
  RuntimeSessionRecord,
  RuntimeSessionStatus,
} from "../storage/runtime-session-repository.js";

export type RuntimeSessionInspectionDataState =
  | "recorded"
  | "derived"
  | "not_recorded"
  | "not_observed";

export interface RuntimeSessionInspectionInput {
  record: RuntimeSessionRecord;
  events: RuntimeSessionEvent[];
  processTraceEvents: ProcessTraceEvent[];
  collaborationActionEvents: CollaborationActionEvent[];
}

export interface RuntimeSessionInspection {
  header: {
    id: string;
    employeeId: string;
    sceneType: string;
    liveStatus: RuntimeSessionStatus;
    startedAt: string;
    updatedAt: string;
  };
  trigger: {
    requesterId?: string;
    userMessage?: string;
    sourceEventId?: string;
  };
  userVisibleTimeline: RuntimeSessionVisibleEntry[];
  runtimeTimeline: RuntimeSessionTimelineEntry[];
  modelCalls: RuntimeSessionModelCall[];
  actionLedger: RuntimeSessionActionLedgerEntry[];
  promptAndContext: {
    userPrompt: RuntimeSessionFieldState;
    sections: RuntimeSessionPromptContextSection[];
  };
  model: {
    provider?: string;
    id?: string;
    dataState: {
      configured: RuntimeSessionInspectionDataState;
      observed: RuntimeSessionInspectionDataState;
    };
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheTokens: number;
      dataState: RuntimeSessionInspectionDataState;
    };
  };
  runtimeMetadata: RuntimeSessionInspectionRuntimeMetadata;
  diagnostics: RuntimeSessionDiagnostic[];
  rawEvidence: RuntimeSessionRawEvidence[];
}

export interface RuntimeSessionVisibleEntry {
  kind: "user_message" | "assistant_message";
  timestamp: string;
  text?: string;
  sourceEventId: string;
}

export interface RuntimeSessionTimelineEntry {
  source: "runtime_event" | "process_trace" | "collaboration_action";
  id: string;
  timestamp: string;
  kind: string;
  role?: string;
  title?: string;
  summary?: string;
  preview?: string;
}

export interface RuntimeSessionModelCall {
  index: number;
  modelCallId?: string;
  purpose: "primary_response";
  startedAt?: string;
  completedAt?: string;
  input: {
    userPrompt?: string;
    fullInput?: string;
    sourceEventIds: string[];
  };
  output: {
    finalText?: string;
    sourceEventIds: string[];
  };
  toolCalls: RuntimeSessionObservedToolCall[];
}

export interface RuntimeSessionObservedToolCall {
  name: string;
  arguments?: unknown;
  sourceEventId: string;
}

export interface RuntimeSessionActionLedgerEntry {
  name: string;
  status?: string;
  emitted: boolean;
  recipientId?: string;
  message?: string;
  progressSummary?: string;
  decision?: string;
  emittedCount: number;
  suppressedCount: number;
  sourceEventIds: string[];
  actionEventIds: string[];
  toolEvidenceEventIds: string[];
  processTraceEventIds: string[];
  rawEvidenceIds: string[];
}

export interface RuntimeSessionFieldState {
  state: RuntimeSessionInspectionDataState;
  value?: string;
  source?: string;
}

export interface RuntimeSessionToolsInspection {
  state: RuntimeSessionInspectionDataState;
  source?: string;
  loadedToolNames: string[];
  loadedSkillNames: string[];
  activeToolNames: string[];
  diagnostic?: string;
}

export interface RuntimeSessionInspectionRuntimeMetadata {
  cwd: RuntimeSessionFieldState;
  tools: RuntimeSessionToolsInspection;
}

export interface RuntimeSessionPromptContextSection {
  semanticRole: string;
  state: RuntimeSessionInspectionDataState;
  value?: string;
  source?: string;
  visibility?: RuntimeSessionEvent["visibility"];
  sourceEventIds: string[];
}

export interface RuntimeSessionDiagnostic {
  code:
    | "missing_model_observation"
    | "missing_user_trigger";
  severity: "info" | "warning";
  message: string;
}

export interface RuntimeSessionRawEvidence {
  source: "runtime_event" | "process_trace" | "collaboration_action";
  id: string;
  timestamp: string;
  kind: string;
  payload: unknown;
}

interface MutableModelCall {
  purpose: RuntimeSessionModelCall["purpose"];
  startedAt?: string;
  completedAt?: string;
  input: RuntimeSessionModelCall["input"];
  output: RuntimeSessionModelCall["output"];
  toolCalls: RuntimeSessionObservedToolCall[];
}

export function buildRuntimeSessionInspection(input: RuntimeSessionInspectionInput): RuntimeSessionInspection {
  const events = [...input.events].sort((left, right) => left.sequence - right.sequence);
  const modelCalls = buildModelCalls(events);
  const firstVisibleUserMessage = events.find(isUserVisibleMessage);

  const diagnostics: RuntimeSessionDiagnostic[] = [];
  if (!input.record.modelProvider || !input.record.modelId) {
    diagnostics.push({
      code: "missing_model_observation",
      severity: "warning",
      message: "The runtime session record does not contain a configured or observed model.",
    });
  }
  if (!firstVisibleUserMessage) {
    diagnostics.push({
      code: "missing_user_trigger",
      severity: "warning",
      message: "No original user message was recorded for this session.",
    });
  }

  return {
    header: {
      id: input.record.id,
      employeeId: input.record.employeeId,
      sceneType: input.record.sceneType,
      liveStatus: input.record.status,
      startedAt: input.record.startedAt,
      updatedAt: input.record.updatedAt,
    },
    trigger: {
      requesterId: input.record.requesterId,
      userMessage: firstVisibleUserMessage?.preview,
      sourceEventId: firstVisibleUserMessage?.id,
    },
    userVisibleTimeline: buildUserVisibleTimeline(events),
    runtimeTimeline: buildRuntimeTimeline(input),
    modelCalls,
    actionLedger: buildActionLedger(input),
    promptAndContext: {
      userPrompt: firstVisibleUserMessage?.preview
        ? { state: "derived", value: firstVisibleUserMessage.preview, source: "runtime_events.user_message" }
        : { state: "not_observed" },
      sections: buildPromptAndContextSections(events),
    },
    model: {
      provider: input.record.modelProvider,
      id: input.record.modelId,
      dataState: {
        configured: input.record.modelProvider && input.record.modelId ? "recorded" : "not_recorded",
        observed: "not_observed",
      },
      usage: {
        inputTokens: input.record.tokenInputTotal,
        outputTokens: input.record.tokenOutputTotal,
        cacheTokens: input.record.tokenCacheTotal,
        dataState: input.record.tokenInputTotal || input.record.tokenOutputTotal || input.record.tokenCacheTotal
          ? "recorded"
          : "not_observed",
      },
    },
    runtimeMetadata: buildRuntimeMetadataInspection(input.record),
    diagnostics,
    rawEvidence: buildRawEvidence(input),
  };
}

function normalizeMetadataState(value: string | undefined): RuntimeSessionInspectionDataState {
  if (value === "derived_from_events") {
    return "derived";
  }
  if (
    value === "recorded" ||
    value === "not_recorded" ||
    value === "not_observed"
  ) {
    return value;
  }
  return "not_recorded";
}

function metadataFieldToInspection(
  field: RuntimeSessionMetadataField | undefined,
  fallbackState: RuntimeSessionInspectionDataState = "not_recorded",
): RuntimeSessionFieldState {
  if (!field || typeof field !== "object") {
    return { state: fallbackState };
  }
  const candidate = field as { state?: string; value?: string; source?: string };
  return {
    state: normalizeMetadataState(candidate.state),
    value: candidate.value,
    source: candidate.source,
  };
}

function buildRuntimeMetadataInspection(record: RuntimeSessionRecord): RuntimeSessionInspectionRuntimeMetadata {
  const tools = record.runtimeMetadata?.tools;
  return {
    cwd: metadataFieldToInspection(record.runtimeMetadata?.cwd),
    tools: {
      state: normalizeMetadataState(tools?.state),
      source: tools?.source,
      loadedToolNames: tools?.loadedToolNames || [],
      loadedSkillNames: tools?.loadedSkillNames || [],
      activeToolNames: tools?.activeToolNames || [],
      diagnostic: tools?.diagnostic,
    },
  };
}

function buildPromptAndContextSections(events: RuntimeSessionEvent[]): RuntimeSessionPromptContextSection[] {
  return events
    .filter(isPromptOrContextSection)
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => ({
      semanticRole: event.semanticRole || (isUserVisibleMessage(event) ? "user_message" : event.kind),
      state: "recorded" as const,
      value: event.preview,
      source: event.source,
      visibility: event.visibility,
      sourceEventIds: [event.id],
    }));
}

function isPromptOrContextSection(event: RuntimeSessionEvent): boolean {
  if (isUserVisibleMessage(event)) {
    return true;
  }
  return [
    "runtime_context",
    "channel_thread_context",
    "intake_event_context",
    "work_run_context",
    "system_prompt",
    "runtime_prompt_package",
    "prompt_package",
    "tool_policy",
    "model_input",
  ].includes(event.semanticRole || "");
}

function buildUserVisibleTimeline(events: RuntimeSessionEvent[]): RuntimeSessionVisibleEntry[] {
  const entries = events
    .filter((event) => isUserVisibleMessage(event) || isAssistantVisibleMessage(event))
    .map((event) => ({
      kind: isUserVisibleMessage(event) ? "user_message" as const : "assistant_message" as const,
      timestamp: event.timestamp,
      text: event.preview,
      sourceEventId: event.id,
    }));

  return entries.filter((entry, index) => {
    const previous = entries[index - 1];
    return !(
      entry.kind === "user_message"
      && previous?.kind === "user_message"
      && entry.text === previous.text
    );
  });
}

function buildRuntimeTimeline(input: RuntimeSessionInspectionInput): RuntimeSessionTimelineEntry[] {
  return [
    ...input.events.map((event) => ({
      source: "runtime_event" as const,
      id: event.id,
      timestamp: event.timestamp,
      kind: event.kind,
      role: event.role,
      title: event.title,
      summary: event.summary,
      preview: event.preview,
    })),
    ...input.processTraceEvents.map((event) => ({
      source: "process_trace" as const,
      id: event.id,
      timestamp: event.timestamp,
      kind: event.kind,
      title: event.title,
      summary: sanitizeTraceText(event),
      preview: event.kind === "model_reasoning_observed" ? undefined : event.preview,
    })),
    ...input.collaborationActionEvents.map((event) => ({
      source: "collaboration_action" as const,
      id: event.id,
      timestamp: event.timestamp,
      kind: event.actionName,
      title: event.emitted ? "Emitted collaboration action" : "Suppressed collaboration action",
      summary: event.message || event.progressSummary || event.decision,
    })),
  ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function buildModelCalls(events: RuntimeSessionEvent[]): RuntimeSessionModelCall[] {
  if (events.some((event) => event.modelCallId)) {
    return buildStructuredModelCalls(events);
  }

  const calls: MutableModelCall[] = [];
  let current: MutableModelCall | undefined;

  for (const event of events) {
    if (event.kind === "user_message" && event.role === "user") {
      if (isDuplicateUserPromptForCurrentCall(current, event)) {
        current.input.sourceEventIds.push(event.id);
        continue;
      }
      if (current) {
        calls.push(current);
      }
      current = {
        purpose: "primary_response",
        startedAt: event.timestamp,
        input: {
          userPrompt: event.preview,
          sourceEventIds: [event.id],
        },
        output: {
          sourceEventIds: [],
        },
        toolCalls: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (event.role === "user" && (event.kind === "message_start" || event.kind === "message_end")) {
      current.input.fullInput = event.preview || current.input.fullInput;
      current.input.sourceEventIds.push(event.id);
      continue;
    }

    if (event.role === "assistant" || event.role === "toolResult") {
      current.completedAt = event.timestamp;
      current.output.sourceEventIds.push(event.id);
      if (event.role === "assistant" && event.kind === "message_end" && event.preview) {
        current.output.finalText = event.preview;
      }
      current.toolCalls.push(...extractToolCalls(event));
    }
  }

  if (current) {
    calls.push(current);
  }

  return calls.map((call, index) => ({
    index: index + 1,
    ...call,
    input: {
      ...call.input,
      sourceEventIds: [...new Set(call.input.sourceEventIds)],
    },
    output: {
      ...call.output,
      sourceEventIds: [...new Set(call.output.sourceEventIds)],
    },
    toolCalls: dedupeToolCalls(call.toolCalls),
  }));
}

function buildStructuredModelCalls(events: RuntimeSessionEvent[]): RuntimeSessionModelCall[] {
  const grouped = new Map<string, RuntimeSessionEvent[]>();
  for (const event of events) {
    if (!event.modelCallId) {
      continue;
    }
    grouped.set(event.modelCallId, [...(grouped.get(event.modelCallId) || []), event]);
  }

  return [...grouped.entries()]
    .map(([modelCallId, group]) => {
      const ordered = [...group].sort((left, right) =>
        left.timestamp.localeCompare(right.timestamp) || left.sequence - right.sequence
      );
      const inputEvents = ordered.filter((event) =>
        isUserVisibleMessage(event)
        || event.visibility === "model_input"
        || event.semanticRole === "prompt_package"
      );
      const outputEvents = ordered.filter((event) =>
        isAssistantVisibleMessage(event)
        || event.role === "assistant"
        || event.role === "toolResult"
        || event.semanticRole === "model_delta"
        || event.semanticRole === "runtime_error"
        || event.kind === "model_call_completed"
        || event.kind === "model_call_failed"
      );
      const lifecycleStarted = ordered.find((event) => event.kind === "model_call_started");
      const lifecycleCompleted = [...ordered]
        .reverse()
        .find((event) => event.kind === "model_call_completed" || event.kind === "model_call_failed");
      const visibleUserPrompt = inputEvents.find(isUserVisibleMessage);
      const fullInput = [...inputEvents]
        .reverse()
        .find((event) => event.semanticRole === "prompt_package")
        ?.preview || [...inputEvents]
        .reverse()
        .find((event) => event.visibility === "model_input")
        ?.preview;
      const finalAssistantText = lifecycleCompleted?.preview || [...outputEvents]
        .reverse()
        .find(isAssistantVisibleMessage)
        ?.preview;
      return {
        index: 0,
        modelCallId,
        purpose: "primary_response" as const,
        startedAt: lifecycleStarted?.timestamp || ordered[0]?.timestamp,
        completedAt: lifecycleCompleted?.timestamp || outputEvents.at(-1)?.timestamp || ordered.at(-1)?.timestamp,
        input: {
          userPrompt: visibleUserPrompt?.preview,
          fullInput,
          sourceEventIds: [...new Set(inputEvents.map((event) => event.id))],
        },
        output: {
          finalText: finalAssistantText,
          sourceEventIds: [...new Set(outputEvents.map((event) => event.id))],
        },
        toolCalls: dedupeToolCalls(outputEvents.flatMap(extractToolCalls)),
      };
    })
    .sort((left, right) => (left.startedAt || "").localeCompare(right.startedAt || ""))
    .map((call, index) => ({
      ...call,
      index: index + 1,
    }));
}

function isDuplicateUserPromptForCurrentCall(
  current: MutableModelCall | undefined,
  event: RuntimeSessionEvent,
): current is MutableModelCall {
  return !!current
    && current.input.userPrompt === event.preview
    && current.output.sourceEventIds.length === 0
    && current.toolCalls.length === 0;
}

function buildActionLedger(input: RuntimeSessionInspectionInput): RuntimeSessionActionLedgerEntry[] {
  const grouped = new Map<string, CollaborationActionEvent[]>();
  for (const event of input.collaborationActionEvents) {
    const key = [
      event.actionName,
      event.recipientId || "",
      event.message || "",
      event.progressSummary || "",
      event.decision || "",
    ].join("\u001f");
    grouped.set(key, [...(grouped.get(key) || []), event]);
  }

  return [...grouped.values()].map((group) => {
    const emittedEvent = group.find((event) => event.emitted);
    const representative = emittedEvent || group[0] as CollaborationActionEvent;
    const toolEvidenceEventIds = findToolEvidenceEventIds(input.events, representative);
    const processTraceEventIds = findActionProcessTraceEventIds(input.processTraceEvents, representative);
    const actionEventIds = group.map((event) => event.id);
    return {
      name: representative.actionName,
      status: representative.status,
      emitted: group.some((event) => event.emitted),
      recipientId: representative.recipientId,
      message: representative.message,
      progressSummary: representative.progressSummary,
      decision: representative.decision,
      emittedCount: group.filter((event) => event.emitted).length,
      suppressedCount: group.filter((event) => !event.emitted).length,
      sourceEventIds: actionEventIds,
      actionEventIds,
      toolEvidenceEventIds,
      processTraceEventIds,
      rawEvidenceIds: [...actionEventIds, ...toolEvidenceEventIds, ...processTraceEventIds],
    };
  });
}

function findToolEvidenceEventIds(
  events: RuntimeSessionEvent[],
  action: CollaborationActionEvent,
): string[] {
  return events
    .filter((event) => extractToolCalls(event).some((toolCall) =>
      toolCall.name === action.actionName &&
      toolCallMatchesAction(toolCall.arguments, action)
    ))
    .map((event) => event.id);
}

function findActionProcessTraceEventIds(
  events: ProcessTraceEvent[],
  action: CollaborationActionEvent,
): string[] {
  return events
    .filter((event) => {
      const text = [
        event.kind,
        event.title,
        event.summary,
        event.preview,
        event.metadata ? JSON.stringify(event.metadata) : "",
      ].filter(Boolean).join("\n");
      return text.includes(action.actionName) &&
        (!action.recipientId || text.includes(action.recipientId) || event.kind === "structured_action_replayed");
    })
    .map((event) => event.id);
}

function toolCallMatchesAction(
  args: unknown,
  action: CollaborationActionEvent,
): boolean {
  if (!isRecord(args)) {
    return true;
  }
  const toId = typeof args.toId === "string" ? args.toId : undefined;
  const message = typeof args.message === "string" ? args.message : undefined;
  return (!action.recipientId || !toId || action.recipientId === toId) &&
    (!action.message || !message || action.message === message);
}

function buildRawEvidence(input: RuntimeSessionInspectionInput): RuntimeSessionRawEvidence[] {
  return [
    ...input.events.map((event) => ({
      source: "runtime_event" as const,
      id: event.id,
      timestamp: event.timestamp,
      kind: event.kind,
      payload: event,
    })),
    ...input.processTraceEvents.map((event) => ({
      source: "process_trace" as const,
      id: event.id,
      timestamp: event.timestamp,
      kind: event.kind,
      payload: sanitizeTraceEvent(event),
    })),
    ...input.collaborationActionEvents.map((event) => ({
      source: "collaboration_action" as const,
      id: event.id,
      timestamp: event.timestamp,
      kind: event.actionName,
      payload: event,
    })),
  ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function extractToolCalls(event: RuntimeSessionEvent): RuntimeSessionObservedToolCall[] {
  const items = getMessageItems(event.payload);
  const toolCalls: RuntimeSessionObservedToolCall[] = [];
  if (isRecord(event.payload?.toolCall) && typeof event.payload.toolCall.name === "string") {
    toolCalls.push({
      name: event.payload.toolCall.name,
      arguments: event.payload.toolCall.arguments,
      sourceEventId: event.id,
    });
  }
  for (const item of items) {
    if (!isRecord(item) || item.type !== "toolCall" || typeof item.name !== "string") {
      continue;
    }
    toolCalls.push({
      name: item.name,
      arguments: item.arguments,
      sourceEventId: event.id,
    });
  }
  return toolCalls;
}

function getMessageItems(payload: Record<string, unknown> | undefined): unknown[] {
  const message = payload?.message;
  if (!isRecord(message)) {
    return [];
  }
  return Array.isArray(message.items) ? message.items : [];
}

function dedupeToolCalls(toolCalls: RuntimeSessionObservedToolCall[]): RuntimeSessionObservedToolCall[] {
  const seen = new Set<string>();
  const deduped: RuntimeSessionObservedToolCall[] = [];
  for (const toolCall of toolCalls) {
    const key = JSON.stringify([toolCall.name, toolCall.arguments]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(toolCall);
  }
  return deduped;
}

function isUserVisibleMessage(event: RuntimeSessionEvent): boolean {
  if (event.visibility || event.semanticRole) {
    return event.visibility === "user_visible" && event.semanticRole === "user_message";
  }
  return event.kind === "user_message" && event.role === "user";
}

function isAssistantVisibleMessage(event: RuntimeSessionEvent): boolean {
  if (event.visibility || event.semanticRole) {
    return event.visibility === "user_visible" && event.semanticRole === "assistant_visible_message";
  }
  return event.kind === "assistant_message" && event.role === "assistant";
}

function sanitizeTraceText(event: ProcessTraceEvent): string | undefined {
  if (event.kind === "model_reasoning_observed") {
    return "A reasoning summary was observed. Detailed reasoning is not shown.";
  }
  return event.summary;
}

function sanitizeTraceEvent(event: ProcessTraceEvent): ProcessTraceEvent {
  if (event.kind !== "model_reasoning_observed") {
    return event;
  }
  return {
    ...event,
    summary: "A reasoning summary was observed. Detailed reasoning is not shown.",
    preview: undefined,
    metadata: undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
