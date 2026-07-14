export type CountableRuntimeSessionEvent = {
  id: string;
  kind: string;
  rawEventKind?: string;
  payload?: Record<string, unknown>;
};

export function logicalRuntimeSessionToolCounts(events: CountableRuntimeSessionEvent[]): {
  toolCallCount: number;
  toolResultCount: number;
} {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const event of events) {
    const kind = event.rawEventKind || event.kind;
    const key = toolEventKey(event);
    if (kind === "tool_call" || kind === "model_tool_call" || kind === "tool_execution_start") {
      calls.add(key);
    }
    if (kind === "tool_result" || kind === "model_tool_result" || kind === "tool_execution_end") {
      results.add(key);
    }
  }
  return {
    toolCallCount: calls.size,
    toolResultCount: results.size,
  };
}

function toolEventKey(event: CountableRuntimeSessionEvent): string {
  const direct = stringValue(event.payload?.toolCallId);
  const nested = recordValue(event.payload?.toolCall);
  return direct || stringValue(nested?.id) || event.id;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
