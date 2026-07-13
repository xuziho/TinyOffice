import { ensureConversationCompanyScope } from "../../collaboration/contracts/conversation-message-contract.js";
import type { AccessPreviewInput, AccessToolCallDecisionInput, EmployeePrivateSkillSaveInput, MemberRuntimeSaveInput, PromptPolicyBlockSaveInput, PromptPolicyTemplateSaveInput, ResolveAccessRequestInput } from "./contracts.js";
import type { ApprovalContextKind } from "../../governance/domain/approval.js";
import type { RecruitEmployeeRequest } from "../contracts/tinyoffice-api-contracts.js";
import type { WorkTaskLifecycleInput } from "../../work/work-service.js";
import { validateBodyCompanyId } from "./parsing-company.js";
import { requireObjectBody, requireString, stringFrom } from "./parsing.js";

export function parseMemberRuntimeSaveBody(value: unknown, companyId: string, memberId: string): MemberRuntimeSaveInput {
  const body = requireObjectBody(value, "member runtime save body");
  const bodyCompanyId = stringFrom(body.companyId);
  if (bodyCompanyId) {
    ensureConversationCompanyScope({ companyId, resourceCompanyId: bodyCompanyId });
  }
  const bodyMemberId = stringFrom(body.memberId);
  if (bodyMemberId && bodyMemberId !== memberId) {
    throw new Error("memberId must match the selected runtime-capable member");
  }
  return {
    memberId,
    profile: body.profile,
    resourcePolicy: body.resourcePolicy,
    runtime: body.runtime,
    instructionFiles: body.instructionFiles,
  };
}

export function parseEmployeePrivateSkillSaveBody(
  value: unknown,
  companyId: string,
  memberId: string,
  skillId: string,
): EmployeePrivateSkillSaveInput {
  const body = requireObjectBody(value, "employee private skill body");
  validateBodyCompanyId(body, companyId);
  const bodyMemberId = stringFrom(body.memberId);
  if (bodyMemberId && bodyMemberId !== memberId) {
    throw new Error("memberId must match the selected runtime-capable member");
  }
  const bodySkillId = stringFrom(body.skillId);
  if (bodySkillId && bodySkillId !== skillId) {
    throw new Error("skillId must match the selected employee private skill");
  }
  return {
    memberId,
    skillId,
    content: requireString(body, "content"),
  };
}

export function parseRecruitEmployeeBody(value: unknown, companyId: string): RecruitEmployeeRequest {
  const body = requireObjectBody(value, "recruit employee body");
  validateBodyCompanyId(body, companyId);
  return {
    companyId,
    employeeId: stringFrom(body.employeeId),
    displayName: requireString(body, "displayName"),
    role: requireString(body, "role"),
    summary: requireString(body, "summary"),
    presenceMode: stringFrom(body.presenceMode) as RecruitEmployeeRequest["presenceMode"],
    runtime: body.runtime as RecruitEmployeeRequest["runtime"],
    resourcePolicy: body.resourcePolicy as RecruitEmployeeRequest["resourcePolicy"],
    instructionContent: stringFrom(body.instructionContent),
  };
}

export function parseWorkTaskLifecycleBody(
  value: unknown,
  companyId: string,
  actorMemberId: string,
  workTaskId: string,
  confirmation: "CANCEL" | "ARCHIVE" | "RESTORE",
): WorkTaskLifecycleInput {
  const body = requireObjectBody(value, "WorkTask lifecycle body");
  validateBodyCompanyId(body, companyId);
  const bodyWorkTaskId = stringFrom(body.workTaskId);
  if (bodyWorkTaskId && bodyWorkTaskId !== workTaskId) {
    throw new Error("workTaskId mismatch");
  }
  if (stringFrom(body.confirmation) !== confirmation) {
    throw new Error(`confirmation must be ${confirmation}`);
  }
  return {
    workTaskId,
    actorMemberId,
    reason: stringFrom(body.reason),
  };
}

export function parsePromptPolicyTemplateSaveBody(value: unknown, companyId: string, templateId: string): PromptPolicyTemplateSaveInput {
  const body = requireObjectBody(value, "prompt template body");
  validateBodyCompanyId(body, companyId);
  const bodyTemplateId = stringFrom(body.templateId);
  if (bodyTemplateId && bodyTemplateId !== templateId) {
    throw new Error("templateId mismatch");
  }
  return {
    templateId,
    content: requireString(body, "content"),
  };
}

export function parsePromptPolicyBlockSaveBody(value: unknown, companyId: string, blockPath: string): PromptPolicyBlockSaveInput {
  const body = requireObjectBody(value, "prompt block body");
  validateBodyCompanyId(body, companyId);
  const bodyBlockPath = stringFrom(body.blockPath) || stringFrom(body.path);
  if (bodyBlockPath && bodyBlockPath !== blockPath) {
    throw new Error("blockPath mismatch");
  }
  return {
    blockPath,
    title: stringFrom(body.title),
    content: requireString(body, "content"),
  };
}

export function parsePromptPolicyConfigSaveBody(value: unknown, companyId: string): unknown {
  const body = requireObjectBody(value, "prompt policy config body");
  validateBodyCompanyId(body, companyId);
  return body.config;
}

export function parseAccessPolicySaveBody(value: unknown, companyId: string): unknown {
  const body = requireObjectBody(value, "Access policy body");
  validateBodyCompanyId(body, companyId);
  if (!("policy" in body)) {
    throw new Error("policy is required");
  }
  return body.policy;
}

export function parseAccessPreviewBody(value: unknown, companyId: string): AccessPreviewInput {
  const body = requireObjectBody(value, "Access preview body");
  validateBodyCompanyId(body, companyId);
  const operation = body.operation;
  if (operation !== "read" && operation !== "write" && operation !== "bash") {
    throw new Error("Access preview operation must be read, write, or bash");
  }
  if (!("policy" in body)) {
    throw new Error("policy is required");
  }
  return {
    policy: body.policy,
    operation,
    targetPath: body.targetPath,
    command: body.command,
    cwd: body.cwd,
  };
}

export function parseResolveAccessRequestBody(value: unknown, companyId: string): ResolveAccessRequestInput {
  const body = requireObjectBody(value, "Access request resolution body");
  validateBodyCompanyId(body, companyId);
  const decision = body.decision;
  if (decision !== "allow_once" && decision !== "allow_in_context" && decision !== "reject") {
    throw new Error("Access request decision must be allow_once, allow_in_context, or reject");
  }
  return {
    decision,
    note: stringFrom(body.note),
    resolvedByMemberId: stringFrom(body.resolvedByMemberId),
  };
}

export function parseAccessToolCallDecisionBody(value: unknown, companyId: string): AccessToolCallDecisionInput {
  const body = requireObjectBody(value, "Access tool-call decision body");
  validateBodyCompanyId(body, companyId);
  const action = body.action;
  if (action !== "read" && action !== "write" && action !== "bash") {
    throw new Error("Access tool-call action must be read, write, or bash");
  }
  const contextKind = body.contextKind;
  if (contextKind !== "dm_thread" && contextKind !== "channel_topic" && contextKind !== "work_run" && contextKind !== "intake_event") {
    throw new Error("Access tool-call contextKind must be dm_thread, channel_topic, work_run, or intake_event");
  }
  return {
    companyId,
    memberId: requireString(body, "memberId"),
    action,
    resource: stringFrom(body.resource),
    reason: requireString(body, "reason"),
    contextKind: contextKind as ApprovalContextKind,
    contextId: requireString(body, "contextId"),
    sessionKey: requireString(body, "sessionKey"),
    requestedInputSnapshot: body.requestedInputSnapshot,
  };
}
