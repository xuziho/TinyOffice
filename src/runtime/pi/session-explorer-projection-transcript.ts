import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import type { CollaborationActionEvent, RuntimeSessionEvent } from "../storage/runtime-session-repository.js";
import type { SessionExplorerAiCallTranscript, SessionExplorerAiCallTranscriptEntry, SessionExplorerAiCallTranscriptTurn, SessionExplorerTranscriptDirection } from "./session-explorer-types.js";
import { textForRuntimeSessionEvent } from "./session-explorer-projection-utils.js";

export function transcriptDirectionForRuntimeEvent(event: RuntimeSessionEvent): SessionExplorerTranscriptDirection {
  if (event.kind === "user_message" || (event.kind.startsWith("message_") && event.role === "user")) {
    return "sent_to_ai";
  }
  if (event.role === "toolResult" || event.kind === "tool_result" || event.kind === "tool_execution_end") {
    return "tool_result";
  }
  if (event.kind === "tool_call" || event.kind === "tool_execution_start") {
    return "tool_call";
  }
  if (event.role === "assistant" || event.kind === "assistant_message" || event.kind === "stream_event") {
    return "received_from_ai";
  }
  if (event.kind.endsWith("_start") || event.kind.endsWith("_end")) {
    return "runtime";
  }
  return "debug";
}

export function transcriptLabelForRuntimeEvent(event: RuntimeSessionEvent): string {
  if (event.kind === "user_message") {
    return "User-visible input";
  }
  if (event.kind.startsWith("message_") && event.role === "user") {
    return "Full input sent to AI";
  }
  if (event.kind === "assistant_message") {
    return "Final assistant message";
  }
  if (event.kind === "stream_event" && event.role === "assistant") {
    return "Assistant observable event";
  }
  if (event.role === "toolResult") {
    return "Tool result returned to AI";
  }
  if (event.kind === "tool_execution_start") {
    return "Tool execution started";
  }
  if (event.kind === "tool_execution_end") {
    return "Tool execution finished";
  }
  if (event.role === "assistant") {
    return "Assistant observable event";
  }
  return event.title || event.kind;
}

export function isReadableRuntimeTranscriptEvent(event: RuntimeSessionEvent) {
  if (event.kind === "user_message" || event.kind === "assistant_message") {
    return true;
  }
  if (event.role === "user" && event.kind === "message_end") {
    return true;
  }
  if (event.kind === "tool_result" || event.kind === "tool_call") {
    return true;
  }
  return false;
}

export function transcriptDirectionForTraceEvent(event: ProcessTraceEvent): SessionExplorerTranscriptDirection {
  if (event.kind === "model_tool_call" || event.kind === "tool_activity") {
    return "tool_call";
  }
  if (event.kind === "model_tool_result") {
    return "tool_result";
  }
  if (event.kind === "progress_update" || event.kind === "model_reply_observed" || event.kind === "model_reasoning_observed") {
    return "received_from_ai";
  }
  return "runtime";
}

export function transcriptLabelForTraceEvent(event: ProcessTraceEvent): string {
  if (event.kind === "model_tool_call") {
    return "Model tool call";
  }
  if (event.kind === "model_tool_result") {
    return "Model tool result";
  }
  if (event.kind === "model_reasoning_observed") {
    return "Reasoning summary observation";
  }
  if (event.kind === "progress_update") {
    return "Progress update";
  }
  return event.title || event.kind;
}

export function isReadableTraceTranscriptEvent(event: ProcessTraceEvent) {
  return [
    "model_tool_call",
    "model_tool_result",
    "model_reasoning_observed",
    "progress_update",
    "model_reply_observed",
  ].includes(event.kind);
}

export function logicalToolCallKey(event: ProcessTraceEvent) {
  if (event.kind !== "model_tool_call" && event.kind !== "tool_activity") {
    return undefined;
  }
  const summary = event.summary && event.summary !== "{}" ? event.summary : "";
  return [
    event.kind,
    event.title || "",
    summary || event.preview || "",
  ].join("\u001f");
}

export function dedupeReadableTraceTranscriptEvents(events: ProcessTraceEvent[]) {
  const bestToolCalls = new Map<string, ProcessTraceEvent>();
  const output: ProcessTraceEvent[] = [];
  for (const event of events) {
    const key = logicalToolCallKey(event);
    if (!key) {
      output.push(event);
      continue;
    }
    const canonicalKey = [
      event.kind,
      event.title || "",
      event.summary === "{}" ? "" : event.summary || event.preview || "",
    ].join("\u001f");
    const existing = bestToolCalls.get(canonicalKey);
    if (!existing || existing.summary === "{}" || event.status === "succeeded") {
      bestToolCalls.set(canonicalKey, event);
    }
  }
  output.push(...bestToolCalls.values());
  return output.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function logicalToolCallCount(events: ProcessTraceEvent[], fallback: number) {
  const calls = dedupeReadableTraceTranscriptEvents(events)
    .filter((event) => event.kind === "model_tool_call")
    .filter((event) => event.summary && event.summary !== "{}");
  return calls.length || fallback;
}

export function logicalToolResultCount(events: ProcessTraceEvent[], fallback: number) {
  const results = new Set(
    events
      .filter((event) => event.kind === "model_tool_result")
      .map((event) => [event.title || "", event.summary || event.preview || ""].join("\u001f"))
      .filter((key) => key.trim()),
  );
  return results.size || fallback;
}

export function transcriptTextForTraceEvent(event: ProcessTraceEvent): string {
  if (event.kind === "model_reasoning_observed") {
    return event.preview || event.summary || event.title || "";
  }
  if (event.kind === "model_tool_call" && event.summary === "{}") {
    return "";
  }
  return event.preview || event.summary || event.title || "";
}

export function buildAiCallTranscript(input: {
  events: RuntimeSessionEvent[];
  processTraceEvents: ProcessTraceEvent[];
  collaborationActionEvents: CollaborationActionEvent[];
}): SessionExplorerAiCallTranscript {
  let turnIndex = 1;
  const turns: SessionExplorerAiCallTranscriptTurn[] = [{
    index: turnIndex,
    title: `Turn ${turnIndex}`,
    entries: [],
  }];

  const currentTurn = () => turns[turns.length - 1] as SessionExplorerAiCallTranscriptTurn;
  const startNewTurn = (timestamp?: string) => {
    turnIndex += 1;
    turns.push({
      index: turnIndex,
      title: `Turn ${turnIndex}`,
      startedAt: timestamp,
      entries: [],
    });
  };
  const appendEntry = (entry: SessionExplorerAiCallTranscriptEntry) => {
    if (!currentTurn().startedAt) {
      currentTurn().startedAt = entry.timestamp;
    }
    currentTurn().entries.push(entry);
  };

  for (const event of input.events.filter(isReadableRuntimeTranscriptEvent)) {
    if (event.kind === "turn_start" && currentTurn().entries.length > 0) {
      startNewTurn(event.timestamp);
    }
    appendEntry({
      index: event.sequence,
      timestamp: event.timestamp,
      direction: transcriptDirectionForRuntimeEvent(event),
      label: transcriptLabelForRuntimeEvent(event),
      eventType: event.kind,
      role: event.role,
      text: textForRuntimeSessionEvent(event) || "[no text payload]",
      source: "session_events",
      complete: true,
    });
  }

  const traceOffset = input.events.length + 1;
  dedupeReadableTraceTranscriptEvents(input.processTraceEvents.filter(isReadableTraceTranscriptEvent)).forEach((event, index) => {
    const text = transcriptTextForTraceEvent(event);
    if (!text) {
      return;
    }
    appendEntry({
      index: traceOffset + index,
      timestamp: event.timestamp,
      direction: transcriptDirectionForTraceEvent(event),
      label: transcriptLabelForTraceEvent(event),
      eventType: event.kind,
      text,
      source: "process_trace_events",
      complete: true,
    });
  });

  const actionOffset = traceOffset + input.processTraceEvents.length;
  input.collaborationActionEvents.forEach((event, index) => {
    appendEntry({
      index: actionOffset + index,
      timestamp: event.timestamp,
      direction: "collaboration_action",
      label: `Collaboration action: ${event.actionName}`,
      eventType: event.actionName,
      role: event.employeeId,
      text: [
        event.status,
        event.recipientId ? `recipient=${event.recipientId}` : "",
        event.message || event.progressSummary || "",
      ].filter(Boolean).join("\n"),
      source: "collaboration_action_events",
      complete: true,
    });
  });

  return {
    turns: turns.filter((turn) => turn.entries.length > 0),
    rawEventCount:
      input.events.length +
      input.processTraceEvents.length +
      input.collaborationActionEvents.length,
  };
}
