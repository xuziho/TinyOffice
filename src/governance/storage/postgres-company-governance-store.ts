import { releaseCompanyPostgresConnection } from "../../runtime/company-config/postgres-runtime-connection.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresPoolLike,
} from "../../runtime/company-config/postgres-runtime-connection.js";
import type {
  Approval,
  ApprovalContextKind,
  ApprovalGrant,
  ApprovalStatus,
} from "../domain/approval.js";
import type { GovernanceState } from "../domain/governance-state.js";
import type { CompanyGovernanceStore } from "./company-governance-store.js";

function approvalFromRow(row: Record<string, unknown>): Approval {
  return {
    id: String(row.id),
    contextKind: String(row.context_kind) as ApprovalContextKind,
    contextId: String(row.context_id),
    sessionKey: String(row.session_key),
    requestedByMemberId: String(row.requested_by_member_id),
    requestedApproverMemberId: optionalString(row.requested_approver_member_id),
    requestedAction: String(row.requested_action),
    requestedResource: optionalString(row.requested_resource),
    requestedInputSnapshot: row.requested_input_snapshot_json,
    status: String(row.status) as ApprovalStatus,
    reason: String(row.reason),
    decisionNote: optionalString(row.decision_note),
    resolvedByMemberId: optionalString(row.resolved_by_member_id),
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
    resolvedAt: optionalTimestampString(row.resolved_at),
  };
}

function approvalGrantFromRow(row: Record<string, unknown>): ApprovalGrant {
  return {
    id: String(row.id),
    approvalId: String(row.approval_id),
    memberId: String(row.member_id),
    action: String(row.action),
    resource: optionalString(row.resource),
    scope: String(row.scope) as ApprovalGrant["scope"],
    contextKind: String(row.context_kind) as ApprovalContextKind,
    contextId: String(row.context_id),
    expiresAt: optionalTimestampString(row.expires_at),
    consumedAt: optionalTimestampString(row.consumed_at),
    createdAt: timestampString(row.created_at),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function timestampString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function optionalTimestampString(value: unknown): string | undefined {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return optionalString(value);
}

export class PostgresCompanyGovernanceStore implements CompanyGovernanceStore {
  private updateChain: Promise<unknown> = Promise.resolve();
  private pendingWrites: Promise<unknown> = Promise.resolve();
  private pendingWriteCount = 0;
  private closed = false;

  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
    private readonly companyId: string,
    private approvals: Approval[],
    private approvalGrants: ApprovalGrant[],
  ) {}

  static async open(input: {
    client: CompanyPostgresClient;
    pool: CompanyPostgresPoolLike;
    companyId: string;
  }): Promise<PostgresCompanyGovernanceStore> {
    const approvals = await input.client.query(`
SELECT *
FROM governance_approvals
WHERE company_id = $1
ORDER BY created_at ASC, id ASC
`, [input.companyId]);
    const approvalGrants = await input.client.query(`
SELECT *
FROM approval_grants
WHERE company_id = $1
ORDER BY created_at ASC, id ASC
`, [input.companyId]);
    return new PostgresCompanyGovernanceStore(
      input.client,
      input.pool,
      input.companyId,
      approvals.rows.map(approvalFromRow),
      approvalGrants.rows.map(approvalGrantFromRow),
    );
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

  async load(): Promise<GovernanceState> {
    return {
      approvals: [...this.approvals],
      approvalGrants: [...this.approvalGrants],
      employeePolicies: [],
    };
  }

  async save(state: GovernanceState): Promise<void> {
    this.approvals = [...state.approvals];
    this.approvalGrants = [...state.approvalGrants];
    this.queueQuery("DELETE FROM approval_grants WHERE company_id = $1", [this.companyId]);
    this.queueQuery("DELETE FROM governance_approvals WHERE company_id = $1", [this.companyId]);
    for (const approval of this.approvals) {
      this.queueUpsertApproval(approval);
    }
    for (const grant of this.approvalGrants) {
      this.queueUpsertApprovalGrant(grant);
    }
    await this.pendingWrites;
  }

  async update<T>(
    updater: (state: GovernanceState) => Promise<T> | T,
  ): Promise<T> {
    const run = async () => {
      const state = await this.load();
      const result = await updater(state);
      await this.save(state);
      return result;
    };
    const next = this.updateChain.then(run, run);
    this.updateChain = next.then(() => undefined, () => undefined);
    return next;
  }

  private queueUpsertApproval(approval: Approval): void {
    this.queueQuery(
      `INSERT INTO governance_approvals (
  company_id, id, context_kind, context_id, session_key, requested_by_member_id,
  requested_approver_member_id, requested_action, requested_resource,
  requested_input_snapshot_json, status, reason, decision_note,
  resolved_by_member_id, created_at, updated_at, resolved_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17)
ON CONFLICT (company_id, id) DO UPDATE SET
  context_kind = EXCLUDED.context_kind,
  context_id = EXCLUDED.context_id,
  session_key = EXCLUDED.session_key,
  requested_by_member_id = EXCLUDED.requested_by_member_id,
  requested_approver_member_id = EXCLUDED.requested_approver_member_id,
  requested_action = EXCLUDED.requested_action,
  requested_resource = EXCLUDED.requested_resource,
  requested_input_snapshot_json = EXCLUDED.requested_input_snapshot_json,
  status = EXCLUDED.status,
  reason = EXCLUDED.reason,
  decision_note = EXCLUDED.decision_note,
  resolved_by_member_id = EXCLUDED.resolved_by_member_id,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  resolved_at = EXCLUDED.resolved_at`,
      [
        this.companyId,
        approval.id,
        approval.contextKind,
        approval.contextId,
        approval.sessionKey,
        approval.requestedByMemberId,
        approval.requestedApproverMemberId ?? null,
        approval.requestedAction,
        approval.requestedResource ?? null,
        JSON.stringify(approval.requestedInputSnapshot ?? null),
        approval.status,
        approval.reason,
        approval.decisionNote ?? null,
        approval.resolvedByMemberId ?? null,
        approval.createdAt,
        approval.updatedAt,
        approval.resolvedAt ?? null,
      ],
    );
  }

  private queueUpsertApprovalGrant(grant: ApprovalGrant): void {
    this.queueQuery(
      `INSERT INTO approval_grants (
  company_id, id, approval_id, member_id, action, resource, scope, context_kind,
  context_id, expires_at, consumed_at, created_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
ON CONFLICT (company_id, id) DO UPDATE SET
  approval_id = EXCLUDED.approval_id,
  member_id = EXCLUDED.member_id,
  action = EXCLUDED.action,
  resource = EXCLUDED.resource,
  scope = EXCLUDED.scope,
  context_kind = EXCLUDED.context_kind,
  context_id = EXCLUDED.context_id,
  expires_at = EXCLUDED.expires_at,
  consumed_at = EXCLUDED.consumed_at,
  created_at = EXCLUDED.created_at`,
      [
        this.companyId,
        grant.id,
        grant.approvalId,
        grant.memberId,
        grant.action,
        grant.resource ?? null,
        grant.scope,
        grant.contextKind,
        grant.contextId,
        grant.expiresAt ?? null,
        grant.consumedAt ?? null,
        grant.createdAt,
      ],
    );
  }

  private queueQuery(sql: string, params?: readonly unknown[]): void {
    this.pendingWriteCount += 1;
    this.pendingWrites = this.pendingWrites
      .then(() => this.client.query(sql, params))
      .finally(() => {
        this.pendingWriteCount -= 1;
      });
  }
}
