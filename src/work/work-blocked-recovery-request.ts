import {
  openConfiguredPostgresConnection,
  releaseCompanyPostgresConnection,
  type CompanyPostgresClient,
  type CompanyPostgresOpenOptions,
  type CompanyPostgresPoolLike,
} from "../runtime/company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../runtime/company-config/company-paths.js";

export type WorkBlockedRecoveryRequestStatus = "open" | "resolved" | "canceled";

export interface WorkBlockedRecoveryRequestRecord {
  id: string;
  companyId: string;
  workRunId: string;
  workTaskId: string;
  assigneeMemberId: string;
  requesterMemberId: string;
  conversationId: string;
  status: WorkBlockedRecoveryRequestStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  canceledAt?: string;
}

export interface WorkBlockedRecoveryRequestRepositoryLike {
  getOpenByWorkRunId(companyId: string, workRunId: string): Promise<WorkBlockedRecoveryRequestRecord | undefined>;
  getOpenByConversationId(companyId: string, conversationId: string): Promise<WorkBlockedRecoveryRequestRecord | undefined>;
  getByWorkRunId(companyId: string, workRunId: string): Promise<WorkBlockedRecoveryRequestRecord | undefined>;
  upsert(record: WorkBlockedRecoveryRequestRecord): Promise<WorkBlockedRecoveryRequestRecord>;
  resolve(companyId: string, workRunId: string, timestamp: string): Promise<WorkBlockedRecoveryRequestRecord | undefined>;
  cancel(companyId: string, workRunId: string, timestamp: string): Promise<WorkBlockedRecoveryRequestRecord | undefined>;
}

export class WorkBlockedRecoveryRequestRepository implements WorkBlockedRecoveryRequestRepositoryLike {
  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
    private readonly companyId: string,
  ) {}

  static async open(
    repoRoot: string,
    options: CompanyPostgresOpenOptions & { companyId: string },
  ): Promise<WorkBlockedRecoveryRequestRepository> {
    const companyId = normalizeCompanyId(options.companyId);
    const postgres = await openConfiguredPostgresConnection(repoRoot, options);
    if (!postgres) {
      throw new Error("Work blocked recovery request storage requires PostgreSQL runtime configuration.");
    }
    return new WorkBlockedRecoveryRequestRepository(postgres.client, postgres.pool, companyId);
  }

  close(): void {
    releaseCompanyPostgresConnection({ client: this.client, pool: this.pool });
  }

  async getOpenByWorkRunId(companyId: string, workRunId: string): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    return this.getOne(
      "SELECT * FROM work_blocked_recovery_requests WHERE company_id = $1 AND work_run_id = $2 AND status = 'open'",
      [this.scopeCompany(companyId), workRunId],
    );
  }

  async getOpenByConversationId(companyId: string, conversationId: string): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    return this.getOne(
      "SELECT * FROM work_blocked_recovery_requests WHERE company_id = $1 AND conversation_id = $2 AND status = 'open'",
      [this.scopeCompany(companyId), conversationId],
    );
  }

  async getByWorkRunId(companyId: string, workRunId: string): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    return this.getOne(
      "SELECT * FROM work_blocked_recovery_requests WHERE company_id = $1 AND work_run_id = $2",
      [this.scopeCompany(companyId), workRunId],
    );
  }

  async upsert(record: WorkBlockedRecoveryRequestRecord): Promise<WorkBlockedRecoveryRequestRecord> {
    const scopedCompanyId = this.scopeCompany(record.companyId);
    const result = await this.client.query(
      `
INSERT INTO work_blocked_recovery_requests (
  company_id, id, work_run_id, work_task_id, assignee_member_id, requester_member_id,
  conversation_id, status, created_at, updated_at, resolved_at, canceled_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
ON CONFLICT (company_id, work_run_id) DO UPDATE SET
  work_task_id = EXCLUDED.work_task_id,
  assignee_member_id = EXCLUDED.assignee_member_id,
  requester_member_id = EXCLUDED.requester_member_id,
  conversation_id = EXCLUDED.conversation_id,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at,
  resolved_at = EXCLUDED.resolved_at,
  canceled_at = EXCLUDED.canceled_at
RETURNING *
`,
      [
        scopedCompanyId,
        record.id,
        record.workRunId,
        record.workTaskId,
        record.assigneeMemberId,
        record.requesterMemberId,
        record.conversationId,
        record.status,
        record.createdAt,
        record.updatedAt,
        record.resolvedAt ?? null,
        record.canceledAt ?? null,
      ],
    );
    return requestFromRow(result.rows[0]);
  }

  async resolve(companyId: string, workRunId: string, timestamp: string): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    return this.updateStatus(companyId, workRunId, "resolved", timestamp);
  }

  async cancel(companyId: string, workRunId: string, timestamp: string): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    return this.updateStatus(companyId, workRunId, "canceled", timestamp);
  }

  private async updateStatus(
    companyId: string,
    workRunId: string,
    status: "resolved" | "canceled",
    timestamp: string,
  ): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    const resolvedAt = status === "resolved" ? timestamp : null;
    const canceledAt = status === "canceled" ? timestamp : null;
    const result = await this.client.query(
      `
UPDATE work_blocked_recovery_requests
SET status = $3,
    updated_at = $4,
    resolved_at = COALESCE($5, resolved_at),
    canceled_at = COALESCE($6, canceled_at)
WHERE company_id = $1 AND work_run_id = $2
RETURNING *
`,
      [this.scopeCompany(companyId), workRunId, status, timestamp, resolvedAt, canceledAt],
    );
    return result.rows[0] ? requestFromRow(result.rows[0]) : undefined;
  }

  private async getOne(sql: string, params: unknown[]): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    const result = await this.client.query(sql, params);
    return result.rows[0] ? requestFromRow(result.rows[0]) : undefined;
  }

  private scopeCompany(companyId: string): string {
    const scopedCompanyId = normalizeCompanyId(companyId);
    if (scopedCompanyId !== this.companyId) {
      throw new Error(`Work blocked recovery request company mismatch: ${scopedCompanyId}`);
    }
    return scopedCompanyId;
  }
}

function requestFromRow(row: Record<string, unknown>): WorkBlockedRecoveryRequestRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    workRunId: String(row.work_run_id),
    workTaskId: String(row.work_task_id),
    assigneeMemberId: String(row.assignee_member_id),
    requesterMemberId: String(row.requester_member_id),
    conversationId: String(row.conversation_id),
    status: String(row.status) as WorkBlockedRecoveryRequestStatus,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    resolvedAt: optionalTimestamp(row.resolved_at),
    canceledAt: optionalTimestamp(row.canceled_at),
  };
}

function timestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return String(value);
}

function optionalTimestamp(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  return timestamp(value);
}

export class InMemoryWorkBlockedRecoveryRequestRepository implements WorkBlockedRecoveryRequestRepositoryLike {
  private readonly records = new Map<string, WorkBlockedRecoveryRequestRecord>();

  async getOpenByWorkRunId(companyId: string, workRunId: string): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    const record = await this.getByWorkRunId(companyId, workRunId);
    return record?.status === "open" ? { ...record } : undefined;
  }

  async getOpenByConversationId(companyId: string, conversationId: string): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    for (const record of this.records.values()) {
      if (record.companyId === companyId && record.conversationId === conversationId && record.status === "open") {
        return { ...record };
      }
    }
    return undefined;
  }

  async getByWorkRunId(companyId: string, workRunId: string): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    const record = this.records.get(key(companyId, workRunId));
    return record ? { ...record } : undefined;
  }

  async upsert(record: WorkBlockedRecoveryRequestRecord): Promise<WorkBlockedRecoveryRequestRecord> {
    this.records.set(key(record.companyId, record.workRunId), { ...record });
    return { ...record };
  }

  async resolve(companyId: string, workRunId: string, timestamp: string): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    const record = await this.getByWorkRunId(companyId, workRunId);
    if (!record) {
      return undefined;
    }
    const updated: WorkBlockedRecoveryRequestRecord = {
      ...record,
      status: "resolved",
      updatedAt: timestamp,
      resolvedAt: timestamp,
    };
    this.records.set(key(companyId, workRunId), updated);
    return { ...updated };
  }

  async cancel(companyId: string, workRunId: string, timestamp: string): Promise<WorkBlockedRecoveryRequestRecord | undefined> {
    const record = await this.getByWorkRunId(companyId, workRunId);
    if (!record) {
      return undefined;
    }
    const updated: WorkBlockedRecoveryRequestRecord = {
      ...record,
      status: "canceled",
      updatedAt: timestamp,
      canceledAt: timestamp,
    };
    this.records.set(key(companyId, workRunId), updated);
    return { ...updated };
  }
}

export async function cancelOpenWorkBlockedRecoveryRequests(input: {
  repoRoot: string;
  companyId: string;
  workRunIds: string[];
  timestamp?: string;
}): Promise<void> {
  if (input.workRunIds.length === 0) {
    return;
  }
  const repository = await WorkBlockedRecoveryRequestRepository.open(input.repoRoot, {
    companyId: input.companyId,
  });
  try {
    const timestamp = input.timestamp || new Date().toISOString();
    for (const workRunId of [...new Set(input.workRunIds)]) {
      if (await repository.getOpenByWorkRunId(input.companyId, workRunId)) {
        await repository.cancel(input.companyId, workRunId, timestamp);
      }
    }
  } finally {
    repository.close();
  }
}

function key(companyId: string, workRunId: string): string {
  return `${companyId}:${workRunId}`;
}
