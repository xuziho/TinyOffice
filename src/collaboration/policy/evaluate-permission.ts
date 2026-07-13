import type { PermissionRule } from "./permission-rule.js";
import type { EmployeeRuntimeConfig } from "../runtime/startup-contract.js";

export function evaluatePermission(
  rules: PermissionRule[],
  runtime: EmployeeRuntimeConfig,
  actionName: string,
): PermissionRule {
  const matchingRule =
    rules.find(
      (rule) =>
        rule.actionName === actionName &&
        rule.employeeId === runtime.employeeId,
    ) ??
    rules.find(
      (rule) =>
        rule.actionName === actionName &&
        rule.role === runtime.role,
    ) ??
    rules.find(
      (rule) =>
        rule.actionName === actionName &&
        rule.employeeId == null &&
        rule.role == null,
    );

  return (
    matchingRule ?? {
      actionName,
      decision: "deny",
      reason: `No permission rule matched for ${actionName}.`,
    }
  );
}
