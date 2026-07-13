import path from "node:path";

import type { EmployeeHome } from "../registry/employee-home.js";
import type { PiSessionTransport } from "./persistent-pi-employee-agent.js";
import { PersistentPiEmployeeAgent } from "./persistent-pi-employee-agent.js";

export class PersistentPiEmployeeAgentPool {
  private readonly agents = new Map<string, PersistentPiEmployeeAgent>();

  constructor(
    private readonly options: {
      sessionRootPath: string;
      transport?: PiSessionTransport;
      buildEnv?: (employee: EmployeeHome) => NodeJS.ProcessEnv;
      resolveSessionRootPath?: (employee: EmployeeHome) => string;
    },
  ) {}

  private getSessionKeyPath(sessionKey: string): string {
    return sessionKey.replace(/[^a-zA-Z0-9._-]+/g, "_");
  }

  getOrCreate(
    employee: EmployeeHome,
    sessionKey = "default",
  ): PersistentPiEmployeeAgent {
    const agentKey = `${employee.employeeId}|${sessionKey}`;
    const existing = this.agents.get(agentKey);
    if (existing) {
      return existing;
    }

    const sessionRootPath =
      this.options.resolveSessionRootPath?.(employee) || this.options.sessionRootPath;
    const created = new PersistentPiEmployeeAgent(employee, {
      sessionRootPath: path.join(
        sessionRootPath,
        employee.employeeId,
        this.getSessionKeyPath(sessionKey),
      ),
      sessionKey,
      transport: this.options.transport,
      env: this.options.buildEnv?.(employee),
    });
    this.agents.set(agentKey, created);
    return created;
  }

  listStatuses() {
    return Array.from(this.agents.values()).map((agent) => agent.getStatus());
  }

  async abortWhere(
    predicate: (status: ReturnType<PersistentPiEmployeeAgent["getStatus"]>) => boolean,
  ): Promise<number> {
    let abortedCount = 0;
    for (const agent of this.agents.values()) {
      const status = agent.getStatus();
      if (!predicate(status)) {
        continue;
      }

      await agent.abort();
      abortedCount += 1;
    }
    return abortedCount;
  }

  async reloadWhere(
    predicate: (status: ReturnType<PersistentPiEmployeeAgent["getStatus"]>) => boolean,
  ): Promise<{
    reloadedCount: number;
    sessionKeys: string[];
  }> {
    let reloadedCount = 0;
    const sessionKeys: string[] = [];
    for (const [agentKey, agent] of this.agents.entries()) {
      const status = agent.getStatus();
      if (!predicate(status)) {
        continue;
      }

      await agent.abort();
      this.agents.delete(agentKey);
      reloadedCount += 1;
      sessionKeys.push(status.sessionKey);
    }
    return {
      reloadedCount,
      sessionKeys,
    };
  }
}
