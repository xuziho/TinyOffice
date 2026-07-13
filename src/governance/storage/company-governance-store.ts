import type { GovernanceState } from "../domain/governance-state.js";

export interface CompanyGovernanceStore {
  load(): Promise<GovernanceState>;
  save(state: GovernanceState): Promise<void>;
  update<T>(updater: (state: GovernanceState) => Promise<T> | T): Promise<T>;
  close?(): void;
}
