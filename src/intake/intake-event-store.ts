import type { IntakeEventState } from "./domain.js";

export interface IntakeEventStore {
  load(): Promise<IntakeEventState>;
  save(state: IntakeEventState): Promise<void>;
  update<T>(updater: (state: IntakeEventState) => Promise<T> | T): Promise<T>;
  close?(): void;
}
