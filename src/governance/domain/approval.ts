export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "canceled";
export type ApprovalContextKind = "dm_thread" | "channel_topic" | "work_run" | "intake_event";

export interface Approval {
  id: string;
  contextKind: ApprovalContextKind;
  contextId: string;
  sessionKey: string;
  requestedByMemberId: string;
  requestedApproverMemberId?: string;
  requestedAction: string;
  requestedResource?: string;
  requestedInputSnapshot?: unknown;
  status: ApprovalStatus;
  reason: string;
  decisionNote?: string;
  resolvedByMemberId?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface ApprovalGrant {
  id: string;
  approvalId: string;
  memberId: string;
  action: string;
  resource?: string;
  scope: "one_time" | "session" | "work_run";
  contextKind: ApprovalContextKind;
  contextId: string;
  expiresAt?: string;
  consumedAt?: string;
  createdAt: string;
}
