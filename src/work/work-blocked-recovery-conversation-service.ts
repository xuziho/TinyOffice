import { randomUUID } from "node:crypto";
import type {
  ConversationDto,
  MessageDto,
  SendMessageResult,
} from "../collaboration/contracts/conversation-message-contract.js";
import type {
  MessageServiceCreateConversationWithFirstMessageInput,
  MessageServiceParticipantSelector,
  MessageServiceSendMessageOptions,
} from "../collaboration/message/message-service.js";
import type { ProcessTraceEvent } from "../runtime/contracts/process-trace-event.js";
import type { EmployeeHome } from "../runtime/registry/employee-home.js";
import type { WorkBlockedParticipantMessage } from "./work-blocked-recovery-service.js";
import { WorkBlockedRecoveryService } from "./work-blocked-recovery-service.js";
import type {
  WorkBlockedRecoveryRequestRecord,
  WorkBlockedRecoveryRequestRepositoryLike,
} from "./work-blocked-recovery-request.js";
import type { WorkExecutionService, WorkExecutionStartResult } from "./work-execution-service.js";
import type { WorkService } from "./work-service.js";

export interface WorkBlockedRecoveryConversationMessageService {
  createConversationWithFirstMessage(
    companyId: string,
    input: MessageServiceCreateConversationWithFirstMessageInput,
  ): Promise<SendMessageResult>;
  getConversation(companyId: string, conversationId: string): Promise<ConversationDto | undefined>;
  sendMessage(
    companyId: string,
    conversationId: string,
    sender: MessageServiceParticipantSelector,
    body: string,
    options?: MessageServiceSendMessageOptions,
  ): Promise<SendMessageResult>;
}

export interface WorkBlockedRecoveryConversationOpened {
  request: WorkBlockedRecoveryRequestRecord;
  conversation: ConversationDto;
  firstMessage?: MessageDto;
}

export type WorkBlockedRecoveryParticipantMessageResult =
  | {
      kind: "ignored";
      reason: "no_open_recovery" | "assignee_message" | "unexpected_participant";
    }
  | {
      kind: "resumed";
      workRunId: string;
      request: WorkBlockedRecoveryRequestRecord;
      execution: WorkExecutionStartResult;
    };

export class WorkBlockedRecoveryConversationService {
  private readonly blockedRecovery: WorkBlockedRecoveryService;

  constructor(private readonly input: {
    companyId: string;
    workService: WorkService;
    workExecutionService: WorkExecutionService;
    messageService: WorkBlockedRecoveryConversationMessageService;
    recoveryRequests: WorkBlockedRecoveryRequestRepositoryLike;
    resolveEmployee(memberId: string): Promise<EmployeeHome | undefined>;
    resolveMemberDisplayName?(memberId: string): Promise<string | undefined>;
    onMessageCreated?(result: SendMessageResult): void | Promise<void>;
    createId?: (prefix: string) => string;
    now?: () => string;
    preferredLanguage?: string;
    onProcessEvent?: (event: Omit<ProcessTraceEvent, "id" | "timestamp">) => void | Promise<void>;
  }) {
    this.blockedRecovery = new WorkBlockedRecoveryService({
      workService: input.workService,
      workExecutionService: input.workExecutionService,
    });
  }

  async openRecoveryForBlockedRun(input: { workRunId: string }): Promise<WorkBlockedRecoveryConversationOpened> {
    const existing = await this.input.recoveryRequests.getByWorkRunId(this.input.companyId, input.workRunId);
    if (existing) {
      const conversation = await this.input.messageService.getConversation(this.input.companyId, existing.conversationId);
      if (!conversation) {
        throw new Error(`Blocked recovery conversation was not found: ${existing.conversationId}`);
      }
      if (existing.status === "open") {
        return { request: existing, conversation };
      }

      const participantMessage = await this.blockedRecovery.buildParticipantMessage(input.workRunId);
      const sent = await this.input.messageService.sendMessage(
        this.input.companyId,
        existing.conversationId,
        { participantKind: "company_member", memberId: participantMessage.assigneeMemberId },
        this.visibleParticipantMessage(participantMessage),
        {
          runtimeLinks: [{
            linkId: `work-blocked-recovery-message:${participantMessage.workRunId}:${this.now()}`,
            targetKind: "work_run",
            targetId: participantMessage.workRunId,
            label: "Blocked WorkRun",
          }],
        },
      );
      const timestamp = this.now();
      const reopened = await this.input.recoveryRequests.upsert({
        ...existing,
        status: "open",
        updatedAt: timestamp,
        resolvedAt: undefined,
        canceledAt: undefined,
      });
      await this.input.onMessageCreated?.(sent);
      return { request: reopened, conversation, firstMessage: sent.message };
    }

    const participantMessage = await this.blockedRecovery.buildParticipantMessage(input.workRunId);
    const requesterMemberId = await this.requesterMemberId(input.workRunId);
    const conversationResult = await this.input.messageService.createConversationWithFirstMessage(this.input.companyId, {
      conversation: {
        title: participantMessage.title,
        conversationKind: "direct",
        runtimeLinks: [{
          linkId: `work-blocked-recovery:${participantMessage.workRunId}`,
          targetKind: "work_run",
          targetId: participantMessage.workRunId,
          label: "Blocked WorkRun recovery",
        }],
        participants: [
          {
            participantKind: "company_member",
            memberId: participantMessage.assigneeMemberId,
            displayName: await this.memberDisplayName(participantMessage.assigneeMemberId),
          },
          {
            participantKind: "company_member",
            memberId: requesterMemberId,
            displayName: await this.memberDisplayName(requesterMemberId),
          },
        ],
      },
      firstMessage: {
        sender: {
          participantKind: "company_member",
          memberId: participantMessage.assigneeMemberId,
        },
        body: this.visibleParticipantMessage(participantMessage),
        runtimeLinks: [{
          linkId: `work-blocked-recovery-message:${participantMessage.workRunId}`,
          targetKind: "work_run",
          targetId: participantMessage.workRunId,
          label: "Blocked WorkRun",
        }],
      },
    });
    const timestamp = this.now();
    const request = await this.input.recoveryRequests.upsert({
      id: this.createId("work-blocked-recovery"),
      companyId: this.input.companyId,
      workRunId: participantMessage.workRunId,
      workTaskId: participantMessage.workTaskId,
      assigneeMemberId: participantMessage.assigneeMemberId,
      requesterMemberId,
      conversationId: conversationResult.conversation.conversationId,
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.input.onMessageCreated?.(conversationResult);
    return {
      request,
      conversation: conversationResult.conversation,
      firstMessage: conversationResult.message,
    };
  }

  async handleParticipantMessage(input: {
    companyId: string;
    conversationId: string;
    messageId: string;
    actorMemberId: string;
    body: string;
  }): Promise<WorkBlockedRecoveryParticipantMessageResult> {
    if (input.companyId !== this.input.companyId) {
      return { kind: "ignored", reason: "no_open_recovery" };
    }
    const request = await this.input.recoveryRequests.getOpenByConversationId(this.input.companyId, input.conversationId);
    if (!request) {
      return { kind: "ignored", reason: "no_open_recovery" };
    }
    if (input.actorMemberId === request.assigneeMemberId) {
      return { kind: "ignored", reason: "assignee_message" };
    }
    if (input.actorMemberId !== request.requesterMemberId) {
      return { kind: "ignored", reason: "unexpected_participant" };
    }
    const employee = await this.input.resolveEmployee(request.assigneeMemberId);
    if (!employee) {
      throw new Error(`Blocked recovery assignee was not found: ${request.assigneeMemberId}`);
    }
    const execution = await this.blockedRecovery.resumeFromParticipantReply({
      employee,
      workRunId: request.workRunId,
      participantMessage: input.body,
      preferredLanguage: this.input.preferredLanguage,
      onProcessEvent: this.input.onProcessEvent,
    });
    const current = await this.input.workService.getWorkRunDetail(request.workRunId);
    const reply = execution.reply.trim() || this.fallbackRecoveryReply(current?.run.status, current?.run.resultSummary);
    if (reply) {
      const sent = await this.input.messageService.sendMessage(
        this.input.companyId,
        request.conversationId,
        { participantKind: "company_member", memberId: request.assigneeMemberId },
        reply,
        {
          runtimeLinks: [{
            linkId: `work-blocked-recovery-resume:${request.workRunId}:${input.messageId}`,
            targetKind: "work_run",
            targetId: request.workRunId,
            label: "Resumed WorkRun",
            sourceMessageId: input.messageId,
          }],
        },
      );
      await this.input.onMessageCreated?.(sent);
    }
    const updatedRequest = current?.run.status === "blocked"
      ? request
      : current?.run.status === "canceled"
        ? await this.input.recoveryRequests.cancel(this.input.companyId, request.workRunId, this.now()) || request
        : await this.input.recoveryRequests.resolve(this.input.companyId, request.workRunId, this.now()) || request;
    return {
      kind: "resumed",
      workRunId: request.workRunId,
      request: updatedRequest,
      execution,
    };
  }

  private async requesterMemberId(workRunId: string): Promise<string> {
    const detail = await this.input.workService.getWorkRunExecutionDetail(workRunId);
    const requesterMemberId = detail?.task.requesterId || detail?.task.createdByMemberId;
    if (!requesterMemberId) {
      throw new Error(`Blocked WorkRun ${workRunId} has no requester member.`);
    }
    if (requesterMemberId === detail?.run.assigneeMemberId) {
      throw new Error(`Blocked WorkRun ${workRunId} requester matches assignee; cannot create recovery DM.`);
    }
    return requesterMemberId;
  }

  private visibleParticipantMessage(message: WorkBlockedParticipantMessage): string {
    return [
      `I am blocked on: ${message.title.replace(/^WorkRun blocked:\s*/, "")}`,
      "",
      message.message,
    ].join("\n").trim();
  }

  private async memberDisplayName(memberId: string): Promise<string> {
    const resolved = await this.input.resolveMemberDisplayName?.(memberId);
    return resolved?.trim() || memberId;
  }

  private createId(prefix: string): string {
    return this.input.createId?.(prefix) || `${prefix}-${randomUUID()}`;
  }

  private now(): string {
    return this.input.now?.() || new Date().toISOString();
  }

  private fallbackRecoveryReply(status: string | undefined, summary: string | undefined): string {
    const trimmedSummary = summary?.trim();
    if (status === "done") {
      return trimmedSummary ? `Completed: ${trimmedSummary}` : "Completed.";
    }
    if (status === "failed") {
      return trimmedSummary ? `Failed: ${trimmedSummary}` : "Failed.";
    }
    if (status === "canceled") {
      return trimmedSummary ? `Canceled: ${trimmedSummary}` : "Canceled.";
    }
    if (status === "in_progress") {
      return trimmedSummary ? `Resumed: ${trimmedSummary}` : "Resumed and continuing the WorkRun.";
    }
    return "";
  }
}
