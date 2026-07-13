import type { ProcessTraceEvent } from "../runtime/contracts/process-trace-event.js";
import type { EmployeeHome } from "../runtime/registry/employee-home.js";
import { OperatingLogService } from "../operating-log/operating-log-service.js";
import type { OperatingEventRecord } from "../operating-log/domain.js";
import { WorkDispatchLeaseService, type WorkDispatchLeaseRecord } from "./work-dispatch-lease.js";
import { WorkDispatchRunner, type WorkDispatchRunResult } from "./work-dispatch-runner.js";
import { WorkDispatcher } from "./work-dispatcher.js";
import { WorkExecutionService } from "./work-execution-service.js";
import { WorkService } from "./work-service.js";
import type { WorkRunRecord, WorkScheduleRecord } from "./domain.js";

export interface CompanyControlPlaneConfig {
  repoRoot: string;
  companyId: string;
  now?: () => string;
  createId?: (prefix: string) => string;
  workService?: WorkService;
  leaseService?: WorkDispatchLeaseService;
  workExecutionService?: WorkExecutionService;
  operatingLogService?: OperatingLogService;
  resolveEmployee: (employeeId: string) => Promise<EmployeeHome | undefined>;
}

export interface CompanyControlPlaneTickResult {
  dueSchedules: WorkScheduleRecord[];
  createdRuns: WorkRunRecord[];
  reusedRuns: WorkRunRecord[];
  operatingEvents: OperatingEventRecord[];
}

export interface CompanyControlPlaneDispatchResult {
  result?: WorkDispatchRunResult;
  expiredLeases: WorkDispatchLeaseRecord[];
  operatingEvents: OperatingEventRecord[];
}

export class CompanyControlPlane {
  private readonly workService: WorkService;
  private readonly leaseService: WorkDispatchLeaseService;
  private readonly workExecutionService: WorkExecutionService;
  private readonly operatingLogService: OperatingLogService;

  constructor(private readonly config: CompanyControlPlaneConfig) {
    this.workService = config.workService || new WorkService({
      repoRoot: config.repoRoot,
      companyId: config.companyId,
      now: config.now,
      createId: config.createId,
    });
    this.leaseService = config.leaseService || new WorkDispatchLeaseService({
      repoRoot: config.repoRoot,
      companyId: config.companyId,
      now: config.now,
      createId: config.createId,
    });
    this.workExecutionService = config.workExecutionService || new WorkExecutionService({
      workService: this.workService,
      repoRoot: config.repoRoot,
      companyId: config.companyId,
    });
    this.operatingLogService = config.operatingLogService || new OperatingLogService({
      repoRoot: config.repoRoot,
      companyId: config.companyId,
      now: config.now,
      createId: config.createId,
    });
  }

  async tickDueSchedules(input: {
    createdBy: string;
    limit?: number;
  }): Promise<CompanyControlPlaneTickResult> {
    const dueSchedules = await this.workService.listDueWorkSchedules({ limit: input.limit });
    const createdRuns: WorkRunRecord[] = [];
    const reusedRuns: WorkRunRecord[] = [];
    const operatingEvents: OperatingEventRecord[] = [];

    for (const schedule of dueSchedules) {
      const result = await this.workService.createDueWorkRun({
        workScheduleId: schedule.id,
        actorMemberId: input.createdBy,
      });
      if (result.created) {
        createdRuns.push(result.run);
        operatingEvents.push(await this.operatingLogService.recordEvent({
          actorMemberId: input.createdBy,
          category: "work",
          severity: "info",
          title: "WorkRun queued from WorkSchedule",
          message: `Queued WorkRun ${result.run.id} for WorkTask ${result.task.id}.`,
          sourceKind: "work_schedule",
          sourceId: schedule.id,
          metadata: {
            workTaskId: result.task.id,
            workScheduleId: schedule.id,
            workRunId: result.run.id,
          },
        }));
      } else {
        reusedRuns.push(result.run);
      }
    }

    return {
      dueSchedules,
      createdRuns,
      reusedRuns,
      operatingEvents,
    };
  }

  async dispatchNext(input: {
    createdBy: string;
    preferredLanguage?: string;
    onProcessEvent?: (event: Omit<ProcessTraceEvent, "id" | "timestamp">) => void | Promise<void>;
  }): Promise<CompanyControlPlaneDispatchResult> {
    const operatingEvents: OperatingEventRecord[] = [];
    const expiredLeases = await this.leaseService.markExpiredPendingLeasesFailed({
      reason: "Company Control Plane recovered an expired pending dispatch lease.",
    });
    if (expiredLeases.length > 0) {
      operatingEvents.push(await this.operatingLogService.recordEvent({
        actorMemberId: input.createdBy,
        category: "work",
        severity: "warning",
        title: "Expired WorkRun dispatch leases recovered",
        message: `Recovered ${expiredLeases.length} expired pending dispatch lease(s).`,
        sourceKind: "work_dispatch_leases",
        sourceId: expiredLeases[0]?.workRunId,
        metadata: {
          leaseIds: expiredLeases.map((lease) => lease.id),
        },
      }));
    }

    const runner = new WorkDispatchRunner({
      dispatcher: new WorkDispatcher(this.workService, this.leaseService),
      workExecutionService: this.workExecutionService,
      resolveEmployee: this.config.resolveEmployee,
    });
    const result = await runner.dispatchNextToWorkRunSession({
      createdBy: input.createdBy,
      preferredLanguage: input.preferredLanguage,
      onProcessEvent: input.onProcessEvent,
    });
    if (result) {
      operatingEvents.push(await this.operatingLogService.recordEvent({
        actorMemberId: input.createdBy,
        category: "work",
        severity: "info",
        title: "WorkRun dispatched",
        message: `Dispatched WorkRun ${result.candidate.run.id} to ${result.candidate.assigneeMemberId}.`,
        sourceKind: "work_run",
        sourceId: result.candidate.run.id,
        metadata: {
          workTaskId: result.candidate.task.id,
          workRunId: result.candidate.run.id,
          leaseId: result.lease?.id,
          sessionKey: result.execution.sessionKey,
        },
      }));
    }

    return {
      result,
      expiredLeases,
      operatingEvents,
    };
  }

  async runOnce(input: {
    createdBy: string;
    scheduleLimit?: number;
    preferredLanguage?: string;
    onProcessEvent?: (event: Omit<ProcessTraceEvent, "id" | "timestamp">) => void | Promise<void>;
  }): Promise<{
    tick: CompanyControlPlaneTickResult;
    dispatch: CompanyControlPlaneDispatchResult;
  }> {
    const tick = await this.tickDueSchedules({
      createdBy: input.createdBy,
      limit: input.scheduleLimit,
    });
    const dispatch = await this.dispatchNext({
      createdBy: input.createdBy,
      preferredLanguage: input.preferredLanguage,
      onProcessEvent: input.onProcessEvent,
    });
    return { tick, dispatch };
  }
}
