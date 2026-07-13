export type PermissionDecision = "allow" | "deny" | "require_approval";

export interface PermissionRule {
  employeeId?: string;
  role?: string;
  actionName: string;
  decision: PermissionDecision;
  reason?: string;
}
