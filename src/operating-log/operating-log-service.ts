import { randomUUID } from "node:crypto";

import type {
  OperatingEventRecord,
  OperatingEventSeverity,
} from "./domain.js";
import { OperatingLogRepository } from "./operating-log-repository.js";

export interface OperatingLogServiceConfig {
  repoRoot: string;
  companyId: string;
  now?: () => string;
  createId?: (prefix: string) => string;
}

export interface RecordOperatingEventInput {
  actorMemberId: string;
  category?: string;
  severity?: OperatingEventSeverity;
  title: string;
  message: string;
  sourceIntakeEventId?: string;
  sourceKind?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

function defaultCreateId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function requireText(value: string | undefined, fieldName: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function normalizeSeverity(value: OperatingEventSeverity | undefined): OperatingEventSeverity {
  return value || "info";
}

export class OperatingLogService {
  private readonly now: () => string;
  private readonly createId: (prefix: string) => string;

  constructor(private readonly config: OperatingLogServiceConfig) {
    this.now = config.now || (() => new Date().toISOString());
    this.createId = config.createId || defaultCreateId;
  }

  async recordEvent(input: RecordOperatingEventInput): Promise<OperatingEventRecord> {
    const timestamp = this.now();
    const repository = await OperatingLogRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const event = repository.appendEvent({
        id: this.createId("op-event"),
        timestamp,
        actorMemberId: requireText(input.actorMemberId, "actorMemberId"),
        category: input.category?.trim() || undefined,
        severity: normalizeSeverity(input.severity),
        title: requireText(input.title, "title"),
        message: requireText(input.message, "message"),
        source: {
          intakeEventId: input.sourceIntakeEventId?.trim() || undefined,
          kind: input.sourceKind?.trim() || undefined,
          id: input.sourceId?.trim() || undefined,
        },
        metadata: input.metadata,
      });
      await repository.save();
      return event;
    } finally {
      repository.close();
    }
  }

  async listEvents(input: {
    actorMemberId?: string;
    category?: string;
    severity?: OperatingEventSeverity;
    limit?: number;
  } = {}): Promise<OperatingEventRecord[]> {
    const repository = await OperatingLogRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      return repository.listEvents(input);
    } finally {
      repository.close();
    }
  }
}
