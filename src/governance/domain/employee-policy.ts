import type { PermissionRule } from "../../collaboration/policy/permission-rule.js";

export interface EmployeePolicy {
  employeeId: string;
  role: string;
  permissionRules: PermissionRule[];
  createdAt: string;
  updatedAt: string;
}
