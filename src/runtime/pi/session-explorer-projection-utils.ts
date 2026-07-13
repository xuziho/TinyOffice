import type { RuntimeSessionEvent } from "../storage/runtime-session-repository.js";
import type { SessionExplorerSessionSummary, SessionExplorerUsageTotals } from "./session-explorer-types.js";

export function nowIso() {
  return new Date().toISOString();
}

export function summarizeText(text: string, maxLength = 220) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

export function compactLine(text: string, maxLength = 160) {
  return summarizeText(text, maxLength);
}

export function usageTotals(input?: Partial<SessionExplorerUsageTotals>): SessionExplorerUsageTotals {
  return {
    inputTokens: Math.max(0, Math.round(Number(input?.inputTokens || 0))),
    outputTokens: Math.max(0, Math.round(Number(input?.outputTokens || 0))),
    cacheTokens: Math.max(0, Math.round(Number(input?.cacheTokens || 0))),
  };
}

export function numberFromUnknown(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function usageFromEvent(event: RuntimeSessionEvent): SessionExplorerUsageTotals | undefined {
  const usage = event.payload && typeof event.payload === "object"
    ? (event.payload as { message?: { usage?: Record<string, unknown> }; usage?: Record<string, unknown> }).message?.usage ||
      (event.payload as { usage?: Record<string, unknown> }).usage
    : undefined;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const total = usageTotals({
    inputTokens: numberFromUnknown(usage.input),
    outputTokens: numberFromUnknown(usage.output),
    cacheTokens: numberFromUnknown(usage.cacheRead) + numberFromUnknown(usage.cacheWrite),
  });
  if (!total.inputTokens && !total.outputTokens && !total.cacheTokens) {
    return undefined;
  }
  return total;
}

export function usageMagnitude(usage: SessionExplorerUsageTotals) {
  return usage.inputTokens + usage.outputTokens + usage.cacheTokens;
}

export function addUsage(left: SessionExplorerUsageTotals, right: SessionExplorerUsageTotals) {
  return usageTotals({
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheTokens: left.cacheTokens + right.cacheTokens,
  });
}

export function textForRuntimeSessionEvent(event: RuntimeSessionEvent) {
  if (event.preview) {
    return event.preview;
  }
  if (event.summary) {
    return event.summary;
  }
  if (event.title) {
    return event.title;
  }
  if (event.payload) {
    return JSON.stringify(event.payload);
  }
  return "";
}

export function visibleMessageCount(session: Pick<SessionExplorerSessionSummary, "userMessageCount" | "assistantMessageCount">) {
  return session.userMessageCount + session.assistantMessageCount;
}

export function hasRecordedModel(session: Pick<SessionExplorerSessionSummary, "modelProvider" | "modelId">) {
  return Boolean(session.modelProvider || session.modelId);
}

export function hasRecordedCwd(session: Pick<SessionExplorerSessionSummary, "cwd">) {
  return Boolean(session.cwd && session.cwd.trim());
}

export function recordedValue(value: string | undefined, fallback = "Not recorded") {
  return value && value.trim() ? value : fallback;
}

export function sessionModelDisplay(session: Pick<SessionExplorerSessionSummary, "modelProvider" | "modelId">) {
  return recordedValue([session.modelProvider, session.modelId].filter(Boolean).join("/"));
}

export function isGenericAssistantReply(text: string | undefined) {
  return !text || /^assistant reply$/i.test(text.trim());
}

export function turnKeyForEvent(event: RuntimeSessionEvent) {
  if (event.turnId) {
    return event.turnId;
  }
  if (event.modelCallId) {
    return event.modelCallId;
  }
  return undefined;
}

export function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}
