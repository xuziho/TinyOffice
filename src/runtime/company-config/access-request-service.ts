import type { Approval, ApprovalGrant } from "../../governance/domain/approval.js";
import type { ApprovalRepository } from "../../governance/repositories/approval-repository.js";
import type { ApprovalService } from "../../governance/services/company-governance-services.js";
import type {
  AccessApiService,
  AccessRequestForegroundTarget,
  AccessRequestDecision,
  AccessRequestDto,
  AccessRequestsViewModel,
  AccessToolCallDecisionInput,
  AccessToolCallDecisionResult,
  ResolveAccessRequestInput,
  ResolveAccessRequestResult,
} from "../../api/tinyoffice-api/contracts.js";

export interface AccessRequestServiceOptions {
  resolveWorkRunForegroundTarget?(input: {
    companyId: string;
    workRunId: string;
  }): Promise<AccessRequestForegroundTarget | undefined>;
  resolveWorkRunStatus?(input: {
    companyId: string;
    workRunId: string;
  }): Promise<string | undefined>;
}

export class AccessRequestService implements Pick<AccessApiService, "listAccessRequests" | "resolveAccessRequest" | "decideAccessToolCall"> {
  constructor(
    private readonly approvalRepository: ApprovalRepository,
    private readonly approvalService: ApprovalService,
    private readonly options: AccessRequestServiceOptions = {},
  ) {}

  async listAccessRequests(companyId: string): Promise<AccessRequestsViewModel> {
    let approvals = await this.approvalRepository.list();
    const pendingWorkRunIds = [...new Set(approvals
      .filter((approval) => approval.status === "pending" && approval.contextKind === "work_run")
      .map((approval) => approval.contextId))];
    for (const workRunId of pendingWorkRunIds) {
      const status = await this.options.resolveWorkRunStatus?.({ companyId, workRunId });
      if (status === "done" || status === "failed" || status === "canceled") {
        await this.approvalService.cancelPendingApprovalsForContext({
          contextKind: "work_run",
          contextId: workRunId,
          reason: `WorkRun entered terminal status ${status}.`,
        });
      }
    }
    approvals = await this.approvalRepository.list();
    return {
      schema: "tinyoffice.access-requests",
      version: 1,
      companyId,
      requests: await Promise.all(
        approvals
          .filter((approval) => isAccessApproval(approval))
          .map((approval) => this.requestDto(companyId, approval)),
      ),
    };
  }

  async resolveAccessRequest(
    companyId: string,
    approvalId: string,
    input: ResolveAccessRequestInput,
  ): Promise<ResolveAccessRequestResult> {
    const result = await this.approvalService.resolveApproval(
      approvalId,
      input.decision === "reject" ? "rejected" : "approved",
      {
        resolvedByMemberId: input.resolvedByMemberId,
        decisionNote: input.note,
        grantScope: input.decision === "allow_once" ? "one_time" : "session",
      },
    );
    if (!result) {
      throw new Error(`Access request ${approvalId} was not found.`);
    }
    return {
      request: await this.requestDto(companyId, result.approval),
      ...(result.grant ? { grant: result.grant } : {}),
    };
  }

  async decideAccessToolCall(
    companyId: string,
    input: AccessToolCallDecisionInput,
  ): Promise<AccessToolCallDecisionResult> {
    const grants = await this.approvalRepository.listGrants();
    const matchingGrant = grants.find((grant) => isAccessGrantMatchingRequest(grant, {
      memberId: input.memberId,
      action: input.action,
      resource: input.resource,
      contextKind: input.contextKind,
      contextId: input.contextId,
    }));
    if (matchingGrant) {
      if (matchingGrant.scope === "one_time") {
        await this.approvalService.consumeOneTimeGrant(matchingGrant.id);
      }
      return { decision: "allow" };
    }

    const existingPendingRequest = (await this.approvalRepository.list())
      .filter((approval) => approval.status === "pending")
      .find((approval) =>
        approval.contextKind === input.contextKind &&
        approval.contextId === input.contextId &&
        approval.sessionKey === input.sessionKey &&
        approval.requestedByMemberId === input.memberId &&
        approval.requestedAction === input.action &&
        approval.requestedResource === input.resource
      );
    if (existingPendingRequest) {
      return {
        decision: "block",
        reason: `Access request ${existingPendingRequest.id} is pending.`,
        request: await this.requestDto(companyId, existingPendingRequest),
      };
    }

    const approval = await this.approvalService.createApproval({
      contextKind: input.contextKind,
      contextId: input.contextId,
      sessionKey: input.sessionKey,
      requestedByMemberId: input.memberId,
      requestedAction: input.action,
      requestedResource: input.resource,
      requestedInputSnapshot: input.requestedInputSnapshot,
      reason: input.reason,
    });

    return {
      decision: "block",
      reason: `Access request ${approval.id} is pending.`,
      request: await this.requestDto(companyId, approval),
    };
  }

  private async requestDto(companyId: string, approval: Approval): Promise<AccessRequestDto> {
    const foregroundTarget = approval.contextKind === "dm_thread"
      ? { kind: "chat-room" as const, roomId: approval.contextId, surface: "direct" as const }
      : approval.contextKind === "channel_topic"
        ? { kind: "chat-room" as const, roomId: approval.contextId, surface: "channel" as const }
        : approval.contextKind === "work_run"
          ? await this.options.resolveWorkRunForegroundTarget?.({ companyId, workRunId: approval.contextId })
          : undefined;
    return {
      ...accessRequestDto(approval),
      ...(foregroundTarget ? { foregroundTarget } : {}),
    };
  }
}

export function accessRequestDto(approval: Approval): AccessRequestDto {
  return {
    id: approval.id,
    status: approval.status,
    requestedByMemberId: approval.requestedByMemberId,
    ...(approval.requestedApproverMemberId ? { requestedApproverMemberId: approval.requestedApproverMemberId } : {}),
    requestedAction: approval.requestedAction,
    ...(approval.requestedResource ? { requestedResource: approval.requestedResource } : {}),
    ...(approval.requestedInputSnapshot === undefined ? {} : { requestedInputSnapshot: approval.requestedInputSnapshot }),
    reason: approval.reason,
    contextKind: approval.contextKind,
    contextId: approval.contextId,
    sessionKey: approval.sessionKey,
    ...(approval.decisionNote ? { decisionNote: approval.decisionNote } : {}),
    ...(approval.resolvedByMemberId ? { resolvedByMemberId: approval.resolvedByMemberId } : {}),
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
    ...(approval.resolvedAt ? { resolvedAt: approval.resolvedAt } : {}),
    actions: approval.status === "pending" ? accessRequestActions : [],
  };
}

export function isAccessGrantMatchingRequest(grant: ApprovalGrant, input: {
  memberId: string;
  action: string;
  resource?: string;
  contextKind: Approval["contextKind"];
  contextId: string;
}): boolean {
  return !grant.consumedAt &&
    grant.memberId === input.memberId &&
    grant.action === input.action &&
    grant.resource === input.resource &&
    (grant.scope === "session" || grant.scope === "one_time" || grant.scope === "work_run"
      ? grant.contextKind === input.contextKind && grant.contextId === input.contextId
      : false);
}

const accessRequestActions: AccessRequestDecision[] = ["allow_once", "allow_in_context", "reject"];

function isAccessApproval(approval: Approval): boolean {
  return approval.requestedAction.startsWith("read") ||
    approval.requestedAction.startsWith("write") ||
    approval.requestedAction.startsWith("bash") ||
    approval.requestedAction.startsWith("access.");
}
