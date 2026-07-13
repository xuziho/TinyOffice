import type { ActionResult } from "../../collaboration/contracts/action-result.js";
import { EmployeeDaemon } from "../../collaboration/daemon/employee-daemon.js";
import type { ActionExecutionContext } from "../../collaboration/contracts/action-execution-context.js";
import type { EmployeeDaemonEnvelope } from "../../collaboration/runtime/startup-contract.js";
import type { ChannelTopicServices } from "../../channel-topics/services/channel-topic-service.js";
import type { CompanyGovernanceServices } from "../../governance/services/company-governance-services.js";
import type {
  OperatingLogActionServices,
  WorkActionServices,
} from "../../collaboration/contracts/action-execution-context.js";
import type { EmployeeDaemonEvent } from "../contracts/daemon-event.js";
import type {
  OutboundCollaborationEmission,
  OutboundCollaborationSink,
} from "../contracts/outbound-collaboration-sink.js";
import type { RehydratedRuntimeState } from "../contracts/rehydrated-runtime-state.js";

export type PersistentDaemonLifecycleStatus =
  | "stopped"
  | "resident_idle"
  | "handling_event";

export interface PersistentEmployeeDaemonStatus {
  lifecycle: PersistentDaemonLifecycleStatus;
  handledEventCount: number;
  queuedEventCount: number;
  lastStartedAt?: string;
  lastStoppedAt?: string;
  lastWakeAt?: string;
  lastHandledEventId?: string;
  lastRehydrated?: RehydratedRuntimeState;
}

export interface PersistentEmployeeDaemonOptions {
  envelope: EmployeeDaemonEnvelope;
  channelTopics?: ChannelTopicServices;
  governance?: CompanyGovernanceServices;
  work?: WorkActionServices;
  operatingLog?: OperatingLogActionServices;
  outboundSink: OutboundCollaborationSink;
  idleTimeoutMs?: number;
}

interface QueuedEvent<TInput = unknown, TOutput = unknown> {
  event: EmployeeDaemonEvent<TInput>;
  resolve: (result: ActionResult<TOutput>) => void;
  reject: (error: unknown) => void;
}

function nowIso() {
  return new Date().toISOString();
}

export class PersistentEmployeeDaemon {
  private readonly daemon: EmployeeDaemon;
  private readonly queue: Array<QueuedEvent<unknown, unknown>> = [];
  private running = false;
  private processing = false;
  private idleTimer?: NodeJS.Timeout;
  private status: PersistentEmployeeDaemonStatus = {
    lifecycle: "stopped",
    handledEventCount: 0,
    queuedEventCount: 0,
  };

  constructor(private readonly options: PersistentEmployeeDaemonOptions) {
    const executionContext: ActionExecutionContext =
      options.governance || options.channelTopics || options.work || options.operatingLog
      ? {
          governance: options.governance,
          channelTopics: options.channelTopics,
          work: options.work,
          operatingLog: options.operatingLog,
        }
      : {};

    this.daemon = new EmployeeDaemon(options.envelope, executionContext);
  }

  get runtime() {
    return this.daemon.runtime;
  }

  getStatus(): PersistentEmployeeDaemonStatus {
    return {
      ...this.status,
      lastRehydrated: this.status.lastRehydrated
        ? {
            ...this.status.lastRehydrated,
            approvals: [...this.status.lastRehydrated.approvals],
          }
        : undefined,
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.clearIdleTimer();
    this.status = {
      ...this.status,
      lifecycle: "resident_idle",
      lastStartedAt: nowIso(),
    };
    this.scheduleIdleExit();
    await this.processQueue();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearIdleTimer();
    this.status = {
      ...this.status,
      lifecycle: "stopped",
      lastStoppedAt: nowIso(),
    };
  }

  async enqueue<TInput, TOutput>(
    event: EmployeeDaemonEvent<TInput>,
  ): Promise<ActionResult<TOutput>> {
    if (!this.running) {
      throw new Error(
        `Persistent daemon ${this.options.envelope.runtime.employeeId} is not running.`,
      );
    }

    return new Promise<ActionResult<TOutput>>((resolve, reject) => {
      this.queue.push({
        event: event as EmployeeDaemonEvent<unknown>,
        resolve: resolve as (result: ActionResult<unknown>) => void,
        reject,
      });
      this.status = {
        ...this.status,
        queuedEventCount: this.queue.length,
      };
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || !this.running) {
      return;
    }

    this.processing = true;
    this.clearIdleTimer();

    try {
      while (this.running && this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) {
          break;
        }

        this.status = {
          ...this.status,
          lifecycle: "handling_event",
          queuedEventCount: this.queue.length,
          lastWakeAt: nowIso(),
          lastHandledEventId: next.event.id,
        };

        try {
          const rehydrated = await this.rehydrate(next.event);
          const result = await this.daemon.wakeAndDispatch(next.event.request);

          await this.options.outboundSink.emit({
            employeeId: this.options.envelope.runtime.employeeId,
            eventId: next.event.id,
            source: next.event.source,
            emittedAt: nowIso(),
            actionName: next.event.request.actionName,
            threadId: next.event.request.context.threadId,
            channelId: next.event.session?.channelId,
            sceneType: next.event.session?.sceneType,
            sessionKey: next.event.session?.sessionKey,
            result,
            rehydrated,
          } as OutboundCollaborationEmission<unknown>);

          this.status = {
            ...this.status,
            lifecycle: this.running ? "resident_idle" : "stopped",
            handledEventCount: this.status.handledEventCount + 1,
            lastRehydrated: rehydrated,
          };
          next.resolve(result as ActionResult<unknown>);
        } catch (error) {
          next.reject(error);
        }
      }
    } finally {
      this.processing = false;
      this.scheduleIdleExit();
    }
  }

  private async rehydrate(
    event: EmployeeDaemonEvent<unknown>,
  ): Promise<RehydratedRuntimeState> {
    if (!this.options.governance && !this.options.channelTopics) {
      return {
        approvals: [],
        rehydratedAt: nowIso(),
      };
    }

    const [channelTopic, approvals, policy] = await Promise.all([
      event.request.context.channelTopicId
        ? this.options.channelTopics?.channelTopicRepository.getById(
          event.request.context.channelTopicId,
        )
        : Promise.resolve(undefined),
      this.options.governance?.approvalRepository.list() ?? Promise.resolve([]),
      this.options.governance?.employeePolicyRepository.getByEmployeeId(
        this.options.envelope.runtime.employeeId,
      ) ?? Promise.resolve(undefined),
    ]);

    return {
      channelTopic,
      approvals: event.request.context.channelTopicId
        ? approvals.filter(
          (approval) =>
            approval.contextKind === "channel_topic" &&
            approval.contextId === event.request.context.channelTopicId,
        )
        : [],
      policy,
      rehydratedAt: nowIso(),
    };
  }

  private scheduleIdleExit(): void {
    if (
      !this.running ||
      this.options.envelope.runtime.presenceMode !== "auto_exit_idle"
    ) {
      return;
    }

    const timeoutMs = this.options.idleTimeoutMs ?? 1000;
    this.idleTimer = setTimeout(() => {
      void this.stop();
    }, timeoutMs);
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) {
      return;
    }

    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
}
