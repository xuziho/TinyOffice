import type {
  AccessRequestsViewModel,
  PreviewAccessDecisionRequest,
  ResolveAccessRequestRequest,
  ResolveAccessRequestResult,
  SaveAccessPolicyRequest,
  ToolSafetyDecisionPreview,
  ToolSafetyViewModel,
} from "tinyoffice/frontend-api-contracts";
import { companyAccessPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export async function getAccessPolicy(input: { companyId?: string }): Promise<ToolSafetyViewModel> {
  return requestJson<ToolSafetyViewModel>(companyAccessPath(required(input.companyId, "companyId")));
}

export async function saveAccessPolicy(input: SaveAccessPolicyRequest): Promise<ToolSafetyViewModel> {
  const companyId = required(input.companyId, "companyId");
  return requestJson<ToolSafetyViewModel>(companyAccessPath(companyId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId,
      policy: input.policy,
    }),
  });
}

export async function previewAccessDecision(input: PreviewAccessDecisionRequest): Promise<ToolSafetyDecisionPreview> {
  const companyId = required(input.companyId, "companyId");
  return requestJson<ToolSafetyDecisionPreview>(`${companyAccessPath(companyId)}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId,
      policy: input.policy,
      operation: input.operation,
      ...(input.targetPath ? { targetPath: input.targetPath } : {}),
      ...(input.command ? { command: input.command } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
    }),
  });
}

export async function getAccessRequests(input: { companyId?: string }): Promise<AccessRequestsViewModel> {
  const companyId = required(input.companyId, "companyId");
  return requestJson<AccessRequestsViewModel>(`${companyAccessPath(companyId)}/requests`);
}

export async function resolveAccessRequest(input: ResolveAccessRequestRequest): Promise<ResolveAccessRequestResult> {
  const companyId = required(input.companyId, "companyId");
  return requestJson<ResolveAccessRequestResult>(`${companyAccessPath(companyId)}/requests/${encodeURIComponent(input.approvalId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId,
      decision: input.decision,
      ...(input.note ? { note: input.note } : {}),
      ...(input.resolvedByMemberId ? { resolvedByMemberId: input.resolvedByMemberId } : {}),
    }),
  });
}
