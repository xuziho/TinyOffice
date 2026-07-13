import type { ActionResult } from "../../collaboration/contracts/action-result.js";
import { BASE_COLLABORATION_ACTION_NAMES } from "../../collaboration/actions/action-specs.js";
import type { EmployeeDaemonEnvelope } from "../../collaboration/runtime/startup-contract.js";
import type { ChannelTopicServices } from "../../channel-topics/services/channel-topic-service.js";
import type {
  OperatingLogActionServices,
  WorkActionServices,
} from "../../collaboration/contracts/action-execution-context.js";
import type { CompanyGovernanceServices } from "../../governance/services/company-governance-services.js";
import type { EmployeeDaemonEvent } from "../contracts/daemon-event.js";
import type { OutboundCollaborationSink } from "../contracts/outbound-collaboration-sink.js";
import {
  PersistentEmployeeDaemon,
  type PersistentEmployeeDaemonStatus,
} from "../daemon/persistent-employee-daemon.js";
import type { EmployeeHome } from "./employee-home.js";

export interface PersistentEmployeeRegistryOptions {
  employeeHomes: EmployeeHome[];
  channelTopics?: ChannelTopicServices;
  governance?: CompanyGovernanceServices;
  work?: WorkActionServices;
  operatingLog?: OperatingLogActionServices;
  createOutboundSink: (home: EmployeeHome) => OutboundCollaborationSink;
  registerActions?: (daemon: PersistentEmployeeDaemon, home: EmployeeHome) => void;
  idleTimeoutMs?: number;
}

export interface PersistentEmployeeRegistryStatusEntry {
  employeeId: string;
  started: boolean;
  workspacePath: string;
  status?: PersistentEmployeeDaemonStatus;
}

interface EmployeeDaemonRegistration {
  home: EmployeeHome;
  daemon?: PersistentEmployeeDaemon;
}

export class PersistentEmployeeRegistry {
  private readonly registrations = new Map<string, EmployeeDaemonRegistration>();

  constructor(private readonly options: PersistentEmployeeRegistryOptions) {
    for (const home of options.employeeHomes) {
      this.registrations.set(home.employeeId, { home });
    }
  }

  listEmployees(): string[] {
    return Array.from(this.registrations.keys()).sort();
  }

  getHome(employeeId: string): EmployeeHome | undefined {
    return this.registrations.get(employeeId)?.home;
  }

  async startAll(): Promise<PersistentEmployeeDaemon[]> {
    const employeeIds = this.listEmployees();
    return Promise.all(employeeIds.map((employeeId) => this.getOrStart(employeeId)));
  }

  async getOrStart(employeeId: string): Promise<PersistentEmployeeDaemon> {
    const registration = this.registrations.get(employeeId);
    if (!registration) {
      throw new Error(`Unknown employee ${employeeId}.`);
    }

    if (!registration.daemon) {
      registration.daemon = await this.createDaemon(registration.home);
    }

    await registration.daemon.start();
    return registration.daemon;
  }

  async dispatch<TInput, TOutput>(
    employeeId: string,
    event: EmployeeDaemonEvent<TInput>,
  ): Promise<ActionResult<TOutput>> {
    const daemon = await this.getOrStart(employeeId);
    return daemon.enqueue<TInput, TOutput>(event);
  }

  getStatus(employeeId: string): PersistentEmployeeRegistryStatusEntry {
    const registration = this.registrations.get(employeeId);
    if (!registration) {
      throw new Error(`Unknown employee ${employeeId}.`);
    }

    return {
      employeeId,
      started: Boolean(registration.daemon),
      workspacePath: registration.home.workspacePath,
      status: registration.daemon?.getStatus(),
    };
  }

  listStatuses(): PersistentEmployeeRegistryStatusEntry[] {
    return this.listEmployees().map((employeeId) => this.getStatus(employeeId));
  }

  async stop(employeeId: string): Promise<void> {
    const registration = this.registrations.get(employeeId);
    if (!registration?.daemon) {
      return;
    }

    await registration.daemon.stop();
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.listEmployees().map((employeeId) => this.stop(employeeId)));
  }

  async replaceHome(home: EmployeeHome): Promise<void> {
    await this.stop(home.employeeId);
    this.registrations.set(home.employeeId, { home });
  }

  private async createDaemon(home: EmployeeHome): Promise<PersistentEmployeeDaemon> {
    const daemon = new PersistentEmployeeDaemon({
      envelope: this.toEnvelope(home),
      channelTopics: this.options.channelTopics,
      governance: this.options.governance,
      work: this.options.work,
      operatingLog: this.options.operatingLog,
      outboundSink: this.options.createOutboundSink(home),
      idleTimeoutMs: this.options.idleTimeoutMs,
    });

    this.options.registerActions?.(daemon, home);
    return daemon;
  }

  private toEnvelope(home: EmployeeHome): EmployeeDaemonEnvelope {
    return {
      bootId: `runtime-registry-${home.employeeId}`,
      runtime: {
        employeeId: home.employeeId,
        role: home.profile.role,
        presenceMode: home.profile.presenceMode,
        mountedActions: [...BASE_COLLABORATION_ACTION_NAMES],
      },
    };
  }
}
