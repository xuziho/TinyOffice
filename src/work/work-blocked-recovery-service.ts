import type { ProcessTraceEvent } from "../runtime/contracts/process-trace-event.js";
import type { EmployeeHome } from "../runtime/registry/employee-home.js";
import type { WorkRunExecutionDetail } from "./work-service.js";
import { WorkExecutionService, type WorkExecutionStartResult } from "./work-execution-service.js";
import { WorkService } from "./work-service.js";

export interface WorkBlockedParticipantMessage {
  workRunId: string;
  workTaskId: string;
  assigneeMemberId: string;
  title: string;
  message: string;
}

export class WorkBlockedRecoveryService {
  constructor(private readonly input: {
    workService: WorkService;
    workExecutionService: WorkExecutionService;
  }) {}

  async buildParticipantMessage(workRunId: string): Promise<WorkBlockedParticipantMessage> {
    const detail = await this.requireBlockedWorkRun(workRunId);
    const latestBlock = [...detail.events]
      .reverse()
      .find((entry) => entry.eventType === "blocked");
    const reason = detail.run.blockedReason || latestBlock?.summary || "The assignee needs outside input.";
    return {
      workRunId: detail.run.id,
      workTaskId: detail.task.id,
      assigneeMemberId: detail.run.assigneeMemberId,
      title: `WorkRun blocked: ${detail.task.title}`,
      message: [
        `WorkRun ${detail.run.id} is blocked.`,
        `WorkTask: ${detail.task.id} - ${detail.task.title}`,
        `Assignee: ${detail.run.assigneeMemberId}`,
        `Reason: ${reason}`,
        "Please reply with the missing information or direction. The reply will be returned to the original work_run_execution session. Sensitive access must be decided on its Access card.",
      ].join("\n"),
    };
  }

  async resumeFromParticipantReply(input: {
    employee: EmployeeHome;
    workRunId: string;
    participantMessage: string;
    preferredLanguage?: string;
    onProcessEvent?: (event: Omit<ProcessTraceEvent, "id" | "timestamp">) => void | Promise<void>;
  }): Promise<WorkExecutionStartResult> {
    await this.requireBlockedWorkRun(input.workRunId);
    return this.input.workExecutionService.continueWorkRunExecution(input);
  }

  private async requireBlockedWorkRun(workRunId: string): Promise<WorkRunExecutionDetail> {
    const detail = await this.input.workService.getWorkRunExecutionDetail(workRunId);
    if (!detail) {
      throw new Error(`WorkRun not found: ${workRunId}`);
    }
    if (detail.run.status !== "blocked") {
      throw new Error(`WorkRun ${workRunId} is not blocked.`);
    }
    return detail;
  }
}
