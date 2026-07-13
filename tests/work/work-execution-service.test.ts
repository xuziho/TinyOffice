import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCompany } from "../../src/runtime/company-config/companies-admin.js";
import { companyEmployeeHomePath } from "../../src/runtime/company-config/company-paths.js";
import type { EmployeeHome } from "../../src/runtime/registry/employee-home.js";
import { RuntimeSessionRepository } from "../../src/runtime/storage/runtime-session-repository.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import {
  buildWorkRunExecutionContextBlock,
  buildWorkRunExecutionPrompt,
  buildWorkRunExecutionSessionKey,
  WorkBlockedRecoveryService,
  WorkDispatchLeaseService,
  WorkDispatchRunner,
  WorkDispatcher,
  WorkExecutionService,
  WORK_RUN_ACTIVE_TOOL_NAMES,
  WorkService,
  type WorkExecutionResponderInput,
} from "../../src/work/index.js";

function createDeterministicClock() {
  let tick = 0;
  return () => `2026-06-08T00:00:${String(tick++).padStart(2, "0")}.000Z`;
}

function createDeterministicIds(idPrefix = "") {
  let tick = 0;
  return (prefix: string) => `${idPrefix}${prefix}-${++tick}`;
}

async function createFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-work-execution-"));
  const companyId = path.basename(repoRoot).replace(/[^a-zA-Z0-9-]/g, "").toLowerCase();
  const idPrefix = `${companyId}-`;
  const requesterEmployeeId = `${idPrefix}nora-automation`;
  const assigneeMemberId = `${idPrefix}iris-growth`;
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
    for (const employeeId of [requesterEmployeeId, assigneeMemberId]) {
      await directory.upsertEmployee({
        employeeId,
        enabled: true,
        profile: {
          employeeId,
          displayName: employeeId,
          role: "employee",
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
      displayName: "Iris",
      role: "growth",
      presenceMode: "resident",
    },
    resourcePolicy: { version: 1, filesystem: { ownWorkspace: "allow", otherEmployeeWorkspace: "allow", repo: "allow", secrets: "deny" } },
  };
  return {
    repoRoot,
    companyId,
    idPrefix,
    requesterEmployeeId,
    workService,
    employee,
  };
}

async function planImmediateWork(
  workService: WorkService,
  employee: EmployeeHome,
  createdByMemberId: string,
) {
  const planned = await workService.createWork({
    title: "Fix missing article image",
    description: "Article monitor reported a missing featured image.",
    createdByMemberId,
    ownerMemberId: employee.employeeId,
    sourceKind: "chat_request",
    sourceId: "post-001",
    acceptanceCriteria: "The affected article has a featured image and audit rerun passes.",
    trigger: { kind: "immediate" },
  });
  assert.ok(planned.run);
  return planned;
}

type FinishWorkTurnArgs = {
  status: "in_progress" | "complete" | "blocked" | "failed" | "canceled";
  summary?: string;
  evidence?: string[];
  blockerMessage?: string;
};

async function finishWorkTurn(input: WorkExecutionResponderInput, args: FinishWorkTurnArgs): Promise<string> {
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
  return args.summary || "";
}

test("WorkRun execution prompt splits summary from structured context", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const detail = await workService.getWorkRunExecutionDetail(planned.run!.id);

  const prompt = buildWorkRunExecutionPrompt(detail!);
  const contextBlock = buildWorkRunExecutionContextBlock(detail!);

  assert.match(prompt, /background work_run_execution session/);
  assert.ok(prompt.includes(planned.run!.id));
  assert.ok(!prompt.includes(`"workRunId": "${planned.run!.id}"`));
  assert.equal(contextBlock.role, "work_run_context");
  assert.equal(contextBlock.source, "work_execution.work_run_context");
  assert.match(contextBlock.text, /WorkRun package:/);
  assert.ok(contextBlock.text.includes(`"workRunId": "${planned.run!.id}"`));
  assert.match(prompt, /Fix missing article image/);
  assert.match(contextBlock.text, /acceptanceCriteria/);
  assert.doesNotMatch(contextBlock.text, /successCondition|verificationPlan|failureCondition|verificationStatus/);
  assert.doesNotMatch(contextBlock.text, /historicalSourceEvidence|rootPostId/);
  assert.match(contextBlock.text, /Recent WorkRun events:/);
  assert.match(contextBlock.text, /created/);
  assert.match(contextBlock.text, /finish_work_turn/);
  assert.doesNotMatch(prompt, /intent=start/);
});

test("WorkExecutionService auto-continues an in-progress WorkRun until it reaches a terminal status", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const calls: Array<{
    message: string;
    contextText?: string;
  }> = [];
  const service = new WorkExecutionService({
    workService,
    autoContinue: {
      maxTurns: 3,
    },
    async responder(input) {
      calls.push({
        message: input.message,
        contextText: input.contextBlocks?.[0]?.text,
      });
      if (calls.length === 2) {
        return finishWorkTurn(input, {
          status: "complete",
          summary: "Article image fixed and audit passed.",
          evidence: ["Checked the article featured image and reran the audit successfully."],
        });
      }
      return finishWorkTurn(input, {
        status: "in_progress",
        summary: "Still checking the article image.",
      });
    },
  });

  const result = await service.startWorkRunExecution({
    employee,
    workRunId: planned.run!.id,
  });
  const currentRun = await workService.getWorkRunDetail(planned.run!.id);

  assert.equal(result.reply, "Article image fixed and audit passed.");
  assert.equal(calls.length, 2);
  assert.match(calls[1]?.message || "", /Continue background work_run_execution session/);
  assert.doesNotMatch(calls[1]?.message || "", /WorkRun auto-continuation package/);
  assert.match(calls[1]?.contextText || "", /WorkRun auto-continuation package/);
  assert.equal(currentRun?.run.status, "done");
  assert.deepEqual(
    currentRun?.events.map((event) => event.eventType),
    ["created", "started", "progress", "auto_continued", "completed"],
  );
  assert.equal(currentRun?.run.resultSummary, "Article image fixed and audit passed.");
  assert.equal(currentRun?.events.at(-1)?.metadata?.evidence, "Checked the article featured image and reran the audit successfully.");
  assert.equal(Object.prototype.hasOwnProperty.call(currentRun?.run || {}, "resultPayload"), false);
});

test("WorkExecutionService suppresses provider output and final state after external cancellation", async () => {
  const { repoRoot, companyId, workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const sessionKey = `${employee.employeeId}|work_run_execution|${planned.run!.id}`;
  const sessionRepository = await RuntimeSessionRepository.open(repoRoot, { companyId });
  sessionRepository.upsertSessionRecord({
    id: "runtime-session-late-cancel",
    employeeId: employee.employeeId,
    sessionKey,
    sessionId: "runtime-session-late-cancel",
    sceneType: "work_run_execution",
    workRunId: planned.run!.id,
    status: "running",
    title: "Late cancellation session",
    summary: "WorkRun is running.",
    startedAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
  });
  await sessionRepository.save();
  sessionRepository.close();
  const processEvents: string[] = [];
  const service = new WorkExecutionService({
    workService,
    repoRoot,
    companyId,
    async responder(input) {
      await workService.moveWorkRun({
        workRunId: planned.run!.id,
        actorMemberId: requesterEmployeeId,
        status: "canceled",
        reason: "The operator canceled while execution was running.",
      });
      return finishWorkTurn(input, {
        status: "complete",
        summary: "This late completion must not be accepted.",
        evidence: ["late-evidence"],
      });
    },
  });

  const result = await service.startWorkRunExecution({
    employee,
    workRunId: planned.run!.id,
    onProcessEvent(event) {
      processEvents.push(event.title);
    },
  });
  const detail = await workService.getWorkRunDetail(planned.run!.id);
  const sessionAfter = await RuntimeSessionRepository.open(repoRoot, { companyId });
  const canceledSession = sessionAfter.listSessionRecords({ sessionKey, limit: 1 })[0];
  sessionAfter.close();

  assert.equal(result.reply, "");
  assert.equal(detail?.run.status, "canceled");
  assert.equal(detail?.run.resultSummary, undefined);
  assert.deepEqual(processEvents, []);
  assert.deepEqual(detail?.events.map((event) => event.eventType), ["created", "started", "canceled"]);
  assert.equal(canceledSession?.status, "canceled");
});

test("WorkExecutionService ignores running finish_work_turn previews when applying the final result", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const service = new WorkExecutionService({
    workService,
    async responder(input) {
      await input.onProcessEvent?.({
        kind: "model_tool_call",
        sessionKey: input.sessionKey,
        employeeId: input.employee.employeeId,
        title: "finish_work_turn preview started",
        status: "running",
        metadata: {
          toolName: "finish_work_turn",
          arguments: {},
        },
      });
      return finishWorkTurn(input, {
        status: "complete",
        summary: "Article image fixed and audit passed.",
        evidence: ["Checked the article featured image and reran the audit successfully."],
      });
    },
  });

  await service.startWorkRunExecution({
    employee,
    workRunId: planned.run!.id,
  });
  const currentRun = await workService.getWorkRunDetail(planned.run!.id);

  assert.equal(currentRun?.run.status, "done");
  assert.equal(currentRun?.run.resultSummary, "Article image fixed and audit passed.");
});

test("WorkExecutionService blocks when WorkRun result requests outside input", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const calls: string[] = [];
  const service = new WorkExecutionService({
    workService,
    blockedRecovery: {
      async openRecoveryForBlockedRun() {},
    },
    autoContinue: {
      maxTurns: 2,
    },
    async responder(input) {
      calls.push(input.message);
      return finishWorkTurn(input, {
        status: "blocked",
        summary: "Blocked on CMS access.",
        blockerMessage: "Need CMS access from the requester.",
      });
    },
  });

  const result = await service.startWorkRunExecution({
    employee,
    workRunId: planned.run!.id,
  });
  const currentRun = await workService.getWorkRunDetail(planned.run!.id);

  assert.equal(result.reply, "Blocked on CMS access.");
  assert.equal(calls.length, 1);
  assert.equal(currentRun?.run.status, "blocked");
  assert.match(currentRun?.run.blockedReason || "", /CMS access/i);
  assert.equal(Object.prototype.hasOwnProperty.call(currentRun?.run || {}, "resultPayload"), false);
  assert.deepEqual(
    currentRun?.events.map((event) => event.eventType),
    ["created", "started", "blocked"],
  );
});

test("WorkExecutionService starts the assignee WorkRun session without rootPostId trace identity", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const calls: Array<{
    sessionKey: string;
    threadId: string;
    message: string;
    contextBlocks?: Array<{ role: string; source: string; text: string }>;
    completionPolicyFieldPresent: boolean;
    activeToolNames?: string[];
    preferredLanguage?: string;
  }> = [];
  const service = new WorkExecutionService({
    workService,
    async responder(input) {
      calls.push({
        sessionKey: input.sessionKey,
        threadId: input.threadId,
        message: input.message,
        contextBlocks: input.contextBlocks,
        completionPolicyFieldPresent: Object.prototype.hasOwnProperty.call(input, "completionPolicy"),
        activeToolNames: input.activeToolNames,
        preferredLanguage: input.preferredLanguage,
      });
      await input.onProcessEvent?.({
        kind: "turn_received",
        sessionKey: input.sessionKey,
        employeeId: input.employee.employeeId,
        title: "WorkRun session started",
        status: "running",
      });
      return finishWorkTurn(input, {
        status: "in_progress",
        summary: "Started WorkRun session.",
      });
    },
  });
  const processEvents: unknown[] = [];

  const result = await service.startWorkRunExecution({
    employee,
    workRunId: planned.run!.id,
    preferredLanguage: "zh-CN",
    onProcessEvent(event) {
      processEvents.push(event);
    },
  });

  assert.equal(result.sessionKey, `${employee.employeeId}|work_run_execution|${planned.run!.id}`);
  assert.equal(result.reply, "Started WorkRun session.");
  assert.equal(calls[0]?.threadId, planned.run!.id);
  assert.equal(calls[0]?.preferredLanguage, "zh-CN");
  assert.equal(calls[0]?.completionPolicyFieldPresent, false);
  assert.deepEqual(calls[0]?.activeToolNames, [...WORK_RUN_ACTIVE_TOOL_NAMES]);
  assert.equal(calls[0]?.activeToolNames?.includes("handoff_topic_turn"), false);
  assert.equal(calls[0]?.activeToolNames?.includes("finish_intake_turn"), false);
  assert.equal(calls[0]?.activeToolNames?.includes("tinyoffice_capability_call"), true);
  assert.match(calls[0]?.message || "", /background work_run_execution session/);
  assert.doesNotMatch(calls[0]?.message || "", /"workRunId":/);
  assert.equal(calls[0]?.contextBlocks?.[0]?.role, "work_run_context");
  assert.ok((calls[0]?.contextBlocks?.[0]?.text || "").includes(`"workRunId": "${planned.run!.id}"`));
  assert.deepEqual(processEvents.slice(0, 1), [{
    kind: "turn_received",
    sessionKey: `${employee.employeeId}|work_run_execution|${planned.run!.id}`,
    workTaskId: planned.task.id,
    workRunId: planned.run!.id,
    employeeId: employee.employeeId,
    title: "WorkRun session started",
    status: "running",
    metadata: {
      workTaskId: planned.task.id,
    },
  }]);
  assert.equal(processEvents.length, 3);
  assert.equal(processEvents.some((event) => "rootPostId" in (event as Record<string, unknown>)), false);
});

test("WorkExecutionService repairs one missing finish_work_turn in the same WorkRun session", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const sessionKeys: string[] = [];
  const messages: string[] = [];
  const service = new WorkExecutionService({
    workService,
    async responder(input) {
      sessionKeys.push(input.sessionKey);
      messages.push(input.message);
      if (messages.length === 1) {
        return "I completed the work but forgot the protocol tool.";
      }
      return finishWorkTurn(input, {
        status: "complete",
        summary: "Protocol repair recorded the completed WorkRun.",
        evidence: ["The repair turn called finish_work_turn exactly once."],
      });
    },
  });

  const result = await service.startWorkRunExecution({ employee, workRunId: planned.run!.id });
  const detail = await workService.getWorkRunDetail(planned.run!.id);

  assert.equal(result.reply, "Protocol repair recorded the completed WorkRun.");
  assert.equal(detail?.run.status, "done");
  assert.equal(messages.length, 2);
  assert.match(messages[1] || "", /call finish_work_turn exactly once now/);
  assert.equal(new Set(sessionKeys).size, 1);
  assert.deepEqual(detail?.events.map((event) => event.eventType), [
    "created",
    "started",
    "protocol_repair",
    "completed",
  ]);
});

test("WorkExecutionService rejects WorkRun replies that still omit finish_work_turn after one repair", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  let calls = 0;
  const service = new WorkExecutionService({
    workService,
    async responder() {
      calls += 1;
      return JSON.stringify({
        protocol: "tinyoffice.work_run_result.v1",
        status: "complete",
        summary: "This old JSON path must not be accepted.",
        evidence: ["legacy-json"],
      });
    },
  });

  await assert.rejects(
    service.startWorkRunExecution({
      employee,
      workRunId: planned.run!.id,
    }),
    /finish_work_turn was not called/,
  );
  assert.equal(calls, 2);
  const currentRun = await workService.getWorkRunDetail(planned.run!.id);

  assert.equal(currentRun?.run.status, "failed");
  assert.match(currentRun?.run.failedReason || "", /finish_work_turn was not called/);
});

test("WorkExecutionService rejects multiple finish_work_turn calls", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const service = new WorkExecutionService({
    workService,
    async responder(input) {
      await finishWorkTurn(input, {
        status: "complete",
        summary: "First completion.",
        evidence: ["first"],
      });
      return finishWorkTurn(input, {
        status: "complete",
        summary: "Second completion.",
        evidence: ["second"],
      });
    },
  });

  await assert.rejects(
    service.startWorkRunExecution({
      employee,
      workRunId: planned.run!.id,
    }),
    /finish_work_turn to be called exactly once/,
  );
  const currentRun = await workService.getWorkRunDetail(planned.run!.id);

  assert.equal(currentRun?.run.status, "failed");
  assert.match(currentRun?.run.failedReason || "", /finish_work_turn to be called exactly once/);
});

test("WorkExecutionService fixtures isolate queued WorkRuns by company context", async () => {
  const firstFixture = await createFixture();
  const planned = await planImmediateWork(
    firstFixture.workService,
    firstFixture.employee,
    firstFixture.requesterEmployeeId,
  );
  const secondFixture = await createFixture();

  const secondFixtureQueuedRuns = await secondFixture.workService.listWorkRuns({ status: "queued" });

  assert.equal(
    secondFixtureQueuedRuns.some((run) => run.id === planned.run!.id),
    false,
  );
});

test("WorkDispatchRunner dispatches the oldest queued WorkRun into the assignee WorkRun session", async () => {
  const { repoRoot, companyId, idPrefix, workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const dispatchLeaseService = new WorkDispatchLeaseService({
    repoRoot,
    companyId,
    now: createDeterministicClock(),
    createId: createDeterministicIds(idPrefix),
  });
  const calls: Array<{ workRunId: string; sessionKey: string; preferredLanguage?: string }> = [];
  const workExecutionService = new WorkExecutionService({
    workService,
    async responder(input) {
      calls.push({
        workRunId: input.threadId,
        sessionKey: input.sessionKey,
        preferredLanguage: input.preferredLanguage,
      });
      return finishWorkTurn(input, {
        status: "in_progress",
        summary: "Work session received.",
      });
    },
  });
  const runner = new WorkDispatchRunner({
    dispatcher: new WorkDispatcher(workService, dispatchLeaseService),
    workExecutionService,
    async resolveEmployee(employeeId) {
      return employeeId === employee.employeeId ? employee : undefined;
    },
  });

  const result = await runner.dispatchNextToWorkRunSession({
    createdBy: "dispatcher",
    preferredLanguage: "zh-CN",
  });
  const latestLease = await dispatchLeaseService.getLatestLeaseForWorkRun(planned.run!.id);
  const currentRun = await workService.getWorkRunDetail(planned.run!.id);

  assert.equal(result?.candidate.run.id, planned.run!.id);
  assert.equal(result?.lease?.status, "acknowledged");
  assert.equal(result?.execution.sessionKey, `${employee.employeeId}|work_run_execution|${planned.run!.id}`);
  assert.equal(calls[0]?.workRunId, planned.run!.id);
  assert.equal(calls[0]?.preferredLanguage, "zh-CN");
  assert.equal(latestLease?.status, "acknowledged");
  assert.equal(currentRun?.run.status, "in_progress");
  assert.deepEqual(
    currentRun?.events.map((event) => event.eventType),
    ["created", "started", "progress"],
  );
});

test("WorkDispatchRunner prioritizes and consumes an explicit Retry Dispatch lease for the same queued WorkRun", async () => {
  const { repoRoot, companyId, workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const leaseService = new WorkDispatchLeaseService({
    repoRoot,
    companyId,
    now: createDeterministicClock(),
    createId: createDeterministicIds("retry-dispatch-"),
  });
  const sessionKey = buildWorkRunExecutionSessionKey(planned.run!);
  const failedLease = await leaseService.createPendingLease({
    workRunId: planned.run!.id,
    assigneeMemberId: employee.employeeId,
    sessionKey,
    createdBy: "control-plane",
  });
  await leaseService.failPendingLease({
    workRunId: planned.run!.id,
    reason: "Initial dispatch did not start.",
  });
  const retryLease = await leaseService.createPendingLease({
    workRunId: planned.run!.id,
    assigneeMemberId: employee.employeeId,
    sessionKey,
    createdBy: "tasks-operator",
    retryOfLeaseId: failedLease.id,
    metadata: {
      actionId: "retry-dispatch",
      source: "tasks-run-action",
    },
  });
  const runner = new WorkDispatchRunner({
    dispatcher: new WorkDispatcher(workService, leaseService),
    workExecutionService: new WorkExecutionService({
      workService,
      async responder(input) {
        return finishWorkTurn(input, {
          status: "complete",
          summary: "Retry Dispatch started and completed the original WorkRun.",
          evidence: ["The retry lease was acknowledged before execution."],
        });
      },
    }),
    resolveEmployee: async (employeeId) => employeeId === employee.employeeId ? employee : undefined,
  });

  const result = await runner.dispatchNextToWorkRunSession({ createdBy: "control-plane" });
  const latestLease = await leaseService.getLatestLeaseForWorkRun(planned.run!.id);
  const detail = await workService.getWorkRunDetail(planned.run!.id);

  assert.equal(result?.candidate.run.id, planned.run!.id);
  assert.equal(result?.lease?.id, retryLease.id);
  assert.equal(latestLease?.status, "acknowledged");
  assert.equal(latestLease?.retryOfLeaseId, failedLease.id);
  assert.equal(detail?.run.status, "done");
});

test("WorkDispatchRunner fails an explicit retry lease immediately when the assignee cannot be resolved", async () => {
  const { repoRoot, companyId, workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const leaseService = new WorkDispatchLeaseService({ repoRoot, companyId });
  const initialLease = await leaseService.createPendingLease({
    workRunId: planned.run!.id,
    assigneeMemberId: employee.employeeId,
    sessionKey: buildWorkRunExecutionSessionKey(planned.run!),
    createdBy: "control-plane",
  });
  await leaseService.failPendingLease({
    workRunId: planned.run!.id,
    reason: "Initial dispatch did not start.",
  });
  await leaseService.createPendingLease({
    workRunId: planned.run!.id,
    assigneeMemberId: employee.employeeId,
    sessionKey: buildWorkRunExecutionSessionKey(planned.run!),
    createdBy: "tasks-operator",
    retryOfLeaseId: initialLease.id,
    metadata: { actionId: "retry-dispatch", source: "tasks-run-action" },
  });
  const runner = new WorkDispatchRunner({
    dispatcher: new WorkDispatcher(workService, leaseService),
    workExecutionService: new WorkExecutionService({ workService }),
    resolveEmployee: async () => undefined,
  });

  await assert.rejects(
    runner.dispatchNextToWorkRunSession({ createdBy: "control-plane" }),
    /employee .* was not found/,
  );
  const latestLease = await leaseService.getLatestLeaseForWorkRun(planned.run!.id);
  assert.equal(latestLease?.status, "failed");
  assert.match(latestLease?.failureReason || "", /employee .* was not found/);
  assert.equal((await workService.getWorkRunDetail(planned.run!.id))?.run.status, "queued");
});

test("WorkExecutionService marks a started WorkRun failed when the responder fails", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const service = new WorkExecutionService({
    workService,
    async responder() {
      throw new Error(`PI reply failed for ${employee.employeeId}`);
    },
  });

  await assert.rejects(
    service.startWorkRunExecution({
      employee,
      workRunId: planned.run!.id,
    }),
    /PI reply failed/,
  );
  const currentRun = await workService.getWorkRunDetail(planned.run!.id);

  assert.equal(currentRun?.run.status, "failed");
  assert.equal(currentRun?.run.failedReason, `PI reply failed for ${employee.employeeId}`);
  assert.deepEqual(
    currentRun?.events.map((event) => event.eventType),
    ["created", "started", "failed"],
  );
});

test("WorkBlockedRecoveryService returns participant replies to the blocked WorkRun session", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  await workService.moveWorkRun({
    workRunId: planned.run!.id,
    actorMemberId: employee.employeeId,
    status: "in_progress",
    summary: "Started investigation.",
  });
  await workService.moveWorkRun({
    workRunId: planned.run!.id,
    actorMemberId: employee.employeeId,
    status: "blocked",
    reason: "Need CMS access from the user.",
    summary: "Blocked on CMS access.",
  });
  const calls: Array<{ message: string; threadId: string; contextText?: string }> = [];
  const executionService = new WorkExecutionService({
    workService,
    async responder(input) {
      calls.push({
        message: input.message,
        threadId: input.threadId,
        contextText: input.contextBlocks?.[0]?.text,
      });
      return finishWorkTurn(input, {
        status: "complete",
        summary: "CMS access confirmed and work completed.",
        evidence: ["Participant granted CMS access."],
      });
    },
  });
  const recovery = new WorkBlockedRecoveryService({
    workService,
    workExecutionService: executionService,
  });

  const participantMessage = await recovery.buildParticipantMessage(planned.run!.id);
  const result = await recovery.resumeFromParticipantReply({
    employee,
    workRunId: planned.run!.id,
    participantMessage: "I granted CMS access.",
  });

  assert.equal(participantMessage.assigneeMemberId, employee.employeeId);
  assert.match(participantMessage.message, new RegExp(`WorkRun ${planned.run!.id} is blocked`));
  assert.match(participantMessage.message, /Need CMS access/);
  assert.equal(result.sessionKey, `${employee.employeeId}|work_run_execution|${planned.run!.id}`);
  assert.equal(calls[0]?.threadId, planned.run!.id);
  assert.match(calls[0]?.message || "", /Resume background work_run_execution session/);
  assert.doesNotMatch(calls[0]?.message || "", /Participant reply:/);
  assert.match(calls[0]?.contextText || "", /Participant reply:/);
  assert.match(calls[0]?.contextText || "", /I granted CMS access/);
  const currentRun = await workService.getWorkRunDetail(planned.run!.id);
  assert.equal(currentRun?.run.status, "done");
});

test("WorkExecutionService notifies blocked recovery when auto-continuation budget blocks", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const notifiedWorkRunIds: string[] = [];
  const service = new WorkExecutionService({
    workService,
    autoContinue: {
      maxTurns: 2,
    },
    blockedRecovery: {
      async openRecoveryForBlockedRun(input) {
        notifiedWorkRunIds.push(input.workRunId);
      },
    },
    async responder(input) {
      return finishWorkTurn(input, {
        status: "in_progress",
        summary: "Still collecting evidence.",
      });
    },
  });

  await service.startWorkRunExecution({
    employee,
    workRunId: planned.run!.id,
  });
  const currentRun = await workService.getWorkRunDetail(planned.run!.id);

  assert.equal(currentRun?.run.status, "blocked");
  assert.deepEqual(notifiedWorkRunIds, [planned.run!.id]);
});

test("WorkExecutionService notifies blocked recovery when finish_work_turn blocks", async () => {
  const { workService, employee, requesterEmployeeId } = await createFixture();
  const planned = await planImmediateWork(workService, employee, requesterEmployeeId);
  const opened: string[] = [];
  const executionService = new WorkExecutionService({
    workService,
    async responder(input) {
      return finishWorkTurn(input, {
        status: "blocked",
        summary: "Blocked until the operator confirms the campaign URL.",
        blockerMessage: "Need the final campaign URL.",
      });
    },
    blockedRecovery: {
      async openRecoveryForBlockedRun(input) {
        opened.push(input.workRunId);
      },
    },
  });

  await executionService.startWorkRunExecution({
    employee,
    workRunId: planned.run!.id,
  });

  assert.deepEqual(opened, [planned.run!.id]);
});
