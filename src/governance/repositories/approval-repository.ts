import type { Approval, ApprovalGrant } from "../domain/approval.js";
import type { CompanyGovernanceStore } from "../storage/company-governance-store.js";

export class ApprovalRepository {
  constructor(private readonly store: CompanyGovernanceStore) {}

  async getById(approvalId: string): Promise<Approval | undefined> {
    const state = await this.store.load();
    return state.approvals.find((approval) => approval.id === approvalId);
  }

  async list(): Promise<Approval[]> {
    const state = await this.store.load();
    return state.approvals;
  }

  async listGrants(): Promise<ApprovalGrant[]> {
    const state = await this.store.load();
    return state.approvalGrants;
  }

  async save(approval: Approval): Promise<Approval> {
    return this.store.update((state) => {
      const index = state.approvals.findIndex((item) => item.id === approval.id);
      if (index >= 0) {
        state.approvals[index] = approval;
      } else {
        state.approvals.push(approval);
      }

      return approval;
    });
  }

  async saveGrant(grant: ApprovalGrant): Promise<ApprovalGrant> {
    return this.store.update((state) => {
      const index = state.approvalGrants.findIndex((item) => item.id === grant.id);
      if (index >= 0) {
        state.approvalGrants[index] = grant;
      } else {
        state.approvalGrants.push(grant);
      }

      return grant;
    });
  }

  async consumeOneTimeGrant(
    grantId: string,
    consumedAt: string,
  ): Promise<ApprovalGrant | undefined> {
    return this.store.update((state) => {
      const index = state.approvalGrants.findIndex((item) => item.id === grantId);
      if (index < 0) {
        return undefined;
      }
      const grant = state.approvalGrants[index];
      if (grant.scope !== "one_time" || grant.consumedAt) {
        return undefined;
      }

      const consumedGrant: ApprovalGrant = {
        ...grant,
        consumedAt,
      };
      state.approvalGrants[index] = consumedGrant;
      return consumedGrant;
    });
  }

  async revokeGrantsForMember(memberId: string): Promise<number> {
    return this.store.update((state) => {
      const before = state.approvalGrants.length;
      state.approvalGrants = state.approvalGrants.filter((grant) => grant.memberId !== memberId);
      return before - state.approvalGrants.length;
    });
  }
}
