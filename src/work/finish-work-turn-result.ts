export type WorkRunResultStatus =
  | "in_progress"
  | "complete"
  | "blocked"
  | "failed"
  | "canceled";

export interface WorkRunResult {
  status: WorkRunResultStatus;
  summary?: string;
  evidence?: string[];
  blockerMessage?: string;
}

type WorkRunFinalOutputEvent = {
  kind: string;
  status?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
};

export function workRunResultFromProcessEvents(events: WorkRunFinalOutputEvent[]): WorkRunResult {
  const calls = successfulFinalToolArgumentCalls(events, "finish_work_turn");
  if (calls.length === 0) {
    throw new Error("WorkRun final output requires finish_work_turn; finish_work_turn was not called.");
  }
  if (calls.length > 1) {
    throw new Error("WorkRun final output requires finish_work_turn to be called exactly once.");
  }
  const args = calls[0] as Record<string, unknown>;
  return normalizeFinishWorkTurnArguments(args);
}

function successfulFinalToolArgumentCalls(
  events: WorkRunFinalOutputEvent[],
  toolName: string,
): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.kind !== "model_tool_call" || event.metadata?.toolName !== toolName) {
      continue;
    }
    if (event.status !== "succeeded") {
      continue;
    }
    const args = event.metadata.arguments;
    if (args && typeof args === "object" && !Array.isArray(args)) {
      calls.push(args as Record<string, unknown>);
    }
  }
  return calls;
}

function normalizeFinishWorkTurnArguments(record: Record<string, unknown>): WorkRunResult {
  const status = requiredStatus(record.status);
  const result: WorkRunResult = {
    status,
    summary: stringField(record, "summary"),
    evidence: stringArray(record.evidence),
    blockerMessage: stringField(record, "blockerMessage"),
  };

  validateWorkRunResult(result);
  return result;
}

function validateWorkRunResult(result: WorkRunResult) {
  if (result.status === "complete" && (!result.evidence || result.evidence.length === 0)) {
    throw new Error("finish_work_turn status complete requires evidence.");
  }
  if (result.status === "blocked") {
    if (!result.blockerMessage) {
      throw new Error("finish_work_turn status blocked requires blockerMessage.");
    }
  }
}

function requiredStatus(value: unknown): WorkRunResultStatus {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized === "in_progress" ||
    normalized === "complete" ||
    normalized === "blocked" ||
    normalized === "failed" ||
    normalized === "canceled"
  ) {
    return normalized;
  }
  throw new Error("finish_work_turn status is invalid.");
}

function stringField(record: Record<string, unknown>, fieldName: string): string | undefined {
  const value = record[fieldName];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .map((item) => item.trim());
  return items.length > 0 ? items : undefined;
}
