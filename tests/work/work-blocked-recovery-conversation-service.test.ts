import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { InMemoryMessageRepository } from "../../src/collaboration/message/message-repository.js";
import { MessageService } from "../../src/collaboration/message/message-service.js";
import { PostgresMessageRepository } from "../../src/collaboration/message/postgres-message-repository.js";
import { createCompany } from "../../src/runtime/company-config/companies-admin.js";
import { companyEmployeeHomePath } from "../../src/runtime/company-config/company-paths.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import type { EmployeeHome } from "../../src/runtime/registry/employee-home.js";
import {
  InMemoryWorkBlockedRecoveryRequestRepository,
  WorkBlockedRecoveryRequestRepository,
  WorkBlockedRecoveryConversationService,
  WorkExecutionService,
  type WorkExecutionResponderInput,
  WorkService,
} from "../../src/work/index.js";

function createDeterministicClock() {
  let tick = 0;
  return () => `2026-07-09T08:00:${String(tick++).padStart(2, "0")}.000Z`;
}

function createDeterministicIds(idPrefix = "") {
  let tick = 0;
  return (prefix: string) => `${idPrefix}${prefix}-${++tick}`;
}

async function createFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-work-blocked-recovery-"));
  const companyId = path.basename(repoRoot).replace(/[^a-zA-Z0-9-]/g, "").toLowerCase();
  const idPrefix = `${companyId}-`;
  const requesterMemberId = `${idPrefix}xu`;
  const assigneeMemberId = `${idPrefix}avery`;
  await createCompany({
    repoRoot,
    companyId,
    displayName: companyId,
    hrEmployeeDisplayName: "Fixture Owner",
  });
  const homePath = companyEmployeeHomePath({
    repoRoot,
    companyId,
    employeeId: assigneeMemberId,
  });
  const workspacePath = path.join(homePath, "workspace");
  await mkdir(workspacePath, { recursive: true });
  const directory = await CompanyDirectoryRepository.open(repoRoot, { companyId });
  try {
    for (const [employeeId, displayName] of [[requesterMemberId, "Xu"], [assigneeMemberId, "Avery"]] as const) {
      await directory.upsertEmployee({
        employeeId,
        enabled: true,
        profile: {
          employeeId,
          displayName,
          role: employeeId === assigneeMemberId ? "automation" : "boss",
          presenceMode: "resident",
        },
        resourcePolicy: { version: 1, filesystem: { ownWorkspace: "allow", otherEmployeeWorkspace: "allow", repo: "allow", secrets: "deny" } },
        runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
      });
    }
    await directory.save();
  } finally {
    directory.close();
  }

  const workService = new WorkService({
    repoRoot,
    companyId,
    now: createDeterministicClock(),
    createId: createDeterministicIds(idPrefix),
  });
  const employee: EmployeeHome = {
    employeeId: assigneeMemberId,
    homePath,
    workspacePath,
    profile: {
      employeeId: assigneeMemberId,
      displayName: "Avery",
      role: "automation",
      presenceMode: "resident",
    },
    resourcePolicy: { version: 1, filesystem: { ownWorkspace: "allow", otherEmployeeWorkspace: "allow", repo: "allow", secrets: "deny" } },
  };
  return {
    repoRoot,
    companyId,
    requesterMemberId,
    assigneeMemberId,
    workService,
    employee,
  };
}

async function finishWorkTurn(input: WorkExecutionResponderInput, args: {
  status: "complete" | "blocked" | "failed" | "canceled" | "in_progress";
  summary?: string;
  evidence?: string[];
  blockerMessage?: string;
}) {
  await input.onProcessEvent?.({
    kind: "model_tool_call",
    sessionKey: input.sessionKey,
    employeeId: input.employee.employeeId,
    title: "finish_work_turn called",
    status: "succeeded",
    metadata: {
      toolName: "finish_work_turn",
      arguments: {
        evidence: [],
        blockerMessage: "",
        ...args,
      },
    },
  });
  await input.onProcessEvent?.({
    kind: "model_tool_result",
    sessionKey: input.sessionKey,
    employeeId: input.employee.employeeId,
    title: "finish_work_turn returned a result",
    status: "succeeded",
    metadata: {
      toolName: "finish_work_turn",
    },
  });
  return args.summary || args.status;
}

test("blocked WorkRun opens a recovery DM and participant reply resumes the original WorkRun session", async () => {
  const { companyId, requesterMemberId, assigneeMemberId, workService, employee } = await createFixture();
  const planned = await workService.createWork({
    title: "Publish launch reminder",
    description: "Publish the prepared launch reminder after confirming the campaign URL.",
    createdByMemberId: requesterMemberId,
    ownerMemberId: assigneeMemberId,
    sourceKind: "chat_request",
    sourceId: "conversation-launch",
    requesterId: requesterMemberId,
    acceptanceCriteria: "Launch reminder is published with the confirmed campaign URL.",
    trigger: { kind: "immediate" },
  });
  assert.ok(planned.run);
  await workService.moveWorkRun({
    workRunId: planned.run.id,
    actorMemberId: assigneeMemberId,
    status: "in_progress",
    summary: "Started launch reminder work.",
  });
  await workService.moveWorkRun({
    workRunId: planned.run.id,
    actorMemberId: assigneeMemberId,
    status: "blocked",
    reason: "Need the final campaign URL from Xu.",
    summary: "Blocked on campaign URL.",
  });

  const messageService = new MessageService({
    repository: new InMemoryMessageRepository(),
    createId: createDeterministicIds("chat-"),
    now: createDeterministicClock(),
  });
  const recoveryRequests = new InMemoryWorkBlockedRecoveryRequestRepository();
  const createdMessages: string[] = [];
  let publishedAfterRecoveryLink = false;
  const calls: Array<{ threadId: string; contextText?: string }> = [];
  const workExecutionService = new WorkExecutionService({
    workService,
    async responder(input) {
      calls.push({
        threadId: input.threadId,
        contextText: input.contextBlocks?.[0]?.text,
      });
      return finishWorkTurn(input, {
        status: "complete",
        summary: "Launch reminder published with the confirmed campaign URL.",
        evidence: ["Xu provided https://example.com/launch."],
      });
    },
  });
  const service = new WorkBlockedRecoveryConversationService({
    companyId,
    workService,
    workExecutionService,
    messageService,
    recoveryRequests,
    resolveEmployee: async (memberId) => memberId === assigneeMemberId ? employee : undefined,
    resolveMemberDisplayName: async (memberId) => memberId === requesterMemberId ? "Xu" : "Avery",
    onMessageCreated: async (result) => {
      publishedAfterRecoveryLink = Boolean(
        await recoveryRequests.getOpenByWorkRunId(companyId, planned.run!.id),
      );
      createdMessages.push(result.message.messageId);
    },
    createId: createDeterministicIds("recovery-"),
    now: createDeterministicClock(),
  });

  const opened = await service.openRecoveryForBlockedRun({ workRunId: planned.run.id });
  assert.equal(opened.request.status, "open");
  assert.equal(publishedAfterRecoveryLink, true);
  assert.deepEqual(createdMessages, [opened.firstMessage?.messageId]);
  assert.equal(opened.request.workRunId, planned.run.id);
  assert.equal(opened.request.requesterMemberId, requesterMemberId);
  assert.equal(opened.conversation.conversationKind, "direct");
  assert.deepEqual(
    opened.conversation.participants.map((participant) => participant.memberId).sort(),
    [assigneeMemberId, requesterMemberId].sort(),
  );
  assert.equal(opened.firstMessage?.sender.memberId, assigneeMemberId);
  assert.match(opened.firstMessage?.body || "", /Need the final campaign URL from Xu/);

  const participantReply = await messageService.sendMessage(
    companyId,
    opened.request.conversationId,
    { participantKind: "company_member", memberId: requesterMemberId },
    "Use https://example.com/launch for this reminder.",
  );
  const resumed = await service.handleParticipantMessage({
    companyId,
    conversationId: opened.request.conversationId,
    messageId: participantReply.message.messageId,
    actorMemberId: requesterMemberId,
    body: participantReply.message.body,
  });

  assert.equal(resumed.kind, "resumed");
  assert.equal(resumed.workRunId, planned.run.id);
  assert.equal(calls[0]?.threadId, planned.run.id);
  assert.match(calls[0]?.contextText || "", /Participant reply:/);
  assert.match(calls[0]?.contextText || "", /https:\/\/example\.com\/launch/);
  assert.equal((await workService.getWorkRunDetail(planned.run.id))?.run.status, "done");
  assert.equal((await recoveryRequests.getByWorkRunId(companyId, planned.run.id))?.status, "resolved");
  const recoveryMessages = await messageService.listMessages(companyId, opened.request.conversationId);
  const finalReply = recoveryMessages.messages.find((message) =>
    message.sender.memberId === assigneeMemberId &&
    message.messageId !== opened.firstMessage?.messageId
  );
  assert.match(finalReply?.body || "", /Launch reminder published/);
  assert.deepEqual(createdMessages, [opened.firstMessage?.messageId, finalReply?.messageId]);
});

test("blocked recovery supports multi-turn clarification in one DM and one WorkRun session", async () => {
  const { companyId, requesterMemberId, assigneeMemberId, workService, employee } = await createFixture();
  const planned = await workService.createWork({
    title: "Prepare regional launch brief",
    description: "Prepare the launch brief after confirming the target region and launch date.",
    createdByMemberId: requesterMemberId,
    ownerMemberId: assigneeMemberId,
    sourceKind: "chat_request",
    sourceId: "conversation-regional-launch",
    requesterId: requesterMemberId,
    acceptanceCriteria: "The brief includes the confirmed region and launch date.",
    trigger: { kind: "immediate" },
  });
  assert.ok(planned.run);
  await workService.moveWorkRun({
    workRunId: planned.run.id,
    actorMemberId: assigneeMemberId,
    status: "in_progress",
  });
  await workService.moveWorkRun({
    workRunId: planned.run.id,
    actorMemberId: assigneeMemberId,
    status: "blocked",
    reason: "Need the target region and launch date.",
  });

  const messageService = new MessageService({
    repository: new InMemoryMessageRepository(),
    createId: createDeterministicIds("multi-turn-chat-"),
    now: createDeterministicClock(),
  });
  const recoveryRequests = new InMemoryWorkBlockedRecoveryRequestRepository();
  const sessionKeys: string[] = [];
  let participantTurn = 0;
  let recoveryService!: WorkBlockedRecoveryConversationService;
  const workExecutionService = new WorkExecutionService({
    workService,
    blockedRecovery: {
      openRecoveryForBlockedRun(input) {
        return recoveryService.openRecoveryForBlockedRun(input);
      },
    },
    async responder(input) {
      sessionKeys.push(input.sessionKey);
      participantTurn += 1;
      if (participantTurn === 1) {
        return finishWorkTurn(input, {
          status: "blocked",
          summary: "I still need the exact launch date; is it July 21 or July 28?",
          blockerMessage: "Need the exact launch date after confirming the region is Singapore.",
        });
      }
      return finishWorkTurn(input, {
        status: "complete",
        summary: "Regional launch brief prepared for Singapore on July 28.",
        evidence: ["Requester confirmed Singapore and July 28 in the recovery DM."],
      });
    },
  });
  recoveryService = new WorkBlockedRecoveryConversationService({
    companyId,
    workService,
    workExecutionService,
    messageService,
    recoveryRequests,
    resolveEmployee: async (memberId) => memberId === assigneeMemberId ? employee : undefined,
    resolveMemberDisplayName: async (memberId) => memberId === requesterMemberId ? "Xu" : "Avery",
    createId: createDeterministicIds("multi-turn-recovery-"),
    now: createDeterministicClock(),
  });

  const opened = await recoveryService.openRecoveryForBlockedRun({ workRunId: planned.run.id });
  const firstReply = await messageService.sendMessage(
    companyId,
    opened.request.conversationId,
    { participantKind: "company_member", memberId: requesterMemberId },
    "The region is Singapore.",
  );
  const firstResult = await recoveryService.handleParticipantMessage({
    companyId,
    conversationId: opened.request.conversationId,
    messageId: firstReply.message.messageId,
    actorMemberId: requesterMemberId,
    body: firstReply.message.body,
  });

  assert.equal(firstResult.kind, "resumed");
  assert.equal((await workService.getWorkRunDetail(planned.run.id))?.run.status, "blocked");
  assert.equal((await recoveryRequests.getByWorkRunId(companyId, planned.run.id))?.status, "open");
  assert.equal(firstResult.request.conversationId, opened.request.conversationId);

  const secondReply = await messageService.sendMessage(
    companyId,
    opened.request.conversationId,
    { participantKind: "company_member", memberId: requesterMemberId },
    "Use July 28. You can continue and complete the brief.",
  );
  const secondResult = await recoveryService.handleParticipantMessage({
    companyId,
    conversationId: opened.request.conversationId,
    messageId: secondReply.message.messageId,
    actorMemberId: requesterMemberId,
    body: secondReply.message.body,
  });

  assert.equal(secondResult.kind, "resumed");
  assert.equal((await workService.getWorkRunDetail(planned.run.id))?.run.status, "done");
  assert.equal((await recoveryRequests.getByWorkRunId(companyId, planned.run.id))?.status, "resolved");
  assert.equal(secondResult.request.conversationId, opened.request.conversationId);
  assert.deepEqual(sessionKeys, [
    `${assigneeMemberId}|work_run_execution|${planned.run.id}`,
    `${assigneeMemberId}|work_run_execution|${planned.run.id}`,
  ]);
  const messages = await messageService.listMessages(companyId, opened.request.conversationId);
  assert.equal(messages.messages.filter((message) => message.sender.memberId === assigneeMemberId).length, 3);
});

test("blocked recovery does not resolve an intermediate in-progress turn and revises the same WorkRun after confirmation", async () => {
  const { companyId, requesterMemberId, assigneeMemberId, workService, employee } = await createFixture();
  const planned = await workService.createWork({
    title: "Validate the launch brief",
    description: "Validate the original launch brief after receiving operator direction.",
    createdByMemberId: requesterMemberId,
    ownerMemberId: assigneeMemberId,
    sourceKind: "chat_request",
    sourceId: "conversation-revise-launch",
    requesterId: requesterMemberId,
    acceptanceCriteria: "The confirmed launch objective is completed.",
    trigger: { kind: "immediate" },
  });
  assert.ok(planned.run);
  await workService.moveWorkRun({
    workRunId: planned.run.id,
    actorMemberId: assigneeMemberId,
    status: "in_progress",
  });
  await workService.moveWorkRun({
    workRunId: planned.run.id,
    actorMemberId: assigneeMemberId,
    status: "blocked",
    reason: "Need the operator to confirm the replacement objective.",
  });

  const messageService = new MessageService({
    repository: new InMemoryMessageRepository(),
    createId: createDeterministicIds("revision-chat-"),
    now: createDeterministicClock(),
  });
  const recoveryRequests = new InMemoryWorkBlockedRecoveryRequestRepository();
  let turn = 0;
  let recoveryService!: WorkBlockedRecoveryConversationService;
  const workExecutionService = new WorkExecutionService({
    workService,
    autoContinue: { maxTurns: 2 },
    blockedRecovery: {
      openRecoveryForBlockedRun(input) {
        return recoveryService.openRecoveryForBlockedRun(input);
      },
    },
    async responder(input) {
      turn += 1;
      if (turn === 1) {
        return finishWorkTurn(input, {
          status: "in_progress",
          summary: "Restated the replacement objective and waiting for confirmation.",
        });
      }
      if (turn === 2) {
        return finishWorkTurn(input, {
          status: "blocked",
          summary: "Still waiting for the operator to confirm the replacement objective.",
          blockerMessage: "Please confirm the replacement objective before execution continues.",
        });
      }
      await workService.reviseWorkTask({
        workTaskId: planned.task.id,
        actorMemberId: assigneeMemberId,
        reason: "Operator confirmed the replacement objective in the recovery DM.",
        title: "Prepare the launch weekly report",
        sourceWorkRunId: planned.run.id,
      });
      return finishWorkTurn(input, {
        status: "complete",
        summary: "Launch weekly report prepared under the confirmed objective.",
        evidence: ["The same WorkRun completed Task revision 2."],
      });
    },
  });
  recoveryService = new WorkBlockedRecoveryConversationService({
    companyId,
    workService,
    workExecutionService,
    messageService,
    recoveryRequests,
    resolveEmployee: async (memberId) => memberId === assigneeMemberId ? employee : undefined,
    resolveMemberDisplayName: async (memberId) => memberId === requesterMemberId ? "Xu" : "Avery",
    createId: createDeterministicIds("revision-recovery-"),
    now: createDeterministicClock(),
  });

  const opened = await recoveryService.openRecoveryForBlockedRun({ workRunId: planned.run.id });
  const direction = await messageService.sendMessage(
    companyId,
    opened.request.conversationId,
    { participantKind: "company_member", memberId: requesterMemberId },
    "Change the objective to a launch weekly report, restate it, and wait for my confirmation.",
  );
  await recoveryService.handleParticipantMessage({
    companyId,
    conversationId: opened.request.conversationId,
    messageId: direction.message.messageId,
    actorMemberId: requesterMemberId,
    body: direction.message.body,
  });

  assert.equal((await workService.getWorkRunDetail(planned.run.id))?.run.status, "blocked");
  assert.equal((await recoveryRequests.getByWorkRunId(companyId, planned.run.id))?.status, "open");

  const confirmation = await messageService.sendMessage(
    companyId,
    opened.request.conversationId,
    { participantKind: "company_member", memberId: requesterMemberId },
    "Confirmed. Continue with that replacement objective.",
  );
  await recoveryService.handleParticipantMessage({
    companyId,
    conversationId: opened.request.conversationId,
    messageId: confirmation.message.messageId,
    actorMemberId: requesterMemberId,
    body: confirmation.message.body,
  });

  const detail = await workService.getWorkTaskDetail(planned.task.id);
  assert.equal(detail?.task.revision, 2);
  assert.equal(detail?.revisions[1]?.sourceWorkRunId, planned.run.id);
  assert.equal(detail?.runs[0]?.taskRevision, 2);
  assert.equal(detail?.runs[0]?.status, "done");
  assert.equal((await recoveryRequests.getByWorkRunId(companyId, planned.run.id))?.status, "resolved");
});

test("blocked recovery request persists the linked DM conversation", async () => {
  const { repoRoot, companyId, requesterMemberId, assigneeMemberId, workService, employee } = await createFixture();
  const planned = await workService.createWork({
    title: "Confirm partner quote",
    description: "Publish partner quote only after the operator confirms the final wording.",
    createdByMemberId: requesterMemberId,
    ownerMemberId: assigneeMemberId,
    sourceKind: "chat_request",
    sourceId: "conversation-partner-quote",
    requesterId: requesterMemberId,
    acceptanceCriteria: "Partner quote is published after final wording is confirmed.",
    trigger: { kind: "immediate" },
  });
  assert.ok(planned.run);
  await workService.moveWorkRun({
    workRunId: planned.run.id,
    actorMemberId: assigneeMemberId,
    status: "in_progress",
    summary: "Started partner quote work.",
  });
  await workService.moveWorkRun({
    workRunId: planned.run.id,
    actorMemberId: assigneeMemberId,
    status: "blocked",
    reason: "Need the final approved quote.",
    summary: "Blocked on quote approval.",
  });

  const messageRepository = await PostgresMessageRepository.open(repoRoot, { companyId });
  const recoveryRequests = await WorkBlockedRecoveryRequestRepository.open(repoRoot, { companyId });
  try {
    const messageService = new MessageService({
      repository: messageRepository,
      createId: createDeterministicIds("pg-chat-"),
      now: createDeterministicClock(),
    });
    const service = new WorkBlockedRecoveryConversationService({
      companyId,
      workService,
      workExecutionService: new WorkExecutionService({
        workService,
        async responder(input) {
          return finishWorkTurn(input, {
            status: "complete",
            summary: "Quote confirmed and published.",
            evidence: ["Operator confirmed the final quote."],
          });
        },
      }),
      messageService,
      recoveryRequests,
      resolveEmployee: async (memberId) => memberId === assigneeMemberId ? employee : undefined,
      resolveMemberDisplayName: async (memberId) => memberId === requesterMemberId ? "Xu" : "Avery",
      createId: createDeterministicIds("pg-recovery-"),
      now: createDeterministicClock(),
    });

    const opened = await service.openRecoveryForBlockedRun({ workRunId: planned.run.id });
    const persisted = await recoveryRequests.getOpenByConversationId(companyId, opened.request.conversationId);

    assert.equal(persisted?.workRunId, planned.run.id);
    assert.equal(persisted?.requesterMemberId, requesterMemberId);
    assert.equal(persisted?.assigneeMemberId, assigneeMemberId);
  } finally {
    recoveryRequests.close();
    messageRepository.close();
  }
});

test("blocked recovery DM sends a fallback completion reply when runtime text is empty", async () => {
  const { companyId, requesterMemberId, assigneeMemberId, workService, employee } = await createFixture();
  const planned = await workService.createWork({
    title: "Publish follow-up reminder",
    description: "Publish a follow-up reminder after Xu provides the destination URL.",
    createdByMemberId: requesterMemberId,
    ownerMemberId: assigneeMemberId,
    sourceKind: "chat_request",
    sourceId: "conversation-follow-up",
    requesterId: requesterMemberId,
    acceptanceCriteria: "Follow-up reminder is published with the confirmed destination URL.",
    trigger: { kind: "immediate" },
  });
  assert.ok(planned.run);
  await workService.moveWorkRun({
    workRunId: planned.run.id,
    actorMemberId: assigneeMemberId,
    status: "in_progress",
  });
  await workService.moveWorkRun({
    workRunId: planned.run.id,
    actorMemberId: assigneeMemberId,
    status: "blocked",
    reason: "Need the final destination URL.",
  });

  const messageService = new MessageService({
    repository: new InMemoryMessageRepository(),
    createId: createDeterministicIds("empty-reply-chat-"),
    now: createDeterministicClock(),
  });
  const recoveryRequests = new InMemoryWorkBlockedRecoveryRequestRepository();
  const workExecutionService = new WorkExecutionService({
    workService,
    async responder(input) {
      await finishWorkTurn(input, {
        status: "complete",
        summary: "Follow-up reminder published with the confirmed destination URL.",
        evidence: ["Xu provided https://example.com/follow-up."],
      });
      return "";
    },
  });
  const service = new WorkBlockedRecoveryConversationService({
    companyId,
    workService,
    workExecutionService,
    messageService,
    recoveryRequests,
    resolveEmployee: async (memberId) => memberId === assigneeMemberId ? employee : undefined,
    resolveMemberDisplayName: async (memberId) => memberId === requesterMemberId ? "Xu" : "Avery",
    createId: createDeterministicIds("empty-reply-recovery-"),
    now: createDeterministicClock(),
  });

  const opened = await service.openRecoveryForBlockedRun({ workRunId: planned.run.id });
  const participantReply = await messageService.sendMessage(
    companyId,
    opened.request.conversationId,
    { participantKind: "company_member", memberId: requesterMemberId },
    "Use https://example.com/follow-up.",
  );

  await service.handleParticipantMessage({
    companyId,
    conversationId: opened.request.conversationId,
    messageId: participantReply.message.messageId,
    actorMemberId: requesterMemberId,
    body: participantReply.message.body,
  });

  const messages = await messageService.listMessages(companyId, opened.request.conversationId);
  const fallbackReply = messages.messages.at(-1);

  assert.equal(fallbackReply?.sender.memberId, assigneeMemberId);
  assert.match(fallbackReply?.body || "", /Completed/);
  assert.match(fallbackReply?.body || "", /confirmed destination URL/);
  assert.equal((await recoveryRequests.getByWorkRunId(companyId, planned.run.id))?.status, "resolved");
});
