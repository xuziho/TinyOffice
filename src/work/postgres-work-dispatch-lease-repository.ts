import { releaseCompanyPostgresConnection } from "../runtime/company-config/postgres-runtime-connection.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresPoolLike,
} from "../runtime/company-config/postgres-runtime-connection.js";
import type {
  WorkDispatchLeaseRecord,
  WorkDispatchLeaseStatus,
} from "./work-dispatch-lease.js";

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function timestampValue(value: unknown): string {
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
  return timestampValue(value);
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

export function leaseFromRow(row: Record<string, unknown>): WorkDispatchLeaseRecord {
  return {
    id: String(row.id),
    workRunId: String(row.work_run_id),
    assigneeMemberId: String(row.assignee_member_id),
    sessionKey: String(row.session_key),
    status: String(row.status) as WorkDispatchLeaseStatus,
    dispatchedAt: timestampValue(row.dispatched_at),
    expiresAt: timestampValue(row.expires_at),
    acknowledgedAt: optionalTimestamp(row.acknowledged_at),
    failedAt: optionalTimestamp(row.failed_at),
    canceledAt: optionalTimestamp(row.canceled_at),
    failureReason: optional(row.failure_reason),
    retryOfLeaseId: optional(row.retry_of_lease_id),
    createdBy: String(row.created_by),
    metadata: jsonObject(row.metadata_json),
  };
}

function byDispatchedDesc(left: WorkDispatchLeaseRecord, right: WorkDispatchLeaseRecord) {
  return right.dispatchedAt.localeCompare(left.dispatchedAt) || right.id.localeCompare(left.id);
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = item;
  } else {
    items.push(item);
  }
}

export class PostgresWorkDispatchLeaseRepository {
  private pendingWrites: Promise<unknown> = Promise.resolve();
  private pendingWriteCount = 0;
  private closed = false;

  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
    private readonly companyId: string,
    private readonly leases: WorkDispatchLeaseRecord[],
  ) {}

  static async open(input: {
    client: CompanyPostgresClient;
    pool: CompanyPostgresPoolLike;
    companyId: string;
  }): Promise<PostgresWorkDispatchLeaseRepository> {
    const result = await input.client.query(
      "SELECT * FROM work_dispatch_leases WHERE company_id = $1 ORDER BY dispatched_at DESC, id DESC",
      [input.companyId],
    );
    return new PostgresWorkDispatchLeaseRepository(
      input.client,
      input.pool,
      input.companyId,
      result.rows.map(leaseFromRow),
    );
  }

  createLease(input: Omit<WorkDispatchLeaseRecord, "status"> & {
    status?: WorkDispatchLeaseStatus;
  }): WorkDispatchLeaseRecord {
    const lease: WorkDispatchLeaseRecord = {
      ...input,
      status: input.status || "pending",
    };
    upsertById(this.leases, lease);
    this.queueQuery(
      `INSERT INTO work_dispatch_leases (
  company_id, id, work_run_id, assignee_member_id, session_key, status, dispatched_at,
  expires_at, acknowledged_at, failed_at, canceled_at, failure_reason,
  retry_of_lease_id, created_by, metadata_json
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
ON CONFLICT (company_id, id) DO UPDATE SET
  work_run_id = EXCLUDED.work_run_id,
  assignee_member_id = EXCLUDED.assignee_member_id,
  session_key = EXCLUDED.session_key,
  status = EXCLUDED.status,
  dispatched_at = EXCLUDED.dispatched_at,
  expires_at = EXCLUDED.expires_at,
  acknowledged_at = EXCLUDED.acknowledged_at,
  failed_at = EXCLUDED.failed_at,
  canceled_at = EXCLUDED.canceled_at,
  failure_reason = EXCLUDED.failure_reason,
  retry_of_lease_id = EXCLUDED.retry_of_lease_id,
  created_by = EXCLUDED.created_by,
  metadata_json = EXCLUDED.metadata_json`,
      [
        this.companyId,
        lease.id,
        lease.workRunId,
        lease.assigneeMemberId,
        lease.sessionKey,
        lease.status,
        lease.dispatchedAt,
        lease.expiresAt,
        lease.acknowledgedAt ?? null,
        lease.failedAt ?? null,
        lease.canceledAt ?? null,
        lease.failureReason ?? null,
        lease.retryOfLeaseId ?? null,
        lease.createdBy,
        lease.metadata ?? null,
      ],
    );
    return lease;
  }

  getLease(leaseId: string): WorkDispatchLeaseRecord | undefined {
    return this.leases.find((lease) => lease.id === leaseId);
  }

  getLatestLeaseForWorkRun(workRunId: string): WorkDispatchLeaseRecord | undefined {
    return this.leases
      .filter((lease) => lease.workRunId === workRunId)
      .sort(byDispatchedDesc)[0];
  }

  listLeases(input: {
    workRunId?: string;
    status?: WorkDispatchLeaseStatus;
    expiredBefore?: string;
  } = {}): WorkDispatchLeaseRecord[] {
    return this.leases
      .filter((lease) => !input.workRunId || lease.workRunId === input.workRunId)
      .filter((lease) => !input.status || lease.status === input.status)
      .filter((lease) => !input.expiredBefore || lease.expiresAt <= input.expiredBefore)
      .sort(byDispatchedDesc);
  }

  updateLease(input: {
    leaseId: string;
    status: WorkDispatchLeaseStatus;
    acknowledgedAt?: string;
    failedAt?: string;
    canceledAt?: string;
    failureReason?: string;
  }): WorkDispatchLeaseRecord {
    const current = this.getLease(input.leaseId);
    if (!current) {
      throw new Error(`Work dispatch lease not found: ${input.leaseId}`);
    }
    const updated: WorkDispatchLeaseRecord = {
      ...current,
      status: input.status,
      acknowledgedAt: input.acknowledgedAt || current.acknowledgedAt,
      failedAt: input.failedAt || current.failedAt,
      canceledAt: input.canceledAt || current.canceledAt,
      failureReason: input.failureReason || current.failureReason,
    };
    upsertById(this.leases, updated);
    this.queueQuery(
      `UPDATE work_dispatch_leases SET
  status = $3,
  acknowledged_at = $4,
  failed_at = $5,
  canceled_at = $6,
  failure_reason = $7
WHERE company_id = $1 AND id = $2`,
      [
        this.companyId,
        updated.id,
        updated.status,
        updated.acknowledgedAt ?? null,
        updated.failedAt ?? null,
        updated.canceledAt ?? null,
        updated.failureReason ?? null,
      ],
    );
    return updated;
  }

  async save(): Promise<void> {
    await this.pendingWrites;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const release = () => releaseCompanyPostgresConnection({ client: this.client, pool: this.pool });
    if (this.pendingWriteCount === 0) {
      void release();
      return;
    }
    void this.pendingWrites
      .finally(release)
      .catch(() => undefined);
  }

  private queueQuery(sql: string, params?: readonly unknown[]) {
    this.pendingWriteCount += 1;
    this.pendingWrites = this.pendingWrites
      .then(() => this.client.query(sql, params))
      .finally(() => {
        this.pendingWriteCount -= 1;
      });
  }
}
