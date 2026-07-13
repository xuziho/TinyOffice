import { loadEmployeesAdminState, type EmployeeAdminRecord } from "../../runtime/company-config/employees-admin.js";
import { normalizeCompanyId } from "../../runtime/company-config/company-paths.js";
import type { EmployeePolicy } from "../domain/employee-policy.js";

function nowIso() {
  return new Date().toISOString();
}

function policyFromAdminEmployee(employee: EmployeeAdminRecord): EmployeePolicy {
  const timestamp = nowIso();
  return {
    employeeId: employee.employeeId,
    role: employee.profile.role,
    permissionRules: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export class AdminEmployeePolicyRepository {
  readonly readonlyPolicySource = true;

  constructor(
    private readonly repoRoot: string,
    private readonly companyId = normalizeCompanyId(process.env.TINYOFFICE_COMPANY_ID),
  ) {}

  private async loadEnabledEmployees(): Promise<EmployeeAdminRecord[]> {
    const state = await loadEmployeesAdminState({
      repoRoot: this.repoRoot,
      companyId: this.companyId,
    });
    return state.employees.filter((employee) => employee.enabled !== false);
  }

  async getByEmployeeId(employeeId: string): Promise<EmployeePolicy | undefined> {
    const employee = (await this.loadEnabledEmployees())
      .find((candidate) => candidate.employeeId === employeeId);
    return employee ? policyFromAdminEmployee(employee) : undefined;
  }

  async list(): Promise<EmployeePolicy[]> {
    return (await this.loadEnabledEmployees()).map(policyFromAdminEmployee);
  }

  async save(policy: EmployeePolicy): Promise<EmployeePolicy> {
    const existing = await this.getByEmployeeId(policy.employeeId);
    if (!existing) {
      throw new Error(
        `Cannot save governance policy for unknown employee ${policy.employeeId}; update employees admin state instead.`,
      );
    }
    return existing;
  }
}
