import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import { RuntimeSessionRepository } from "../storage/runtime-session-repository.js";

export interface ProcessTraceQuery {
  processTraceId?: string;
  sessionKey?: string;
  channelTopicId?: string;
  conversationId?: string;
  messageId?: string;
  sourceMessageId?: string;
  chatEntryId?: string;
  workTaskId?: string;
  workRunId?: string;
  employeeId?: string;
  since?: string;
  limit?: number;
}

export type ProcessTraceSubscriber = (event: ProcessTraceEvent) => void;

export type ProcessTraceRuntimeLinkKind =
  | "process-trace"
  | "work-task"
  | "work-run"
  | "conversation"
  | "message"
  | "chat-entry";

export interface ProcessTraceRuntimeLink {
  kind: ProcessTraceRuntimeLinkKind;
  targetId: string;
  href: string;
  label: string;
  processTraceId?: string;
  workTaskId?: string;
  workRunId?: string;
  conversationId?: string;
  messageId?: string;
  chatEntryId?: string;
}

export interface ProcessTraceNavigationEvent extends ProcessTraceEvent {
  processTraceId: string;
  conversationId?: string;
  messageId?: string;
  chatEntryId?: string;
  runtimeLinks: ProcessTraceRuntimeLink[];
}

const processTraceWriteQueues = new Map<string, Promise<unknown>>();
const maxStaleSaveAttempts = 20;

function nowIso() {
  return new Date().toISOString();
}

function createEventId(event: Omit<ProcessTraceEvent, "id" | "timestamp">) {
  const nonce = Math.random().toString(36).slice(2, 10);
  const metadata = event.metadata || {};
  const stable = [
    nonce,
    event.sessionKey,
    metadata.conversationId || metadata.messageId || metadata.chatEntryId || "",
    event.channelTopicId || "",
    event.employeeId || "",
    event.kind,
  ].join(":");
  return `ptrace-${Date.now()}-${Buffer.from(stable).toString("base64url").slice(0, 16)}`;
}

function redactString(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer <redacted>")
    .slice(0, 2000);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 25).map(sanitizeValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    if (/token|secret|password|api[_-]?key|authorization/i.test(key)) {
      output[key] = "<redacted>";
      continue;
    }
    output[key] = sanitizeValue(item);
  }
  return output;
}

function metadataString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const item = value?.[key];
  return typeof item === "string" && item.trim() ? item.trim() : undefined;
}

function dedupeRuntimeLinks(links: ProcessTraceRuntimeLink[]): ProcessTraceRuntimeLink[] {
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

export function projectProcessTraceNavigationEvent(event: ProcessTraceEvent): ProcessTraceNavigationEvent {
  const processTraceId = event.id;
  const conversationId = metadataString(event.metadata, "conversationId");
  const messageId = metadataString(event.metadata, "messageId");
  const chatEntryId = metadataString(event.metadata, "chatEntryId");
  const runtimeLinks: ProcessTraceRuntimeLink[] = [{
    kind: "process-trace",
    targetId: processTraceId,
    href: `/api/process-trace?processTraceId=${encodeURIComponent(processTraceId)}`,
    label: `Process Trace ${processTraceId}`,
    processTraceId,
  }];
  if (event.workTaskId) {
    runtimeLinks.push({
      kind: "work-task",
      targetId: event.workTaskId,
      href: `/app/tasks?workTaskId=${encodeURIComponent(event.workTaskId)}`,
      label: `WorkTask ${event.workTaskId}`,
      processTraceId,
      workTaskId: event.workTaskId,
    });
  }
  if (event.workRunId && event.workTaskId) {
    runtimeLinks.push({
      kind: "work-run",
      targetId: event.workRunId,
      href: `/app/tasks?workTaskId=${encodeURIComponent(event.workTaskId)}`,
      label: `WorkRun ${event.workRunId}`,
      processTraceId,
      workTaskId: event.workTaskId,
      workRunId: event.workRunId,
    });
  }
  if (conversationId && messageId) {
    runtimeLinks.push({
      kind: "message",
      targetId: messageId,
      href: `/app/tasks/source/chat-message/${encodeURIComponent(`${conversationId}:${messageId}`)}`,
      label: `Message ${messageId}`,
      processTraceId,
      conversationId,
      messageId,
      chatEntryId,
    });
  } else if (conversationId) {
    runtimeLinks.push({
      kind: "conversation",
      targetId: conversationId,
      href: `/app/tasks/source/chat-conversation/${encodeURIComponent(conversationId)}`,
      label: `Conversation ${conversationId}`,
      processTraceId,
      conversationId,
      chatEntryId,
    });
  }
  if (chatEntryId) {
    runtimeLinks.push({
      kind: "chat-entry",
      targetId: chatEntryId,
      href: `/app/tasks/source/chat-entry/${encodeURIComponent(chatEntryId)}`,
      label: `Chat entry ${chatEntryId}`,
      processTraceId,
      conversationId,
      messageId,
      chatEntryId,
    });
  }
  return {
    ...event,
    processTraceId,
    ...(conversationId ? { conversationId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(chatEntryId ? { chatEntryId } : {}),
    runtimeLinks: dedupeRuntimeLinks(runtimeLinks),
  };
}

export function normalizeProcessTraceEvent(
  event: Omit<ProcessTraceEvent, "id" | "timestamp"> & Partial<Pick<ProcessTraceEvent, "id" | "timestamp">>,
): ProcessTraceEvent {
  return {
    ...event,
    id: event.id || createEventId(event),
    timestamp: event.timestamp || nowIso(),
    title: redactString(event.title),
    summary: event.summary ? redactString(event.summary) : undefined,
    preview: event.preview ? redactString(event.preview) : undefined,
    metadata: event.metadata
      ? sanitizeValue(event.metadata) as Record<string, unknown>
      : undefined,
  };
}

export async function appendProcessTraceEvent(
  repoRoot: string,
  companyId: string,
  event: Omit<ProcessTraceEvent, "id" | "timestamp"> & Partial<Pick<ProcessTraceEvent, "id" | "timestamp">>,
  options: {
    beforeSave?: () => Promise<void>;
  } = {},
): Promise<ProcessTraceEvent> {
  const normalized = normalizeProcessTraceEvent(event);
  const queueKey = `${repoRoot}\0${companyId}`;
  const previous = processTraceWriteQueues.get(queueKey) || Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      for (let attempt = 0; attempt < maxStaleSaveAttempts; attempt += 1) {
        const repository = await RuntimeSessionRepository.open(repoRoot, { companyId });
        try {
          const existing = repository
            .listProcessTraceEvents({ sessionKey: normalized.sessionKey })
            .find((candidate) => candidate.id === normalized.id);
          const stored = existing || repository.appendProcessTraceEvent(normalized);
          await options.beforeSave?.();
          await repository.save();
          return stored;
        } catch (error) {
          if (attempt < maxStaleSaveAttempts - 1 && isStaleRuntimeStoreSave(error)) {
            await waitForRetryTurn();
            continue;
          }
          throw error;
        } finally {
          repository.close();
        }
      }
      throw new Error("appendProcessTraceEvent exhausted stale runtime store retries.");
    });
  const cleanup = operation.finally(() => {
    if (processTraceWriteQueues.get(queueKey) === cleanup) {
      processTraceWriteQueues.delete(queueKey);
    }
  });
  processTraceWriteQueues.set(queueKey, cleanup);
  return operation;
}

function isStaleRuntimeStoreSave(error: unknown) {
  return error instanceof Error && /Runtime store changed after this handle was opened/.test(error.message);
}

function waitForRetryTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

export async function listProcessTraceEvents(
  repoRoot: string,
  companyId: string,
  query: ProcessTraceQuery = {},
): Promise<ProcessTraceEvent[]> {
  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId });
  try {
    const events = repository.listProcessTraceEvents({
      processTraceId: query.processTraceId,
      sessionKey: query.sessionKey,
      channelTopicId: query.channelTopicId,
      conversationId: query.conversationId,
      messageId: query.messageId,
      sourceMessageId: query.sourceMessageId,
      chatEntryId: query.chatEntryId,
      workTaskId: query.workTaskId,
      workRunId: query.workRunId,
      employeeId: query.employeeId,
      since: query.since,
      limit: query.limit,
    });
    if (query.limit && events.length > query.limit) {
      return events.slice(-query.limit);
    }
    return events;
  } finally {
    repository.close();
  }
}

export class ProcessTracePublisher {
  private readonly subscribers = new Map<string, Set<ProcessTraceSubscriber>>();

  constructor(
    private readonly repoRoot: string,
    private readonly companyId: string,
  ) {}

  subscribe(sessionKey: string, subscriber: ProcessTraceSubscriber): () => void {
    const subscribers = this.subscribers.get(sessionKey) || new Set<ProcessTraceSubscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(sessionKey, subscribers);

    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        this.subscribers.delete(sessionKey);
      }
    };
  }

  async publish(
    event: Omit<ProcessTraceEvent, "id" | "timestamp"> & Partial<Pick<ProcessTraceEvent, "id" | "timestamp">>,
  ): Promise<ProcessTraceEvent> {
    const normalized = await appendProcessTraceEvent(this.repoRoot, this.companyId, event);
    const subscribers = [
      ...(this.subscribers.get(normalized.sessionKey) || []),
      ...(this.subscribers.get("*") || []),
    ];
    if (subscribers.length > 0) {
      for (const subscriber of subscribers) {
        subscriber(normalized);
      }
    }
    return normalized;
  }
}
