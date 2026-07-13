import assert from "node:assert/strict";
import test from "node:test";

import { ApprovalRepository } from "../../src/governance/repositories/approval-repository.js";
import { ApprovalService } from "../../src/governance/services/company-governance-services.js";
import type { GovernanceState } from "../../src/governance/domain/governance-state.js";
import type { CompanyGovernanceStore } from "../../src/governance/storage/company-governance-store.js";
import { AccessRequestService, isAccessGrantMatchingRequest } from "../../src/runtime/company-config/access-request-service.js";

class TestGovernanceStore implements CompanyGovernanceStore {
  private state: GovernanceState = { approvals: [], approvalGrants: [], employeePolicies: [] };

  async load(): Promise<GovernanceState> {
    return this.state;
  }

  async save(state: GovernanceState): Promise<void> {
    this.state = state;
  }

  async update<T>(updater: (state: GovernanceState) => Promise<T> | T): Promise<T> {
    return updater(this.state);
  }
}

test("AccessRequestService resolves allow once, allow in context, and reject decisions", async () => {
  const store = new TestGovernanceStore();
  const repository = new ApprovalRepository(store);
  const approvalService = new ApprovalService(repository);
  const accessRequests = new AccessRequestService(repository, approvalService);

  const approval = await approvalService.createApproval({
    contextKind: "channel_topic",
    contextId: "room-1",
    sessionKey: "avery|channel_topic|room-1",
    requestedByMemberId: "avery",
    requestedAction: "read",
    requestedResource: ".env",
    requestedInputSnapshot: { tool: "read", path: ".env" },
    reason: "Sensitive path read requires approval.",
  });

  const listed = await accessRequests.listAccessRequests("ziho-e-com");
  assert.equal(listed.schema, "tinyoffice.access-requests");
  assert.equal(listed.requests[0]?.id, approval.id);
  assert.deepEqual(listed.requests[0]?.actions, ["allow_once", "allow_in_context", "reject"]);
  assert.deepEqual(listed.requests[0]?.foregroundTarget, {
    kind: "chat-room",
    roomId: "room-1",
    surface: "channel",
  });

  const once = await accessRequests.resolveAccessRequest("ziho-e-com", approval.id, {
    decision: "allow_once",
  });
  assert.equal(once.request.status, "approved");
  assert.equal(once.grant?.scope, "one_time");

  const contextApproval = await approvalService.createApproval({
    contextKind: "channel_topic",
    contextId: "room-1",
    sessionKey: "avery|channel_topic|room-1",
    requestedByMemberId: "avery",
    requestedAction: "read",
    requestedResource: ".env",
    reason: "Need another read while configuring the connector.",
  });
  const context = await accessRequests.resolveAccessRequest("ziho-e-com", contextApproval.id, {
    decision: "allow_in_context",
    note: "Only use this in the current connector setup.",
  });
  assert.equal(context.request.decisionNote, "Only use this in the current connector setup.");
  assert.equal(context.grant?.scope, "session");

  const rejectedApproval = await approvalService.createApproval({
    contextKind: "channel_topic",
    contextId: "room-2",
    sessionKey: "avery|channel_topic|room-2",
    requestedByMemberId: "avery",
    requestedAction: "bash",
    requestedResource: "rm -rf build",
    reason: "Dangerous command requires approval.",
  });
  const rejected = await accessRequests.resolveAccessRequest("ziho-e-com", rejectedApproval.id, {
    decision: "reject",
    note: "Use a targeted cleanup command instead.",
  });
  assert.equal(rejected.request.status, "rejected");
  assert.equal(rejected.request.decisionNote, "Use a targeted cleanup command instead.");
  assert.equal(rejected.grant, undefined);
});

test("AccessRequestService projects WorkRun requests into the linked recovery conversation", async () => {
  const store = new TestGovernanceStore();
  const repository = new ApprovalRepository(store);
  const approvalService = new ApprovalService(repository);
  const accessRequests = new AccessRequestService(repository, approvalService, {
    async resolveWorkRunForegroundTarget({ companyId, workRunId }) {
      assert.equal(companyId, "ziho-e-com");
      assert.equal(workRunId, "work-run-1");
      return {
        kind: "chat-room",
        roomId: "conversation-recovery-1",
        surface: "direct",
      };
    },
  });

  await approvalService.createApproval({
    contextKind: "work_run",
    contextId: "work-run-1",
    sessionKey: "avery|work_run_execution|work-run-1",
    requestedByMemberId: "avery",
    requestedAction: "read",
    requestedResource: ".env.release",
    reason: "Protected release configuration requires approval.",
  });

  const listed = await accessRequests.listAccessRequests("ziho-e-com");
  assert.deepEqual(listed.requests[0]?.foregroundTarget, {
    kind: "chat-room",
    roomId: "conversation-recovery-1",
    surface: "direct",
  });
});

test("AccessRequestService reconciles pending requests for terminal WorkRuns before projection", async () => {
  const store = new TestGovernanceStore();
  const repository = new ApprovalRepository(store);
  const approvalService = new ApprovalService(repository);
  const accessRequests = new AccessRequestService(repository, approvalService, {
    async resolveWorkRunStatus({ companyId, workRunId }) {
      assert.equal(companyId, "ziho-e-com");
      assert.equal(workRunId, "work-run-failed");
      return "failed";
    },
  });
  const approval = await approvalService.createApproval({
    contextKind: "work_run",
    contextId: "work-run-failed",
    sessionKey: "avery|work_run_execution|work-run-failed",
    requestedByMemberId: "avery",
    requestedAction: "read",
    requestedResource: ".env.release",
    reason: "Protected release configuration requires approval.",
  });

  const listed = await accessRequests.listAccessRequests("ziho-e-com");
  const reconciled = await repository.getById(approval.id);

  assert.equal(reconciled?.status, "canceled");
  assert.equal(listed.requests[0]?.status, "canceled");
  assert.deepEqual(listed.requests[0]?.actions, []);
});

test("Access grant matcher scopes allow-in-context to the current context", () => {
  const grant = {
    id: "grant-1",
    approvalId: "approval-1",
    memberId: "avery",
    action: "read",
    resource: ".env",
    scope: "session" as const,
    contextKind: "channel_topic" as const,
    contextId: "room-1",
    createdAt: "2026-07-08T00:00:00.000Z",
  };

  assert.equal(isAccessGrantMatchingRequest(grant, {
    memberId: "avery",
    action: "read",
    resource: ".env",
    contextKind: "channel_topic",
    contextId: "room-1",
  }), true);
  assert.equal(isAccessGrantMatchingRequest(grant, {
    memberId: "avery",
    action: "read",
    resource: ".env",
    contextKind: "channel_topic",
    contextId: "room-2",
  }), false);
});

test("AccessRequestService creates a pending request when a guarded tool call has no grant", async () => {
  const store = new TestGovernanceStore();
  const repository = new ApprovalRepository(store);
  const approvalService = new ApprovalService(repository);
  const accessRequests = new AccessRequestService(repository, approvalService);

  const decision = await accessRequests.decideAccessToolCall("ziho-e-com", {
    memberId: "avery",
    action: "read",
    resource: ".env",
    reason: "Access requires participant decision for sensitive path read: .env",
    contextKind: "channel_topic",
    contextId: "room-1",
    sessionKey: "avery|channel_topic|room-1",
    requestedInputSnapshot: { toolName: "read", input: { path: ".env" } },
  });

  assert.equal(decision.decision, "block");
  assert.equal(decision.request.status, "pending");
  assert.equal(decision.request.requestedByMemberId, "avery");
  assert.equal(decision.request.requestedAction, "read");
  assert.equal(decision.request.requestedResource, ".env");

  const repeated = await accessRequests.decideAccessToolCall("ziho-e-com", {
    memberId: "avery",
    action: "read",
    resource: ".env",
    reason: "Access requires participant decision for sensitive path read: .env",
    contextKind: "channel_topic",
    contextId: "room-1",
    sessionKey: "avery|channel_topic|room-1",
  });

  assert.equal(repeated.decision, "block");
  assert.equal(repeated.request.id, decision.request.id);
  assert.equal((await repository.list()).length, 1);
});

test("AccessRequestService allows a tool call with a matching session grant", async () => {
  const store = new TestGovernanceStore();
  const repository = new ApprovalRepository(store);
  const approvalService = new ApprovalService(repository);
  const accessRequests = new AccessRequestService(repository, approvalService);

  const approval = await approvalService.createApproval({
    contextKind: "channel_topic",
    contextId: "room-1",
    sessionKey: "avery|channel_topic|room-1",
    requestedByMemberId: "avery",
    requestedAction: "write",
    requestedResource: "docker-compose.yml",
    reason: "Runtime config write requires approval.",
  });
  await accessRequests.resolveAccessRequest("ziho-e-com", approval.id, {
    decision: "allow_in_context",
  });

  const decision = await accessRequests.decideAccessToolCall("ziho-e-com", {
    memberId: "avery",
    action: "write",
    resource: "docker-compose.yml",
    reason: "Runtime config write requires approval.",
    contextKind: "channel_topic",
    contextId: "room-1",
    sessionKey: "avery|channel_topic|room-1",
  });

  assert.deepEqual(decision, { decision: "allow" });
});

test("AccessRequestService consumes an allow-once grant on the first matching retry", async () => {
  const store = new TestGovernanceStore();
  const repository = new ApprovalRepository(store);
  const approvalService = new ApprovalService(repository);
  const accessRequests = new AccessRequestService(repository, approvalService);

  const approval = await approvalService.createApproval({
    contextKind: "channel_topic",
    contextId: "room-1",
    sessionKey: "avery|channel_topic|room-1",
    requestedByMemberId: "avery",
    requestedAction: "bash",
    requestedResource: "npm install left-pad",
    reason: "Bash command requires approval.",
  });
  const resolved = await accessRequests.resolveAccessRequest("ziho-e-com", approval.id, {
    decision: "allow_once",
  });

  const firstRetry = await accessRequests.decideAccessToolCall("ziho-e-com", {
    memberId: "avery",
    action: "bash",
    resource: "npm install left-pad",
    reason: "Bash command requires approval.",
    contextKind: "channel_topic",
    contextId: "room-1",
    sessionKey: "avery|channel_topic|room-1",
  });

  assert.deepEqual(firstRetry, { decision: "allow" });
  assert.equal((await repository.listGrants()).find((grant) => grant.id === resolved.grant?.id)?.consumedAt ? true : false, true);

  const secondRetry = await accessRequests.decideAccessToolCall("ziho-e-com", {
    memberId: "avery",
    action: "bash",
    resource: "npm install left-pad",
    reason: "Bash command requires approval.",
    contextKind: "channel_topic",
    contextId: "room-1",
    sessionKey: "avery|channel_topic|room-1",
  });

  assert.equal(secondRetry.decision, "block");
  assert.notEqual(secondRetry.request.id, approval.id);
});
