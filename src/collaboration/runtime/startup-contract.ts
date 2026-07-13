import type { PresenceMode } from "./presence-mode.js";

export interface EmployeeRuntimeConfig {
  employeeId: string;
  role: string;
  presenceMode: PresenceMode;
  mountedActions: string[];
}

export interface EmployeeDaemonEnvelope {
  runtime: EmployeeRuntimeConfig;
  bootId: string;
}
