import { randomUUID } from "node:crypto";
import { evaluatePermission } from "../../collaboration/policy/evaluate-permission.js";
import type { PermissionRule } from "../../collaboration/policy/permission-rule.js";
import type { EmployeeRuntimeConfig } from "../../collaboration/runtime/startup-contract.js";
import type {
  Approval,
  ApprovalContextKind,
  ApprovalGrant,
} from "../domain/approval.js";
import type { EmployeePolicy } from "../domain/employee-policy.js";
import { AdminEmployeePolicyRepository } from "../repositories/admin-employee-policy-repository.js";
import { ApprovalRepository } from "../repositories/approval-repository.js";
import { EmployeePolicyRepository } from "../repositories/employee-policy-repository.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
  type CompanyPostgresOpenOptions,
} from "../../runtime/company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../../runtime/company-config/company-paths.js";
import type { CompanyGovernanceStore } from "../storage/company-governance-store.js";
import { PostgresCompanyGovernanceStore } from "../storage/postgres-company-governance-store.js";

interface EmployeePolicyRepositoryLike {
  readonly readonlyPolicySource?: boolean;
  getByEmployeeId(employeeId: string): Promise<EmployeePolicy | undefined>;
  list(): Promise<EmployeePolicy[]>;
  save(policy: EmployeePolicy): Promise<EmployeePolicy>;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeDecisionNote(note: string | undefined): string | undefined {
  const normalized = note?.trim();
  return normalized ? normalized : undefined;
}

export class EmployeePolicyService {
  constructor(private readonly repository: EmployeePolicyRepositoryLike) {}

  async ensurePolicy(
    employeeId: string,
    role: string,
    permissionRules: PermissionRule[],
  ): Promise<EmployeePolicy> {
    const existing = await this.repository.getByEmployeeId(employeeId);
    if (existing) {
      if (this.repository.readonlyPolicySource) {
        return existing;
      }
      if (
        typeof existing.role === "string" &&
        Array.isArray(existing.permissionRules) &&
        typeof existing.createdAt === "string" &&
        typeof existing.updatedAt === "string"
      ) {
        const needsPermissionRefresh =
          permissionRules.length > 0 &&
          JSON.stringify(existing.permissionRules) !== JSON.stringify(permissionRules);
        const needsRoleRefresh = existing.role !== role;
        if (!needsPermissionRefresh && !needsRoleRefresh) {
          return existing;
        }

        const refreshed: EmployeePolicy = {
          ...existing,
          role,
          permissionRules: permissionRules.length > 0
            ? permissionRules
            : existing.permissionRules,
          updatedAt: nowIso(),
        };

        await this.repository.save(refreshed);
        return refreshed;
      }

      const timestamp = nowIso();
      const repaired: EmployeePolicy = {
        employeeId,
        role: typeof existing.role === "string" ? existing.role : role,
        permissionRules: Array.isArray(existing.permissionRules)
          ? existing.permissionRules
          : permissionRules,
        createdAt:
          typeof existing.createdAt === "string" ? existing.createdAt : timestamp,
        updatedAt: timestamp,
      };

      await this.repository.save(repaired);
      return repaired;
    }

    const timestamp = nowIso();
    if (this.repository.readonlyPolicySource) {
      throw new Error(`Employee policy source has no enabled employee ${employeeId}.`);
    }
    const policy: EmployeePolicy = {
      employeeId,
      role,
      permissionRules,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.save(policy);
    return policy;
  }

  async getPolicy(employeeId: string): Promise<EmployeePolicy | undefined> {
    return this.repository.getByEmployeeId(employeeId);
  }
}

export class DurablePermissionService {
  constructor(private readonly employeePolicyService: EmployeePolicyService) {}

  async evaluate(
    runtime: EmployeeRuntimeConfig,
    actionName: string,
    fallbackRules: PermissionRule[] = [],
  ): Promise<PermissionRule> {
    const policy = await this.employeePolicyService.ensurePolicy(
      runtime.employeeId,
      runtime.role,
      fallbackRules,
    );

    return evaluatePermission(policy.permissionRules, runtime, actionName);
  }
}

export class ApprovalService {
  constructor(private readonly repository: ApprovalRepository) {}

  async createApproval(input: {
    contextKind: ApprovalContextKind;
    contextId: string;
    sessionKey: string;
    requestedByMemberId: string;
    requestedApproverMemberId?: string;
    requestedAction: string;
    requestedResource?: string;
    requestedInputSnapshot?: unknown;
    reason: string;
  }): Promise<Approval> {
    const timestamp = nowIso();
    const approval: Approval = {
      id: randomUUID(),
      contextKind: input.contextKind,
      contextId: input.contextId,
      sessionKey: input.sessionKey,
      requestedByMemberId: input.requestedByMemberId,
      requestedApproverMemberId: input.requestedApproverMemberId,
      requestedAction: input.requestedAction,
      requestedResource: input.requestedResource,
      requestedInputSnapshot: input.requestedInputSnapshot,
      status: "pending",
      reason: input.reason,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.save(approval);
    return approval;
  }

  async resolveApproval(
    approvalId: string,
    status: "approved" | "rejected",
    input: {
      resolvedByMemberId?: string;
      decisionNote?: string;
      grantScope?: ApprovalGrant["scope"];
    } = {},
  ): Promise<{ approval: Approval; grant?: ApprovalGrant } | undefined> {
    const approval = await this.repository.getById(approvalId);
    if (!approval) {
      return undefined;
    }
    const timestamp = nowIso();

    const updated: Approval = {
      ...approval,
      status,
      decisionNote: normalizeDecisionNote(input.decisionNote),
      resolvedByMemberId: input.resolvedByMemberId,
      updatedAt: timestamp,
      resolvedAt: timestamp,
    };

    await this.repository.save(updated);
    if (status !== "approved") {
      return { approval: updated };
    }
    const grant: ApprovalGrant = {
      id: randomUUID(),
      approvalId: updated.id,
      memberId: updated.requestedByMemberId,
      action: updated.requestedAction,
      resource: updated.requestedResource,
      scope: input.grantScope || (updated.contextKind === "work_run" ? "work_run" : "session"),
      contextKind: updated.contextKind,
      contextId: updated.contextId,
      createdAt: timestamp,
    };
    await this.repository.saveGrant(grant);
    return { approval: updated, grant };
  }

  async consumeOneTimeGrant(
    grantId: string,
    consumedAt = nowIso(),
  ): Promise<ApprovalGrant | undefined> {
    return this.repository.consumeOneTimeGrant(grantId, consumedAt);
  }

  async cancelPendingApprovalsForContext(input: {
    contextKind: ApprovalContextKind;
    contextId: string;
    reason: string;
  }): Promise<Approval[]> {
    const timestamp = nowIso();
    const pending = (await this.repository.list()).filter((approval) =>
      approval.status === "pending" &&
      approval.contextKind === input.contextKind &&
      approval.contextId === input.contextId
    );
    const canceled: Approval[] = [];
    for (const approval of pending) {
      const updated: Approval = {
        ...approval,
        status: "canceled",
        decisionNote: input.reason,
        updatedAt: timestamp,
        resolvedAt: timestamp,
      };
      await this.repository.save(updated);
      canceled.push(updated);
    }
    return canceled;
  }

  async cancelPendingApprovalsForMember(input: {
    memberId: string;
    reason: string;
  }): Promise<Approval[]> {
    const timestamp = nowIso();
    const pending = (await this.repository.list()).filter((approval) =>
      approval.status === "pending" && approval.requestedByMemberId === input.memberId
    );
    const canceled: Approval[] = [];
    for (const approval of pending) {
      const updated: Approval = {
        ...approval,
        status: "canceled",
        decisionNote: input.reason,
        updatedAt: timestamp,
        resolvedAt: timestamp,
      };
      await this.repository.save(updated);
      canceled.push(updated);
    }
    return canceled;
  }

  revokeGrantsForMember(memberId: string): Promise<number> {
    return this.repository.revokeGrantsForMember(memberId);
  }
}

export interface CompanyGovernanceServices {
  store: CompanyGovernanceStore;
  approvalRepository: ApprovalRepository;
  employeePolicyRepository: EmployeePolicyRepositoryLike;
  employeePolicyService: EmployeePolicyService;
  permissionService: DurablePermissionService;
  approvalService: ApprovalService;
}

function createCompanyGovernanceServicesFromStore(
  store: CompanyGovernanceStore,
  employeePolicyRepositoryOverride?: EmployeePolicyRepositoryLike,
): CompanyGovernanceServices {
  const approvalRepository = new ApprovalRepository(store);
  const employeePolicyRepository = employeePolicyRepositoryOverride ||
    new EmployeePolicyRepository(store);
  const employeePolicyService = new EmployeePolicyService(
    employeePolicyRepository,
  );
  const permissionService = new DurablePermissionService(employeePolicyService);
  const approvalService = new ApprovalService(approvalRepository);

  return {
    store,
    approvalRepository,
    employeePolicyRepository,
    employeePolicyService,
    permissionService,
    approvalService,
  };
}

export async function createDbCompanyGovernanceServices(
  repoRoot: string,
  options: CompanyPostgresOpenOptions & { companyId?: string },
): Promise<CompanyGovernanceServices> {
  const companyId = normalizeCompanyId(options.companyId);
  const postgres = await openConfiguredPostgresConnection(repoRoot, options);
  if (postgres) {
    try {
      return createCompanyGovernanceServicesFromStore(
        await PostgresCompanyGovernanceStore.open({ ...postgres, companyId }),
        new AdminEmployeePolicyRepository(repoRoot, companyId),
      );
    } catch (error) {
      postgres.client.release();
      await endCompanyPostgresPool(postgres.pool);
      throw error;
    }
  }

  throw new Error("Governance database services require PostgreSQL runtime configuration.");
}
