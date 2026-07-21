import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import {
  appendProcessTraceEventBatch,
  queryProcessTraceEvents,
  type ProcessTraceStoreQuery,
} from "../storage/postgres-process-trace-store.js";

export type ProcessTraceQuery = ProcessTraceStoreQuery;

export type ProcessTraceSubscriber = (event: ProcessTraceEvent) => void;

export interface ProcessTraceWriterSnapshot {
  queued: number;
  inFlight: number;
  persisted: number;
  failed: number;
}

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
  const conversationId = event.conversationId || metadataString(event.metadata, "conversationId");
  const messageId = event.messageId || metadataString(event.metadata, "messageId");
  const chatEntryId = event.chatEntryId || metadataString(event.metadata, "chatEntryId");
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
  const metadata = event.metadata
    ? sanitizeValue(event.metadata) as Record<string, unknown>
    : undefined;
  const metadataNumber = (key: string): number | undefined => {
    const value = metadata?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  return {
    ...event,
    id: event.id || createEventId(event),
    timestamp: event.timestamp || nowIso(),
    runId: event.runId || metadataString(metadata, "runId") || metadataString(metadata, "eventKey"),
    sequenceInRun: event.sequenceInRun ?? metadataNumber("sequenceInRun"),
    conversationId: event.conversationId || metadataString(metadata, "conversationId"),
    messageId: event.messageId || metadataString(metadata, "messageId"),
    sourceMessageId: event.sourceMessageId || metadataString(metadata, "sourceMessageId"),
    chatEntryId: event.chatEntryId || metadataString(metadata, "chatEntryId"),
    title: redactString(event.title),
    summary: event.summary ? redactString(event.summary) : undefined,
    preview: event.preview ? redactString(event.preview) : undefined,
    metadata,
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
  await options.beforeSave?.();
  await appendProcessTraceEventBatch(repoRoot, companyId, [normalized]);
  return normalized;
}

export async function listProcessTraceEvents(
  repoRoot: string,
  companyId: string,
  query: ProcessTraceQuery = {},
): Promise<ProcessTraceEvent[]> {
  return queryProcessTraceEvents(repoRoot, companyId, query);
}

const PROCESS_TRACE_BATCH_DELAY_MS = 100;
const PROCESS_TRACE_BATCH_SIZE = 50;
const PROCESS_TRACE_QUEUE_CAPACITY = 1000;
const PROCESS_TRACE_PERSIST_ATTEMPTS = 3;
const sharedProcessTraceWriters = new Map<string, ProcessTraceEvidenceWriter>();

type QueuedProcessTraceEvent = {
  event: ProcessTraceEvent;
  resolve(): void;
  reject(error: unknown): void;
};

class ProcessTraceEvidenceWriter {
  private readonly queue: QueuedProcessTraceEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushChain = Promise.resolve();
  private inFlight = 0;
  private persisted = 0;
  private failed = 0;

  constructor(
    private readonly repoRoot: string,
    private readonly companyId: string,
  ) {}

  enqueue(event: ProcessTraceEvent): Promise<void> {
    if (this.queue.length >= PROCESS_TRACE_QUEUE_CAPACITY) {
      this.failed += 1;
      return Promise.reject(new Error(
        `Process Trace evidence queue reached ${PROCESS_TRACE_QUEUE_CAPACITY} events for ${this.companyId}.`,
      ));
    }
    const persisted = new Promise<void>((resolve, reject) => {
      this.queue.push({ event, resolve, reject });
    });
    if (this.queue.length >= PROCESS_TRACE_BATCH_SIZE) {
      this.scheduleFlush(0);
    } else if (!this.flushTimer) {
      this.scheduleFlush(PROCESS_TRACE_BATCH_DELAY_MS);
    }
    return persisted;
  }

  snapshot(): ProcessTraceWriterSnapshot {
    return {
      queued: this.queue.length,
      inFlight: this.inFlight,
      persisted: this.persisted,
      failed: this.failed,
    };
  }

  async drain(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    while (this.queue.length > 0) {
      this.queueFlush();
      await this.flushChain;
    }
    await this.flushChain;
  }

  private scheduleFlush(delayMs: number) {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.queueFlush();
    }, delayMs);
    this.flushTimer.unref?.();
  }

  private queueFlush() {
    if (this.queue.length === 0) {
      return;
    }
    const batch = this.queue.splice(0, PROCESS_TRACE_BATCH_SIZE);
    this.flushChain = this.flushChain
      .catch(() => undefined)
      .then(async () => {
        this.inFlight += batch.length;
        try {
          await this.persistBatch(batch);
          this.persisted += batch.length;
          for (const item of batch) {
            item.resolve();
          }
        } catch (error) {
          this.failed += batch.length;
          for (const item of batch) {
            item.reject(error);
          }
        } finally {
          this.inFlight -= batch.length;
          if (this.queue.length > 0) {
            this.scheduleFlush(this.queue.length >= PROCESS_TRACE_BATCH_SIZE ? 0 : PROCESS_TRACE_BATCH_DELAY_MS);
          }
        }
      });
  }

  private async persistBatch(batch: QueuedProcessTraceEvent[]): Promise<void> {
    let latestError: unknown;
    for (let attempt = 1; attempt <= PROCESS_TRACE_PERSIST_ATTEMPTS; attempt += 1) {
      try {
        await appendProcessTraceEventBatch(this.repoRoot, this.companyId, batch.map((item) => item.event));
        return;
      } catch (error) {
        latestError = error;
        if (attempt < PROCESS_TRACE_PERSIST_ATTEMPTS) {
          await new Promise<void>((resolve) => setTimeout(resolve, attempt * 25));
        }
      }
    }
    throw latestError;
  }
}

function processTraceWriter(repoRoot: string, companyId: string): ProcessTraceEvidenceWriter {
  const key = `${repoRoot}\0${companyId}`;
  let writer = sharedProcessTraceWriters.get(key);
  if (!writer) {
    writer = new ProcessTraceEvidenceWriter(repoRoot, companyId);
    sharedProcessTraceWriters.set(key, writer);
  }
  return writer;
}

export async function drainProcessTraceWriters(repoRoot?: string): Promise<void> {
  const writers = [...sharedProcessTraceWriters.entries()]
    .filter(([key]) => !repoRoot || key.startsWith(`${repoRoot}\0`))
    .map(([, writer]) => writer);
  await Promise.all(writers.map((writer) => writer.drain()));
}

export class ProcessTracePublisher {
  private readonly subscribers = new Map<string, Set<ProcessTraceSubscriber>>();

  constructor(
    private readonly repoRoot: string,
    private readonly companyId: string,
    private readonly options: {
      onPersisted?(event: ProcessTraceEvent): void;
      onPersistenceError?(event: ProcessTraceEvent, error: unknown): void;
    } = {},
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
    const normalized = normalizeProcessTraceEvent(event);
    const subscribers = [
      ...(this.subscribers.get(normalized.sessionKey) || []),
      ...(this.subscribers.get("*") || []),
    ];
    if (subscribers.length > 0) {
      for (const subscriber of subscribers) {
        subscriber(normalized);
      }
    }
    void processTraceWriter(this.repoRoot, this.companyId).enqueue(normalized)
      .then(() => this.options.onPersisted?.(normalized))
      .catch((error) => {
        this.options.onPersistenceError?.(normalized, error);
        process.emitWarning(
          `Process Trace evidence persistence failed for ${normalized.id}: ${error instanceof Error ? error.message : String(error)}`,
          { code: "TINYOFFICE_PROCESS_TRACE_PERSISTENCE_FAILED" },
        );
      });
    return normalized;
  }

  drain(): Promise<void> {
    return processTraceWriter(this.repoRoot, this.companyId).drain();
  }

  writerSnapshot(): ProcessTraceWriterSnapshot {
    return processTraceWriter(this.repoRoot, this.companyId).snapshot();
  }
}
