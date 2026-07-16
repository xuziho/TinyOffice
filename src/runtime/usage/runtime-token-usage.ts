import type { RuntimeTokenUsage } from "../provider/contracts.js";

export interface RuntimeUsageEventLike {
  id: string;
  sequence?: number;
  turnId?: string;
  modelCallId?: string;
  payload?: Record<string, unknown>;
}

export interface RuntimeModelCallUsage {
  key: string;
  modelCallId?: string;
  turnId?: string;
  usage: RuntimeTokenUsage;
}

export interface RuntimeUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

export function collectRuntimeModelCallUsage(
  events: RuntimeUsageEventLike[],
  authoritativeUsage?: {
    modelCallId: string;
    turnId?: string;
    usage: RuntimeTokenUsage;
  },
): RuntimeModelCallUsage[] {
  const usagesByCall = new Map<string, RuntimeModelCallUsage>();
  for (const event of [...events].sort((left, right) => (left.sequence || 0) - (right.sequence || 0))) {
    const usage = runtimeTokenUsageFromEvent(event);
    if (!usage) {
      continue;
    }
    const key = event.modelCallId || `legacy:${event.turnId || event.id}`;
    usagesByCall.set(key, {
      key,
      modelCallId: event.modelCallId,
      turnId: event.turnId,
      usage,
    });
  }
  if (authoritativeUsage) {
    const normalizedUsage = normalizeRuntimeTokenUsage(authoritativeUsage.usage);
    if (!normalizedUsage) {
      return [...usagesByCall.values()];
    }
    const existing = usagesByCall.get(authoritativeUsage.modelCallId);
    usagesByCall.set(authoritativeUsage.modelCallId, {
      key: authoritativeUsage.modelCallId,
      modelCallId: authoritativeUsage.modelCallId,
      turnId: authoritativeUsage.turnId || existing?.turnId,
      usage: normalizedUsage,
    });
  }
  return [...usagesByCall.values()];
}

export function runtimeTokenUsageFromEvent(event: Pick<RuntimeUsageEventLike, "payload">): RuntimeTokenUsage | undefined {
  const message = event.payload?.message;
  const messageUsage = message && typeof message === "object"
    ? (message as { usage?: unknown }).usage
    : undefined;
  const rawUsage = messageUsage || event.payload?.usage;
  return normalizeRuntimeTokenUsage(rawUsage);
}

export function normalizeRuntimeTokenUsage(usage: unknown): RuntimeTokenUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const record = usage as {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    totalTokens?: unknown;
    cost?: { total?: unknown };
  };
  const normalized: RuntimeTokenUsage = {
    input: numberFrom(record.input),
    output: numberFrom(record.output),
    cacheRead: numberFrom(record.cacheRead),
    cacheWrite: numberFrom(record.cacheWrite),
    totalTokens: numberFrom(record.totalTokens),
    cost: { total: numberFrom(record.cost?.total) },
  };
  return runtimeTokenUsageMagnitude(normalized) > 0 ? normalized : undefined;
}

export function runtimeUsageTotals(
  usages: Iterable<Pick<RuntimeModelCallUsage, "usage">>,
): RuntimeUsageTotals {
  const total = { inputTokens: 0, outputTokens: 0, cacheTokens: 0 };
  for (const entry of usages) {
    total.inputTokens += tokenTotal(entry.usage.input);
    total.outputTokens += tokenTotal(entry.usage.output);
    total.cacheTokens += tokenTotal(entry.usage.cacheRead) + tokenTotal(entry.usage.cacheWrite);
  }
  return total;
}

export function runtimeTokenUsageMagnitude(usage: RuntimeTokenUsage): number {
  return tokenTotal(usage.input) +
    tokenTotal(usage.output) +
    tokenTotal(usage.cacheRead) +
    tokenTotal(usage.cacheWrite);
}

export function tokenTotal(value: number | undefined): number {
  return Math.max(0, Math.round(value || 0));
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
