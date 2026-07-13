import { randomUUID } from "node:crypto";

import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
  type CompanyPostgresOpenOptions,
} from "../runtime/company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../runtime/company-config/company-paths.js";
import { PostgresWorkDispatchLeaseRepository } from "./postgres-work-dispatch-lease-repository.js";

export type WorkDispatchLeaseStatus =
  | "pending"
  | "acknowledged"
  | "failed"
  | "canceled";

export interface WorkDispatchLeaseRecord {
  id: string;
  workRunId: string;
  assigneeMemberId: string;
  sessionKey: string;
  status: WorkDispatchLeaseStatus;
  dispatchedAt: string;
  expiresAt: string;
  acknowledgedAt?: string;
  failedAt?: string;
  canceledAt?: string;
  failureReason?: string;
  retryOfLeaseId?: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
}

export interface WorkDispatchLeaseRepositoryLike {
  createLease(input: Omit<WorkDispatchLeaseRecord, "status"> & {
    status?: WorkDispatchLeaseStatus;
  }): WorkDispatchLeaseRecord;
  getLease(leaseId: string): WorkDispatchLeaseRecord | undefined;
  getLatestLeaseForWorkRun(workRunId: string): WorkDispatchLeaseRecord | undefined;
  listLeases(input?: {
    workRunId?: string;
    status?: WorkDispatchLeaseStatus;
    expiredBefore?: string;
  }): WorkDispatchLeaseRecord[];
  updateLease(input: {
    leaseId: string;
    status: WorkDispatchLeaseStatus;
    acknowledgedAt?: string;
    failedAt?: string;
    canceledAt?: string;
    failureReason?: string;
  }): WorkDispatchLeaseRecord;
  save(): Promise<void>;
  close(): void;
}

export type WorkDispatchLeaseRepositoryOpenOptions = CompanyPostgresOpenOptions & { companyId?: string };

export class WorkDispatchLeaseRepository {
  static async open(
    repoRoot: string,
    options: WorkDispatchLeaseRepositoryOpenOptions = {},
  ): Promise<WorkDispatchLeaseRepositoryLike> {
    const companyId = normalizeCompanyId(options.companyId);
    const postgres = await openConfiguredPostgresConnection(repoRoot, options);
    if (!postgres) {
      throw new Error("Work dispatch lease storage requires PostgreSQL runtime configuration.");
    }
    try {
      return await PostgresWorkDispatchLeaseRepository.open({ ...postgres, companyId });
    } catch (error) {
      postgres.client.release();
      await endCompanyPostgresPool(postgres.pool);
      throw error;
    }
  }
}

export interface WorkDispatchLeaseServiceConfig {
  repoRoot: string;
  companyId: string;
  now?: () => string;
  createId?: (prefix: string) => string;
  leaseTtlMs?: number;
}

function defaultCreateId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export class WorkDispatchLeaseService {
  private readonly now: () => string;
  private readonly createId: (prefix: string) => string;
  private readonly leaseTtlMs: number;

  constructor(private readonly config: WorkDispatchLeaseServiceConfig) {
    this.now = config.now || (() => new Date().toISOString());
    this.createId = config.createId || defaultCreateId;
    this.leaseTtlMs = config.leaseTtlMs ?? 120000;
  }

  async createPendingLease(input: {
    workRunId: string;
    assigneeMemberId: string;
    sessionKey: string;
    createdBy: string;
    retryOfLeaseId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<WorkDispatchLeaseRecord> {
    const timestamp = this.now();
    const expiresAt = new Date(Date.parse(timestamp) + this.leaseTtlMs).toISOString();
    const repository = await WorkDispatchLeaseRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const latest = repository.getLatestLeaseForWorkRun(input.workRunId);
      if (latest?.status === "pending") {
        throw new Error(`WorkRun ${input.workRunId} already has a pending dispatch lease.`);
      }
      const lease = repository.createLease({
        id: this.createId("work-dispatch"),
        workRunId: input.workRunId,
        assigneeMemberId: input.assigneeMemberId,
        sessionKey: input.sessionKey,
        dispatchedAt: timestamp,
        expiresAt,
        retryOfLeaseId: input.retryOfLeaseId,
        createdBy: input.createdBy,
        metadata: input.metadata,
      });
      await repository.save();
      return lease;
    } finally {
      repository.close();
    }
  }

  async acknowledgeWorkRunStart(input: {
    workRunId: string;
    assigneeMemberId: string;
  }): Promise<WorkDispatchLeaseRecord | undefined> {
    const repository = await WorkDispatchLeaseRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const latest = repository.getLatestLeaseForWorkRun(input.workRunId);
      if (!latest || latest.status !== "pending" || latest.assigneeMemberId !== input.assigneeMemberId) {
        return undefined;
      }
      const updated = repository.updateLease({
        leaseId: latest.id,
        status: "acknowledged",
        acknowledgedAt: this.now(),
      });
      await repository.save();
      return updated;
    } finally {
      repository.close();
    }
  }

  async markExpiredPendingLeasesFailed(input: {
    reason?: string;
  } = {}): Promise<WorkDispatchLeaseRecord[]> {
    const repository = await WorkDispatchLeaseRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const timestamp = this.now();
      const expired = repository.listLeases({
        status: "pending",
        expiredBefore: timestamp,
      });
      const updated = expired.map((lease) =>
        repository.updateLease({
          leaseId: lease.id,
          status: "failed",
          failedAt: timestamp,
          failureReason: input.reason || "Agent did not start the WorkRun before the dispatch lease expired.",
        })
      );
      await repository.save();
      return updated;
    } finally {
      repository.close();
    }
  }

  async failPendingLease(input: {
    workRunId: string;
    reason: string;
  }): Promise<WorkDispatchLeaseRecord | undefined> {
    const repository = await WorkDispatchLeaseRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const latest = repository.getLatestLeaseForWorkRun(input.workRunId);
      if (!latest || latest.status !== "pending") {
        return undefined;
      }
      const updated = repository.updateLease({
        leaseId: latest.id,
        status: "failed",
        failedAt: this.now(),
        failureReason: input.reason,
      });
      await repository.save();
      return updated;
    } finally {
      repository.close();
    }
  }

  async cancelLatestLease(input: {
    workRunId: string;
    reason: string;
  }): Promise<WorkDispatchLeaseRecord | undefined> {
    const repository = await WorkDispatchLeaseRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const latest = repository.getLatestLeaseForWorkRun(input.workRunId);
      if (!latest || (latest.status !== "pending" && latest.status !== "acknowledged")) {
        return undefined;
      }
      const updated = repository.updateLease({
        leaseId: latest.id,
        status: "canceled",
        canceledAt: this.now(),
        failureReason: input.reason,
      });
      await repository.save();
      return updated;
    } finally {
      repository.close();
    }
  }

  async getLatestLeaseForWorkRun(workRunId: string): Promise<WorkDispatchLeaseRecord | undefined> {
    const repository = await WorkDispatchLeaseRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      return repository.getLatestLeaseForWorkRun(workRunId);
    } finally {
      repository.close();
    }
  }
}
