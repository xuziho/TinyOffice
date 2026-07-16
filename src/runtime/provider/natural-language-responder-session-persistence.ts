import {
  RuntimeSessionRepository,
  type RuntimeSessionRepositoryLike,
} from "../storage/runtime-session-repository.js";
import type { RuntimeTokenUsage } from "./contracts.js";
import {
  collectRuntimeModelCallUsage,
  runtimeUsageTotals,
  tokenTotal as normalizedTokenTotal,
} from "../usage/runtime-token-usage.js";
import type {
  RuntimeSessionEventInput,
  RuntimeSessionPersistResult,
  RuntimeSessionRecordInput,
} from "./natural-language-responder-contracts.js";
import { logicalRuntimeSessionToolCounts } from "../storage/runtime-session-tool-counts.js";

export async function persistNaturalLanguageRuntimeSessionSnapshot(
  repoRoot: string,
  companyId: string,
  record: RuntimeSessionRecordInput,
  events: RuntimeSessionEventInput[],
  options: {
    beforeSave?: () => Promise<void>;
    authoritativeUsage?: {
      modelCallId: string;
      turnId?: string;
      usage: RuntimeTokenUsage;
    };
  } = {},
): Promise<RuntimeSessionPersistResult> {
  const maxSaveAttempts = 20;
  for (let attempt = 0; attempt < maxSaveAttempts; attempt += 1) {
    const repository = await RuntimeSessionRepository.open(repoRoot, { companyId });
    try {
      const persisted = await persistNaturalLanguageRuntimeSessionSnapshotIntoRepository(repository, record, events, {
        authoritativeUsage: options.authoritativeUsage,
      });
      await options.beforeSave?.();
      await repository.save();
      return persisted;
    } catch (error) {
      if (attempt < maxSaveAttempts - 1 && isStaleRuntimeStoreSave(error)) {
        await waitForRetryTurn();
        continue;
      }
      throw error;
    } finally {
      repository.close();
    }
  }
  throw new Error("Runtime session snapshot persistence exhausted all retry attempts.");
}

export async function persistNaturalLanguageRuntimeSessionSnapshotIntoRepository(
  repository: RuntimeSessionRepositoryLike,
  record: RuntimeSessionRecordInput,
  events: RuntimeSessionEventInput[],
  options: {
    authoritativeUsage?: {
      modelCallId: string;
      turnId?: string;
      usage: RuntimeTokenUsage;
    };
  } = {},
): Promise<RuntimeSessionPersistResult> {
  const existingRecord = repository.getSessionRecord(record.id);
  const existingEvents = repository.listSessionEvents(record.id);
  const existingEventIds = new Set(existingEvents.map((event) => event.id));
  let nextSequence = existingEvents.reduce(
    (max, event) => Math.max(max, event.sequence),
    0,
  );
  const generatedEventIds = new Set(existingEventIds);
  const eventsToAppend: RuntimeSessionEventInput[] = [];
  for (const event of events) {
    const existingWithSameId = existingEvents.find((existingEvent) => existingEvent.id === event.id);
    if (existingWithSameId) {
      if (
        isSameRuntimeSessionEvent(existingWithSameId, event) ||
        isSameRuntimeSessionEventBoundary(existingWithSameId, event)
      ) {
        continue;
      }
    }
    if (existingEvents.some((existingEvent) => isSameRuntimeSessionEventBoundary(existingEvent, event))) {
      continue;
    }
    nextSequence += 1;
    const eventId = generatedEventIds.has(event.id)
      ? nextAvailableRuntimeSessionEventId(record.id, generatedEventIds, nextSequence)
      : event.id;
    generatedEventIds.add(eventId);
    eventsToAppend.push({
      ...event,
      id: eventId,
      sequence: nextSequence,
    });
  }
  const persistedRecord: RuntimeSessionRecordInput = {
    ...record,
    runtimeMetadata: record.runtimeMetadata ?? existingRecord?.runtimeMetadata,
    startedAt: existingRecord?.startedAt || record.startedAt,
    workRunId: record.workRunId ?? existingRecord?.workRunId ??
      inferWorkRunIdFromSessionKey(record.sceneType, record.sessionKey),
    eventCount: existingEvents.length + eventsToAppend.length,
    userMessageCount: existingEvents.filter(isUserVisibleUserMessageEvent).length +
      eventsToAppend.filter(isUserVisibleUserMessageEvent).length,
    assistantMessageCount: existingEvents.filter(isUserVisibleAssistantMessageEvent).length +
      eventsToAppend.filter(isUserVisibleAssistantMessageEvent).length,
    ...logicalRuntimeSessionToolCounts([...existingEvents, ...eventsToAppend]),
    byteSize: existingEvents.reduce((total, event) => total + (event.byteSize || 0), 0) +
      eventsToAppend.reduce((total, event) => total + (event.byteSize || 0), 0),
    ...runtimeSessionTokenTotals({
      existingRecord,
      events: [...existingEvents, ...eventsToAppend],
      fallbackRecord: record,
      authoritativeUsage: options.authoritativeUsage,
    }),
    truncated: existingEvents.some((event) => event.truncated) ||
      eventsToAppend.some((event) => event.truncated),
  };
  repository.upsertSessionRecord(persistedRecord);
  for (const event of eventsToAppend) {
    repository.appendSessionEvent(event);
  }
  return {
    record: persistedRecord,
    appendedEventCount: eventsToAppend.length,
  };
}

function nextAvailableRuntimeSessionEventId(
  sessionRecordId: string,
  generatedEventIds: Set<string>,
  startingSequence: number,
) {
  let candidateSequence = startingSequence;
  let candidate = `${sessionRecordId}-event-${String(candidateSequence).padStart(6, "0")}`;
  while (generatedEventIds.has(candidate)) {
    candidateSequence += 1;
    candidate = `${sessionRecordId}-event-${String(candidateSequence).padStart(6, "0")}`;
  }
  return candidate;
}

function isStaleRuntimeStoreSave(error: unknown) {
  return error instanceof Error && /Runtime store changed after this handle was opened/.test(error.message);
}

function waitForRetryTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

function inferWorkRunIdFromSessionKey(sceneType: string, sessionKey: string): string | undefined {
  if (sceneType !== "work_run_execution") {
    return undefined;
  }
  const [, , workRunId] = sessionKey.split("|");
  return workRunId?.trim() || undefined;
}

function isUserVisibleUserMessageEvent(event: {
  role?: string;
  visibility?: string;
  semanticRole?: string;
}): boolean {
  if (event.visibility || event.semanticRole) {
    return event.visibility === "user_visible" &&
      (event.semanticRole === "user_message" || event.semanticRole === "user_visible_message");
  }
  return event.role === "user";
}

function isUserVisibleAssistantMessageEvent(event: {
  role?: string;
  visibility?: string;
  semanticRole?: string;
}): boolean {
  if (event.visibility || event.semanticRole) {
    return event.visibility === "user_visible" && event.semanticRole === "assistant_visible_message";
  }
  return event.role === "assistant";
}

function isSameRuntimeSessionEvent(
  existing: {
    timestamp: string;
    kind: string;
    role?: string;
    title?: string;
    summary?: string;
    preview?: string;
  },
  incoming: {
    timestamp: string;
    kind: string;
    role?: string;
    title?: string;
    summary?: string;
    preview?: string;
  },
) {
  return existing.timestamp === incoming.timestamp &&
    existing.kind === incoming.kind &&
    (existing.role || "") === (incoming.role || "") &&
    (existing.title || "") === (incoming.title || "") &&
    (existing.summary || "") === (incoming.summary || "") &&
    (existing.preview || "") === (incoming.preview || "");
}

function isSameRuntimeSessionEventBoundary(
  existing: {
    sceneId?: string;
    turnId?: string;
    runId?: string;
    modelCallId?: string;
    source?: string;
    visibility?: string;
    semanticRole?: string;
    rawEventKind?: string;
    kind: string;
    payload?: Record<string, unknown>;
  },
  incoming: {
    sceneId?: string;
    turnId?: string;
    runId?: string;
    modelCallId?: string;
    source?: string;
    visibility?: string;
    semanticRole?: string;
    rawEventKind?: string;
    kind: string;
    payload?: Record<string, unknown>;
  },
) {
  const existingBoundary = getRuntimeSessionEventBoundary(existing);
  const incomingBoundary = getRuntimeSessionEventBoundary(incoming);
  return !!existingBoundary && existingBoundary === incomingBoundary;
}

function getRuntimeSessionEventBoundary(event: {
  sceneId?: string;
  turnId?: string;
  runId?: string;
  modelCallId?: string;
  source?: string;
  visibility?: string;
  semanticRole?: string;
  rawEventKind?: string;
  kind: string;
  payload?: Record<string, unknown>;
}) {
  const sceneId = event.sceneId || stringFromPayload(event.payload, "sceneId");
  const turnId = event.turnId || stringFromPayload(event.payload, "turnId");
  const runId = event.runId || stringFromPayload(event.payload, "runId");
  const modelCallId = event.modelCallId || stringFromPayload(event.payload, "modelCallId");
  const source = event.source || stringFromPayload(event.payload, "source");
  const visibility = event.visibility || stringFromPayload(event.payload, "visibility");
  const semanticRole = event.semanticRole || stringFromPayload(event.payload, "semanticRole");
  const rawEventKind = event.rawEventKind || stringFromPayload(event.payload, "rawEventKind") || event.kind;

  if (!turnId && !runId && !modelCallId) {
    return undefined;
  }

  return [
    sceneId || "",
    turnId || "",
    runId || "",
    modelCallId || "",
    source || "",
    visibility || "",
    semanticRole || "",
    rawEventKind,
  ].join("\u001f");
}

function stringFromPayload(payload: Record<string, unknown> | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
}

export function tokenTotal(value: number | undefined): number | undefined {
  return value === undefined ? undefined : normalizedTokenTotal(value);
}

export function cacheTokenTotal(usage: RuntimeTokenUsage | undefined): number | undefined {
  if (!usage) {
    return undefined;
  }
  const cacheRead = tokenTotal(usage.cacheRead) || 0;
  const cacheWrite = tokenTotal(usage.cacheWrite) || 0;
  return cacheRead + cacheWrite;
}

function runtimeSessionTokenTotals(input: {
  existingRecord?: RuntimeSessionRecordInput;
  fallbackRecord: RuntimeSessionRecordInput;
  authoritativeUsage?: {
    modelCallId: string;
    turnId?: string;
    usage: RuntimeTokenUsage;
  };
  events: Array<{
    id: string;
    kind: string;
    role?: string;
    modelCallId?: string;
    title?: string;
    summary?: string;
    preview?: string;
    payload?: Record<string, unknown>;
  }>;
}): Pick<RuntimeSessionRecordInput, "tokenInputTotal" | "tokenOutputTotal" | "tokenCacheTotal"> {
  const usages = collectRuntimeModelCallUsage(input.events, input.authoritativeUsage);
  if (usages.length === 0) {
    return {
      tokenInputTotal: input.fallbackRecord.tokenInputTotal ?? input.existingRecord?.tokenInputTotal,
      tokenOutputTotal: input.fallbackRecord.tokenOutputTotal ?? input.existingRecord?.tokenOutputTotal,
      tokenCacheTotal: input.fallbackRecord.tokenCacheTotal ?? input.existingRecord?.tokenCacheTotal,
    };
  }
  const total = runtimeUsageTotals(usages);
  return {
    tokenInputTotal: total.inputTokens,
    tokenOutputTotal: total.outputTokens,
    tokenCacheTotal: total.cacheTokens,
  };
}
