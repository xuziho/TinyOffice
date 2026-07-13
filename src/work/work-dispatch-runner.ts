import type { ProcessTraceEvent } from "../runtime/contracts/process-trace-event.js";
import type { EmployeeHome } from "../runtime/registry/employee-home.js";
import type { WorkDispatchLeaseRecord } from "./work-dispatch-lease.js";
import type { WorkDispatchCandidate, WorkDispatcher } from "./work-dispatcher.js";
import type { WorkExecutionService, WorkExecutionStartResult } from "./work-execution-service.js";

export interface WorkDispatchRunResult {
  candidate: WorkDispatchCandidate;
  lease?: WorkDispatchLeaseRecord;
  execution: WorkExecutionStartResult;
}

export interface WorkDispatchRunnerConfig {
  dispatcher: WorkDispatcher;
  workExecutionService: WorkExecutionService;
  resolveEmployee: (employeeId: string) => Promise<EmployeeHome | undefined>;
}

export class WorkDispatchRunner {
  constructor(private readonly config: WorkDispatchRunnerConfig) {}

  async dispatchNextToWorkRunSession(input: {
    createdBy: string;
    preferredLanguage?: string;
    onProcessEvent?: (event: Omit<ProcessTraceEvent, "id" | "timestamp">) => void | Promise<void>;
  }): Promise<WorkDispatchRunResult | undefined> {
    const dispatched = await this.config.dispatcher.dispatchNext({
      createdBy: input.createdBy,
    });
    if (!dispatched) {
      return undefined;
    }

    const employee = await this.config.resolveEmployee(dispatched.candidate.assigneeMemberId);
    if (!employee) {
      const reason = `Cannot dispatch WorkRun ${dispatched.candidate.run.id}: employee ${dispatched.candidate.assigneeMemberId} was not found.`;
      await this.config.dispatcher.failPendingDispatch({
        workRunId: dispatched.candidate.run.id,
        reason,
      });
      throw new Error(reason);
    }

    const lease = dispatched.lease
      ? await this.config.dispatcher.acknowledgeDispatchedWorkRunStart({
          workRunId: dispatched.candidate.run.id,
          assigneeMemberId: dispatched.candidate.assigneeMemberId,
        }) || dispatched.lease
      : undefined;
    const execution = await this.config.workExecutionService.startWorkRunExecution({
      employee,
      workRunId: dispatched.candidate.run.id,
      preferredLanguage: input.preferredLanguage,
      onProcessEvent: input.onProcessEvent,
    });

    return {
      candidate: dispatched.candidate,
      lease,
      execution,
    };
  }
}
