import type { ProcessTraceEvent } from "../runtime/contracts/process-trace-event.js";
import type { RuntimePromptContextBlockInput } from "../runtime/prompting/prompt-compiler.js";
import {
  WORK_RUN_ACTIVE_TOOL_NAMES as RUNTIME_WORK_RUN_ACTIVE_TOOL_NAMES,
} from "../runtime/provider/runtime-tool-contracts.js";
import type { EmployeeHome } from "../runtime/registry/employee-home.js";
import type { NaturalLanguageResponseInput } from "../runtime/provider/natural-language-responder.js";
import { RuntimeSessionRepository } from "../runtime/storage/runtime-session-repository.js";
import type { WorkRunEventRecord } from "./domain.js";
import { workRunResultFromProcessEvents, type WorkRunResult } from "./finish-work-turn-result.js";
import { buildWorkRunExecutionSessionKey } from "./work-dispatcher.js";
import { WorkService, type WorkRunExecutionDetail } from "./work-service.js";

export interface WorkExecutionStartResult {
  workTaskId: string;
  workRunId: string;
  sessionKey: string;
  reply: string;
}

export interface WorkExecutionResponderInput {
  employee: EmployeeHome;
  message: string;
  contextBlocks?: RuntimePromptContextBlockInput[];
  activeToolNames?: string[];
  sessionKey: string;
  threadId: string;
  repoRoot?: string;
  preferredLanguage?: string;
  onProcessEvent?: (event: Omit<ProcessTraceEvent, "id" | "timestamp">) => void | Promise<void>;
  runtimeProvider?: NaturalLanguageResponseInput["runtimeProvider"];
}

export type WorkExecutionResponder = (
  input: WorkExecutionResponderInput,
) => Promise<string>;

type WorkExecutionProcessEvent = Omit<ProcessTraceEvent, "id" | "timestamp"> &
  Partial<Pick<ProcessTraceEvent, "timestamp">>;

export const WORK_RUN_ACTIVE_TOOL_NAMES = RUNTIME_WORK_RUN_ACTIVE_TOOL_NAMES;

export class WorkExecutionService {
  constructor(private readonly input: {
    workService: WorkService;
    repoRoot?: string;
    companyId?: string;
    autoContinue?: {
      maxTurns?: number;
    };
    blockedRecovery?: {
      openRecoveryForBlockedRun(input: { workRunId: string }): Promise<unknown>;
    };
    runtimeProvider?: NaturalLanguageResponseInput["runtimeProvider"];
    responder?: WorkExecutionResponder;
  }) {}

  async startWorkRunExecution(input: {
    employee: EmployeeHome;
    workRunId: string;
    preferredLanguage?: string;
    onProcessEvent?: (event: Omit<ProcessTraceEvent, "id" | "timestamp">) => void | Promise<void>;
  }): Promise<WorkExecutionStartResult> {
    const detail = await this.input.workService.getWorkRunExecutionDetail(input.workRunId);
    if (!detail) {
      throw new Error(`WorkRun not found: ${input.workRunId}`);
    }
    if (detail.run.assigneeMemberId !== input.employee.employeeId) {
      throw new Error(
        `WorkRun ${input.workRunId} is assigned to ${detail.run.assigneeMemberId}, not ${input.employee.employeeId}.`,
      );
    }

    const executionDetail = detail.run.status === "queued"
      ? await this.startQueuedWorkRun(input.employee, detail.run.id)
      : detail;
    const sessionKey = buildWorkRunExecutionSessionKey(executionDetail.run);
    const responder = this.input.responder || defaultWorkExecutionResponder;
    let reply: string;
    try {
      const turnProcessEvents: WorkExecutionProcessEvent[] = [];
      reply = await responder({
        employee: input.employee,
        message: buildWorkRunExecutionPrompt(executionDetail),
        contextBlocks: [buildWorkRunExecutionContextBlock(executionDetail)],
        activeToolNames: [...WORK_RUN_ACTIVE_TOOL_NAMES],
        runtimeProvider: this.input.runtimeProvider,
        sessionKey,
        threadId: executionDetail.run.id,
        repoRoot: this.input.repoRoot,
        preferredLanguage: input.preferredLanguage,
        onProcessEvent: (event) => this.handleWorkRunProcessEvent({
          event,
          detail: executionDetail,
          events: turnProcessEvents,
          onProcessEvent: input.onProcessEvent,
        }),
      });
      if (await this.isCanceled(executionDetail.run.id)) {
        await this.markRuntimeSessionCanceled({
          employeeId: input.employee.employeeId,
          workRunId: executionDetail.run.id,
          sessionKey,
        });
        return {
          workTaskId: executionDetail.task.id,
          workRunId: executionDetail.run.id,
          sessionKey,
          reply: "",
        };
      }
      const repairedReply = await this.applyWorkRunFinalToolResultWithRepair({
        employee: input.employee,
        workRunId: executionDetail.run.id,
        sessionKey,
        events: turnProcessEvents,
        runRepairTurn: async () => {
          const repairEvents: WorkExecutionProcessEvent[] = [];
          const repairReply = await responder({
            employee: input.employee,
            message: buildWorkRunProtocolRepairPrompt(executionDetail),
            contextBlocks: [buildWorkRunExecutionContextBlock(executionDetail)],
            activeToolNames: [...WORK_RUN_ACTIVE_TOOL_NAMES],
            runtimeProvider: this.input.runtimeProvider,
            sessionKey,
            threadId: executionDetail.run.id,
            repoRoot: this.input.repoRoot,
            preferredLanguage: input.preferredLanguage,
            onProcessEvent: (event) => this.handleWorkRunProcessEvent({
              event,
              detail: executionDetail,
              events: repairEvents,
              onProcessEvent: input.onProcessEvent,
            }),
          });
          return { reply: repairReply, events: repairEvents };
        },
      });
      if (repairedReply !== undefined) {
        reply = repairedReply;
      }
      const detailAfterFirstTurn = await this.input.workService.getWorkRunExecutionDetail(executionDetail.run.id);
      if (!detailAfterFirstTurn || detailAfterFirstTurn.run.status !== "in_progress") {
        return {
          workTaskId: executionDetail.task.id,
          workRunId: executionDetail.run.id,
          sessionKey,
          reply,
        };
      }
      reply = await this.autoContinueIfNeeded({
        employee: input.employee,
        workRunId: executionDetail.run.id,
        sessionKey,
        firstReply: reply,
        preferredLanguage: input.preferredLanguage,
        onProcessEvent: input.onProcessEvent,
      });
    } catch (error) {
      if (await this.isCanceled(executionDetail.run.id)) {
        await this.markRuntimeSessionCanceled({
          employeeId: input.employee.employeeId,
          workRunId: executionDetail.run.id,
          sessionKey,
        });
        return {
          workTaskId: executionDetail.task.id,
          workRunId: executionDetail.run.id,
          sessionKey,
          reply: "",
        };
      }
      await this.failActiveWorkRun({
        employee: input.employee,
        workRunId: executionDetail.run.id,
        error,
      });
      throw error;
    }

    return {
      workTaskId: executionDetail.task.id,
      workRunId: executionDetail.run.id,
      sessionKey,
      reply,
    };
  }

  async continueWorkRunExecution(input: {
    employee: EmployeeHome;
    workRunId: string;
    participantMessage: string;
    preferredLanguage?: string;
    onProcessEvent?: (event: Omit<ProcessTraceEvent, "id" | "timestamp">) => void | Promise<void>;
  }): Promise<WorkExecutionStartResult> {
    const participantMessage = input.participantMessage.trim();
    if (!participantMessage) {
      throw new Error("participantMessage is required.");
    }
    const detail = await this.input.workService.getWorkRunExecutionDetail(input.workRunId);
    if (!detail) {
      throw new Error(`WorkRun not found: ${input.workRunId}`);
    }
    if (detail.run.assigneeMemberId !== input.employee.employeeId) {
      throw new Error(
        `WorkRun ${input.workRunId} is assigned to ${detail.run.assigneeMemberId}, not ${input.employee.employeeId}.`,
      );
    }

    const sessionKey = buildWorkRunExecutionSessionKey(detail.run);
    const responder = this.input.responder || defaultWorkExecutionResponder;
    let reply: string;
    try {
      const turnProcessEvents: WorkExecutionProcessEvent[] = [];
      reply = await responder({
        employee: input.employee,
        message: buildWorkRunResumePrompt(detail, participantMessage),
        contextBlocks: [buildWorkRunResumeContextBlock(detail, participantMessage)],
        activeToolNames: [...WORK_RUN_ACTIVE_TOOL_NAMES],
        runtimeProvider: this.input.runtimeProvider,
        sessionKey,
        threadId: detail.run.id,
        repoRoot: this.input.repoRoot,
        preferredLanguage: input.preferredLanguage,
        onProcessEvent: (event) => this.handleWorkRunProcessEvent({
          event,
          detail,
          events: turnProcessEvents,
          onProcessEvent: input.onProcessEvent,
        }),
      });
      if (await this.isCanceled(detail.run.id)) {
        await this.markRuntimeSessionCanceled({
          employeeId: input.employee.employeeId,
          workRunId: detail.run.id,
          sessionKey,
        });
        reply = "";
      } else {
        const repairedReply = await this.applyWorkRunFinalToolResultWithRepair({
          employee: input.employee,
          workRunId: detail.run.id,
          sessionKey,
          events: turnProcessEvents,
          runRepairTurn: async () => {
            const repairEvents: WorkExecutionProcessEvent[] = [];
            const repairReply = await responder({
              employee: input.employee,
              message: buildWorkRunProtocolRepairPrompt(detail),
              contextBlocks: [buildWorkRunResumeContextBlock(detail, participantMessage)],
              activeToolNames: [...WORK_RUN_ACTIVE_TOOL_NAMES],
              runtimeProvider: this.input.runtimeProvider,
              sessionKey,
              threadId: detail.run.id,
              repoRoot: this.input.repoRoot,
              preferredLanguage: input.preferredLanguage,
              onProcessEvent: (event) => this.handleWorkRunProcessEvent({
                event,
                detail,
                events: repairEvents,
                onProcessEvent: input.onProcessEvent,
              }),
            });
            return { reply: repairReply, events: repairEvents };
          },
        });
        if (repairedReply !== undefined) {
          reply = repairedReply;
        }
        const detailAfterParticipantTurn = await this.input.workService.getWorkRunExecutionDetail(detail.run.id);
        if (detailAfterParticipantTurn?.run.status === "in_progress") {
          reply = await this.autoContinueIfNeeded({
            employee: input.employee,
            workRunId: detail.run.id,
            sessionKey,
            firstReply: reply,
            preferredLanguage: input.preferredLanguage,
            onProcessEvent: input.onProcessEvent,
          });
          const stableDetail = await this.input.workService.getWorkRunExecutionDetail(detail.run.id);
          if (stableDetail?.run.status === "in_progress") {
            await this.blockWorkRun({
              workRunId: detail.run.id,
              actorMemberId: input.employee.employeeId,
              reason: "Recovery continuation ended before the WorkRun reached a stable state.",
              summary: "WorkRun remains blocked because recovery did not complete or reach another terminal state.",
            });
          }
        }
      }
    } catch (error) {
      if (await this.isCanceled(detail.run.id)) {
        await this.markRuntimeSessionCanceled({
          employeeId: input.employee.employeeId,
          workRunId: detail.run.id,
          sessionKey,
        });
        reply = "";
      } else {
        throw error;
      }
    }

    return {
      workTaskId: detail.task.id,
      workRunId: detail.run.id,
      sessionKey,
      reply,
    };
  }

  private async startQueuedWorkRun(
    employee: EmployeeHome,
    workRunId: string,
  ): Promise<WorkRunExecutionDetail> {
    await this.input.workService.moveWorkRun({
      workRunId,
      actorMemberId: employee.employeeId,
      status: "in_progress",
      summary: `Dispatcher started WorkRun execution for ${employee.employeeId}.`,
    });
    const updated = await this.input.workService.getWorkRunExecutionDetail(workRunId);
    if (!updated) {
      throw new Error(`WorkRun not found after dispatch start: ${workRunId}`);
    }
    return updated;
  }

  private async failActiveWorkRun(input: {
    employee: EmployeeHome;
    workRunId: string;
    error: unknown;
  }): Promise<void> {
    const current = await this.input.workService.getWorkRunDetail(input.workRunId);
    if (current?.run.status !== "in_progress") {
      return;
    }
    const reason = input.error instanceof Error ? input.error.message : String(input.error);
    await this.input.workService.moveWorkRun({
      workRunId: input.workRunId,
      actorMemberId: input.employee.employeeId,
      status: "failed",
      reason,
      summary: `WorkRun execution failed: ${reason}`,
    });
  }

  private async autoContinueIfNeeded(input: {
    employee: EmployeeHome;
    workRunId: string;
    sessionKey: string;
    firstReply: string;
    preferredLanguage?: string;
    onProcessEvent?: (event: Omit<ProcessTraceEvent, "id" | "timestamp">) => void | Promise<void>;
  }): Promise<string> {
    const maxTurns = this.input.autoContinue?.maxTurns ?? 1;
    if (maxTurns <= 1) {
      return input.firstReply;
    }
    const responder = this.input.responder || defaultWorkExecutionResponder;
    let reply = input.firstReply;
    for (let turn = 1; turn < maxTurns; turn += 1) {
      const detail = await this.input.workService.getWorkRunExecutionDetail(input.workRunId);
      if (!detail || detail.run.status !== "in_progress" || !detail.task.acceptanceCriteria.trim()) {
        return reply;
      }

      await this.input.workService.recordWorkRunEvent({
        workRunId: detail.run.id,
        actorMemberId: input.employee.employeeId,
        eventType: "auto_continued",
        summary: `Runtime auto-continued WorkRun execution (${turn + 1}/${maxTurns}).`,
        metadata: {
          turn: turn + 1,
          maxTurns,
        },
      });
      const updated = await this.input.workService.getWorkRunExecutionDetail(input.workRunId);
      if (!updated) {
        throw new Error(`WorkRun not found during auto-continuation: ${input.workRunId}`);
      }

      const turnProcessEvents: WorkExecutionProcessEvent[] = [];
      reply = await responder({
        employee: input.employee,
        message: buildWorkRunAutoContinuationPrompt(updated, turn + 1, maxTurns),
        contextBlocks: [buildWorkRunAutoContinuationContextBlock(updated, turn + 1, maxTurns)],
        activeToolNames: [...WORK_RUN_ACTIVE_TOOL_NAMES],
        runtimeProvider: this.input.runtimeProvider,
        sessionKey: input.sessionKey,
        threadId: updated.run.id,
        repoRoot: this.input.repoRoot,
        preferredLanguage: input.preferredLanguage,
        onProcessEvent: (event) => this.handleWorkRunProcessEvent({
          event,
          detail: updated,
          events: turnProcessEvents,
          onProcessEvent: input.onProcessEvent,
        }),
      });
      await this.applyWorkRunFinalToolResult({
        employee: input.employee,
        workRunId: updated.run.id,
        sessionKey: input.sessionKey,
        events: turnProcessEvents,
      });
    }

    const finalDetail = await this.input.workService.getWorkRunDetail(input.workRunId);
    if (finalDetail?.run.status === "in_progress") {
      await this.blockWorkRun({
        workRunId: input.workRunId,
        actorMemberId: input.employee.employeeId,
        reason: `Runtime auto-continuation budget exhausted after ${maxTurns} turns.`,
        summary: "WorkRun blocked because the runtime auto-continuation budget was exhausted.",
      });
    }
    return reply;
  }

  private async handleWorkRunProcessEvent(input: {
    event: WorkExecutionProcessEvent;
    detail: WorkRunExecutionDetail;
    events: WorkExecutionProcessEvent[];
    onProcessEvent?: (event: Omit<ProcessTraceEvent, "id" | "timestamp">) => void | Promise<void>;
  }): Promise<void> {
    if (await this.isCanceled(input.detail.run.id)) {
      return;
    }
    const enriched = {
      ...input.event,
      workTaskId: input.event.workTaskId || input.detail.task.id,
      workRunId: input.event.workRunId || input.detail.run.id,
      metadata: {
        ...(input.event.metadata || {}),
        workTaskId: input.detail.task.id,
      },
    };
    input.events.push(enriched);
    await input.onProcessEvent?.(enriched);
  }

  private async applyWorkRunFinalToolResult(input: {
    employee: EmployeeHome;
    workRunId: string;
    sessionKey: string;
    events: WorkExecutionProcessEvent[];
  }): Promise<void> {
    if (await this.isCanceled(input.workRunId)) {
      return;
    }
    const result = workRunResultFromProcessEvents(input.events);
    await this.applyWorkRunResult({
      employee: input.employee,
      workRunId: input.workRunId,
      sessionKey: input.sessionKey,
      result,
    });
  }

  private async applyWorkRunFinalToolResultWithRepair(input: {
    employee: EmployeeHome;
    workRunId: string;
    sessionKey: string;
    events: WorkExecutionProcessEvent[];
    runRepairTurn: () => Promise<{ reply: string; events: WorkExecutionProcessEvent[] }>;
  }): Promise<string | undefined> {
    try {
      await this.applyWorkRunFinalToolResult(input);
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/finish_work_turn was not called/.test(message)) {
        throw error;
      }
      await this.input.workService.recordWorkRunEvent({
        workRunId: input.workRunId,
        actorMemberId: input.employee.employeeId,
        eventType: "protocol_repair",
        summary: "Runtime requested one repair turn because finish_work_turn was missing.",
        metadata: { sessionKey: input.sessionKey },
      });
      const repaired = await input.runRepairTurn();
      await this.applyWorkRunFinalToolResult({
        employee: input.employee,
        workRunId: input.workRunId,
        sessionKey: input.sessionKey,
        events: repaired.events,
      });
      return repaired.reply;
    }
  }

  private async isCanceled(workRunId: string): Promise<boolean> {
    return (await this.input.workService.getWorkRunDetail(workRunId))?.run.status === "canceled";
  }

  private async markRuntimeSessionCanceled(input: {
    employeeId: string;
    workRunId: string;
    sessionKey: string;
  }): Promise<void> {
    if (!this.input.repoRoot || !this.input.companyId) {
      return;
    }
    const repository = await RuntimeSessionRepository.open(this.input.repoRoot, {
      companyId: this.input.companyId,
    });
    try {
      const record = repository.listSessionRecords({
        employeeId: input.employeeId,
        sessionKey: input.sessionKey,
        workRunId: input.workRunId,
        limit: 1,
      })[0];
      if (!record || record.status === "canceled") {
        return;
      }
      repository.upsertSessionRecord({
        ...record,
        status: "canceled",
        summary: "WorkRun execution canceled; late provider output was not applied.",
        updatedAt: new Date().toISOString(),
      });
      await repository.save();
    } finally {
      repository.close();
    }
  }

  private async applyWorkRunResult(input: {
    employee: EmployeeHome;
    workRunId: string;
    sessionKey: string;
    result: WorkRunResult;
  }): Promise<void> {
    const resultEventMetadata = {
      status: input.result.status,
      summary: input.result.summary,
      evidence: input.result.evidence,
      blockerMessage: input.result.blockerMessage,
    };
    switch (input.result.status) {
      case "in_progress":
        {
          const detail = await this.input.workService.getWorkRunDetail(input.workRunId);
          if (detail?.run.status === "blocked") {
            await this.input.workService.moveWorkRun({
              workRunId: input.workRunId,
              actorMemberId: input.employee.employeeId,
              status: "in_progress",
              summary: input.result.summary || "WorkRun resumed from blocked state.",
            });
            return;
          }
        }
        await this.input.workService.recordWorkRunEvent({
          workRunId: input.workRunId,
          actorMemberId: input.employee.employeeId,
          eventType: "progress",
          summary: input.result.summary || "WorkRun is still in progress.",
          metadata: resultEventMetadata,
        });
        return;
      case "complete":
        await this.input.workService.moveWorkRun({
          workRunId: input.workRunId,
          actorMemberId: input.employee.employeeId,
          status: "done",
          summary: input.result.summary,
          evidence: input.result.evidence?.join("\n"),
        });
        return;
      case "blocked":
        await this.blockWorkRun({
          workRunId: input.workRunId,
          actorMemberId: input.employee.employeeId,
          summary: input.result.summary || input.result.blockerMessage,
          reason: input.result.blockerMessage,
        });
        return;
      case "failed":
        await this.input.workService.moveWorkRun({
          workRunId: input.workRunId,
          actorMemberId: input.employee.employeeId,
          status: "failed",
          summary: input.result.summary,
          reason: input.result.summary || "WorkRun failed.",
        });
        return;
      case "canceled":
        await this.input.workService.moveWorkRun({
          workRunId: input.workRunId,
          actorMemberId: input.employee.employeeId,
          status: "canceled",
          summary: input.result.summary,
          reason: input.result.summary || "WorkRun canceled.",
        });
        return;
    }
  }

  private async blockWorkRun(input: {
    workRunId: string;
    actorMemberId: string;
    reason: string | undefined;
    summary: string | undefined;
  }): Promise<void> {
    await this.input.workService.moveWorkRun({
      ...input,
      status: "blocked",
    });
    try {
      await this.notifyBlockedRecovery(input.workRunId);
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      await this.input.workService.moveWorkRun({
        workRunId: input.workRunId,
        actorMemberId: input.actorMemberId,
        status: "failed",
        reason: `Blocked recovery channel failed: ${failure}`,
        summary: "WorkRun failed because its recovery conversation could not be opened.",
      });
      throw error;
    }
  }

  private async notifyBlockedRecovery(workRunId: string): Promise<void> {
    if (!this.input.blockedRecovery) {
      throw new Error("WorkRun blocked recovery is not configured.");
    }
    await this.input.blockedRecovery.openRecoveryForBlockedRun({ workRunId });
  }
}

export function buildWorkRunExecutionPrompt(detail: WorkRunExecutionDetail): string {
  return [
    `Start background work_run_execution session for WorkRun ${detail.run.id}.`,
    `Title: ${detail.task.title}`,
    "Use the attached WorkRun context section for the full WorkTask, WorkRun state, recent events, and execution policy.",
  ].join("\n");
}

export function buildWorkRunProtocolRepairPrompt(detail: WorkRunExecutionDetail): string {
  return [
    `Repair the WorkRun protocol for ${detail.run.id}.`,
    "Your previous turn did not call finish_work_turn.",
    "Do not repeat completed tool work unless required. Summarize the current outcome and call finish_work_turn exactly once now.",
  ].join("\n");
}

export function buildWorkRunExecutionContextBlock(
  detail: WorkRunExecutionDetail,
): RuntimePromptContextBlockInput {
  return {
    role: "work_run_context",
    source: "work_execution.work_run_context",
    label: "WorkRun execution context",
    text: [
      "WorkRun package:",
      formatWorkRunExecutionDetail(detail),
      "",
      "Recent WorkRun events:",
      formatWorkRunEvents(detail.events),
      "",
      "Execution instructions:",
      "- This is a background work_run_execution session.",
      "- The dispatcher has already started this WorkRun.",
      "- Finish the turn by calling finish_work_turn.",
      "- Return complete only after executing, self-checking the acceptance criteria, and collecting concrete evidence.",
      "- Return blocked if you need outside input, material, an external dependency, or a decision.",
      "- Sensitive resource approvals belong to Access/tool policy, not the WorkRun final-result contract.",
      "- Return failed if the WorkRun cannot be completed.",
    ].join("\n"),
  };
}

export function buildWorkRunAutoContinuationPrompt(
  detail: WorkRunExecutionDetail,
  turn: number,
  maxTurns: number,
): string {
  return [
    `Continue background work_run_execution session for WorkRun ${detail.run.id}.`,
    `Continuation turn ${turn}/${maxTurns}.`,
    "Use the attached WorkRun context section for current state, recent events, and continuation policy.",
  ].join("\n");
}

export function buildWorkRunAutoContinuationContextBlock(
  detail: WorkRunExecutionDetail,
  turn: number,
  maxTurns: number,
): RuntimePromptContextBlockInput {
  return {
    role: "work_run_context",
    source: "work_execution.work_run_context",
    label: "WorkRun auto-continuation context",
    text: [
      "WorkRun auto-continuation package:",
      formatWorkRunExecutionDetail(detail),
      "",
      "Recent WorkRun events:",
      formatWorkRunEvents(detail.events),
      "",
      "Auto-continuation instructions:",
      `- This is continuation turn ${turn} of at most ${maxTurns} for the same background work_run_execution session.`,
      "- Continue working toward acceptanceCriteria.",
      "- Finish the turn by calling finish_work_turn.",
      "- If acceptanceCriteria is satisfied, return complete with summary and concrete evidence.",
      "- If you need outside input, material, an external dependency, or a decision, return blocked with a reason.",
      "- Sensitive resource approvals belong to Access/tool policy, not the WorkRun final-result contract.",
      "- If the WorkRun cannot be completed, return failed with a reason.",
    ].join("\n"),
  };
}

export function buildWorkRunResumePrompt(
  detail: WorkRunExecutionDetail,
  participantMessage: string,
): string {
  return [
    `Resume background work_run_execution session for WorkRun ${detail.run.id}.`,
    "A participant reply was returned to this WorkRun session.",
    "Use the attached WorkRun context section for the full WorkTask, WorkRun state, recent events, participant reply, and continuation policy.",
  ].join("\n");
}

export function buildWorkRunResumeContextBlock(
  detail: WorkRunExecutionDetail,
  participantMessage: string,
): RuntimePromptContextBlockInput {
  return {
    role: "work_run_context",
    source: "work_execution.work_run_context",
    label: "WorkRun resume context",
    text: [
      "WorkRun continuation package:",
      formatWorkRunExecutionDetail(detail),
      "",
      "Recent WorkRun events:",
      formatWorkRunEvents(detail.events),
      "",
      "Participant reply:",
      participantMessage,
      "",
      "Continuation instructions:",
      "- This is the same background work_run_execution session for this WorkRun.",
      "- Finish the turn by calling finish_work_turn.",
      "- If the participant reply and available evidence satisfy acceptanceCriteria, return complete with summary and concrete evidence.",
      "- If the participant reply resolves the blocker but work still needs execution, return in_progress.",
      "- If the WorkRun should no longer continue, return canceled with a reason.",
      "- If the WorkRun cannot be completed, return failed with a reason.",
      "- If the blocker remains, return blocked with the updated reason.",
    ].join("\n"),
  };
}

function formatWorkRunExecutionDetail(detail: WorkRunExecutionDetail): string {
  return JSON.stringify({
    workTaskId: detail.task.id,
    workRunId: detail.run.id,
    taskRevision: detail.run.taskRevision,
    currentTaskRevision: detail.task.revision,
    title: detail.task.title,
    description: detail.task.description,
    status: detail.run.status,
    createdByMemberId: detail.task.createdByMemberId,
    ownerMemberId: detail.task.ownerMemberId,
    assigneeMemberId: detail.run.assigneeMemberId,
    source: {
      kind: detail.task.sourceKind,
      id: detail.task.sourceId,
      channelTopicId: detail.task.sourceChannelTopicId,
      requesterId: detail.task.requesterId,
    },
    acceptanceCriteria: detail.task.acceptanceCriteria,
    blockedReason: detail.run.blockedReason,
    failedReason: detail.run.failedReason,
    canceledReason: detail.run.canceledReason,
    scheduledFor: detail.run.scheduledFor,
    createdAt: detail.run.createdAt,
    updatedAt: detail.run.updatedAt,
  }, null, 2);
}

function formatWorkRunEvents(events: WorkRunEventRecord[]): string {
  if (events.length === 0) {
    return "- none";
  }
  return events
    .slice(-12)
    .map((entry) =>
      `- ${entry.timestamp} ${entry.actorMemberId} ${entry.eventType}: ${entry.summary}`
    )
    .join("\n");
}

async function defaultWorkExecutionResponder(input: WorkExecutionResponderInput): Promise<string> {
  const [
    { generateNaturalLanguageEmployeeReply },
    { TINYOFFICE_RUNTIME_TOOL_NAMES: allToolNames },
  ] = await Promise.all([
    import("../runtime/provider/natural-language-responder.js"),
    import("../runtime/provider/runtime-tool-contracts.js"),
  ]);
  const response = await generateNaturalLanguageEmployeeReply({
    employee: input.employee,
    message: input.message,
    contextBlocks: input.contextBlocks,
    sessionKey: input.sessionKey,
    threadId: input.threadId,
    repoRoot: input.repoRoot,
    preferredLanguage: input.preferredLanguage,
    activeToolNames: input.activeToolNames || [...allToolNames],
    runtimeProvider: input.runtimeProvider,
    enableTextDeltas: true,
    allowEmptyReply: true,
    onProcessEvent: input.onProcessEvent,
  });
  return response.message;
}
