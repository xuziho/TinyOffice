import type { Approval, ApprovalGrant } from "./approval.js";
import type { EmployeePolicy } from "./employee-policy.js";

export interface GovernanceState {
  approvals: Approval[];
  approvalGrants: ApprovalGrant[];
  employeePolicies: EmployeePolicy[];
}

export function createEmptyGovernanceState(): GovernanceState {
  return {
    approvals: [],
    approvalGrants: [],
    employeePolicies: [],
  };
}
