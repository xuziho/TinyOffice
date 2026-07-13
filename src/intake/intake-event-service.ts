import { randomUUID } from "node:crypto";

import type {
  IntakeEventInput,
  IntakeEventRecord,
  IntakeProcessingResult,
  IntakePriority,
} from "./domain.js";
import type { IntakeEventStore } from "./intake-event-store.js";

export interface IntakeEventServiceConfig {
  repoRoot: string;
  store: IntakeEventStore;
  validateTargetMemberId: (memberId: string) => boolean | Promise<boolean>;
  now?: () => string;
  createId?: (prefix: string) => string;
}

export interface IntakeEventReceipt {
  status: "processed" | "duplicate";
  eventId: string;
  category: string;
  eventType?: string;
  result?: IntakeProcessingResult;
}

const priorities = new Set<IntakePriority>(["low", "normal", "high", "urgent"]);

function defaultCreateId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requireString(value: unknown, name: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function normalizeInput(value: unknown): IntakeEventInput {
  const input = asObject(value);
  if (!input) {
    throw new Error("intake event must be an object");
  }
  const priority = input.priority;
  if (priority !== undefined && (!priorities.has(priority as IntakePriority))) {
    throw new Error("priority must be one of low, normal, high, urgent");
  }
  const routing = asObject(input.routing);
  const metadata = asObject(input.metadata);
  return {
    schemaVersion: requireString(input.schemaVersion, "schemaVersion"),
    source: requireString(input.source, "source"),
    sourceEventId: requireString(input.sourceEventId, "sourceEventId"),
    category: requireString(input.category, "category"),
    eventType: optionalString(input.eventType),
    routing: routing
      ? {
          targetMemberId: optionalString(routing.targetMemberId),
        }
      : undefined,
    priority: priority as IntakePriority | undefined,
    occurredAt: optionalString(input.occurredAt),
    summary: optionalString(input.summary),
    payload: input.payload,
    metadata,
  };
}

function idempotencyKey(input: IntakeEventInput) {
  return [
    input.category,
    input.source,
    input.sourceEventId,
  ].join("|");
}

export class IntakeEventService {
  private readonly now: () => string;
  private readonly createId: (prefix: string) => string;

  constructor(private readonly config: IntakeEventServiceConfig) {
    this.now = config.now || (() => new Date().toISOString());
    this.createId = config.createId || defaultCreateId;
  }

  close(): void {
    this.config.store.close?.();
  }

  async ingest(rawInput: unknown): Promise<IntakeEventReceipt> {
    const input = normalizeInput(rawInput);
    const key = idempotencyKey(input);
    const existingState = await this.config.store.load();
    const existing = existingState.events.find((event) => idempotencyKey(event.input) === key);
    if (existing) {
      return {
        status: "duplicate",
        eventId: existing.id,
        category: existing.input.category,
        eventType: existing.input.eventType,
        result: existing.result,
      };
    }

    const targetMemberId = requireString(
      input.routing?.targetMemberId,
      "routing.targetMemberId",
    );
    await this.validateTargetMember(targetMemberId);

    const receivedAt = this.now();
    const eventId = this.createId("intake-event");
    const result = {
      kind: "intake_event_routed",
      category: input.category,
      targetMemberId,
    };
    const record: IntakeEventRecord = {
      id: eventId,
      receivedAt,
      processedAt: this.now(),
      status: "processed",
      input,
      result,
    };

    await this.config.store.update((state) => {
      const duplicate = state.events.find((event) => idempotencyKey(event.input) === key);
      if (duplicate) {
        return;
      }
      state.events.push(record);
    });

    return {
      status: "processed",
      eventId,
      category: input.category,
      eventType: input.eventType,
      result,
    };
  }

  private async validateTargetMember(targetMemberId: string) {
    if (!(await this.config.validateTargetMemberId(targetMemberId))) {
      throw new Error(`routing.targetMemberId ${targetMemberId} is not an enabled member`);
    }
  }
}
