import {
  RuntimeSessionRepository,
  type MemorySummary,
  type RuntimeSessionRepositoryLike,
} from "../storage/runtime-session-repository.js";

export interface RecordSessionCompletionMemoryInput {
  repoRoot: string;
  companyId: string;
  sessionRecordId: string;
  now?: () => string;
}

export interface RecallRuntimeMemoriesInput {
  repoRoot: string;
  companyId: string;
  employeeId?: string;
  workRunId?: string;
  category?: string;
  limit?: number;
}

function nowIso(input?: () => string) {
  return input ? input() : new Date().toISOString();
}

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) {
    return 10;
  }
  return Math.max(1, Math.min(50, Math.floor(limit)));
}

function compactText(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

export function upsertSessionCompletionMemory(
  repository: RuntimeSessionRepositoryLike,
  input: {
    sessionRecordId: string;
    now?: () => string;
  },
): MemorySummary | undefined {
  const detail = repository.getSessionDetail(input.sessionRecordId);
  if (!detail || detail.record.status !== "completed") {
    return undefined;
  }

  const timestamp = nowIso(input.now);
  const assistantEvent = [...detail.events]
    .reverse()
    .find((event) => event.role === "assistant" || event.kind === "assistant_message");
  const summary = compactText([
    `Completed ${detail.record.sceneType} session ${detail.record.sessionKey}.`,
    assistantEvent?.summary || assistantEvent?.preview
      ? `Latest reply: ${assistantEvent.summary || assistantEvent.preview}`
      : detail.record.summary,
  ]);

  return repository.upsertMemorySummary({
    id: `memory-session-${detail.record.id}`,
    createdAt: detail.record.updatedAt || timestamp,
    updatedAt: timestamp,
    scopeKind: "session",
    scopeId: detail.record.id,
    employeeId: detail.record.employeeId,
    sourceKind: "session",
    sourceId: detail.record.id,
    category: detail.record.sceneType,
    title: detail.record.title || `${detail.record.employeeId} ${detail.record.sceneType} session`,
    summary,
    importance: 0.4,
    embeddingStatus: "not_requested",
  });
}

export async function recordSessionCompletionMemory(
  input: RecordSessionCompletionMemoryInput,
): Promise<MemorySummary | undefined> {
  const repository = await RuntimeSessionRepository.open(input.repoRoot, { companyId: input.companyId });
  try {
    const saved = upsertSessionCompletionMemory(repository, {
      sessionRecordId: input.sessionRecordId,
      now: input.now,
    });
    if (saved) {
      await repository.save();
    }
    return saved;
  } finally {
    repository.close();
  }
}

export async function recallRuntimeMemories(
  input: RecallRuntimeMemoriesInput,
): Promise<MemorySummary[]> {
  const repository = await RuntimeSessionRepository.open(input.repoRoot, { companyId: input.companyId });
  try {
    return repository.listMemorySummaries({
      employeeId: input.employeeId,
      scopeKind: input.workRunId ? "work_run" : undefined,
      scopeId: input.workRunId,
      category: input.category,
      limit: clampLimit(input.limit),
    });
  } finally {
    repository.close();
  }
}
