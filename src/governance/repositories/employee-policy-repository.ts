import type { EmployeePolicy } from "../domain/employee-policy.js";
import type { CompanyGovernanceStore } from "../storage/company-governance-store.js";

export class EmployeePolicyRepository {
  constructor(private readonly store: CompanyGovernanceStore) {}

  async getByEmployeeId(employeeId: string): Promise<EmployeePolicy | undefined> {
    const state = await this.store.load();
    return state.employeePolicies.find((policy) => policy.employeeId === employeeId);
  }

  async list(): Promise<EmployeePolicy[]> {
    const state = await this.store.load();
    return state.employeePolicies;
  }

  async save(policy: EmployeePolicy): Promise<EmployeePolicy> {
    return this.store.update((state) => {
      const index = state.employeePolicies.findIndex(
        (item) => item.employeeId === policy.employeeId,
      );

      if (index >= 0) {
        state.employeePolicies[index] = policy;
      } else {
        state.employeePolicies.push(policy);
      }

      return policy;
    });
  }
}
