import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import {
  DEFAULT_BASE_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_RUNTIME_PROMPT_TEMPLATE,
  loadPromptPolicyTemplateContent,
} from "../company-config/prompt-blocks-admin.js";
import {
  compileRuntimePrompt,
  type RuntimePromptContextBlockInput,
} from "../prompting/prompt-compiler.js";
import type { EmployeeHome } from "../registry/employee-home.js";
import type { CompanyPromptBlock } from "./persistent-pi-employee-agent-contracts.js";

function deriveRuntimePromptSceneType(sessionKey: string): string {
  const [, scene] = sessionKey.split("|");
  return scene || "channel_thread";
}

export function buildReplyPrompt(input: {
  employee: EmployeeHome;
  message: string;
  sessionKey: string;
  channelTopicId?: string;
  threadId?: string;
  reachableMemberIds?: string[];
  reachableParticipants?: ParticipantRef[];
  contextBlocks?: RuntimePromptContextBlockInput[];
  promptBlocks?: CompanyPromptBlock[];
  requesterUsername?: string;
  preferredLanguage?: string;
}): string {
  return buildUserPrompt(input);
}

export function buildSystemPromptAppend(input: {
  employee: EmployeeHome;
  sessionKey: string;
  templateContent?: string;
}): string {
  return renderBaseSystemPromptTemplate(
    input.templateContent?.trim() ? input.templateContent : DEFAULT_BASE_SYSTEM_PROMPT_TEMPLATE,
    input.employee,
  );
}

function renderBaseSystemPromptTemplate(templateContent: string, employee: EmployeeHome): string {
  return templateContent
    .replaceAll("{employeeId}", employee.employeeId)
    .replaceAll("{displayName}", employee.profile.displayName || employee.employeeId)
    .replaceAll("{role}", employee.profile.role)
    .trim();
}

function normalizePromptTemplateLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

export function buildUserPrompt(input: {
  employee: EmployeeHome;
  message: string;
  sessionKey: string;
  channelTopicId?: string;
  threadId?: string;
  reachableMemberIds?: string[];
  reachableParticipants?: ParticipantRef[];
  contextBlocks?: RuntimePromptContextBlockInput[];
  promptBlocks?: CompanyPromptBlock[];
  requesterUsername?: string;
  preferredLanguage?: string;
  runtimePromptTemplate?: string;
}): string {
  const sceneType = deriveRuntimePromptSceneType(input.sessionKey);

  return compileRuntimePrompt({
    sceneType,
    sessionKey: input.sessionKey,
    userVisibleMessage: input.message,
    runtimePromptTemplate: input.runtimePromptTemplate &&
      normalizePromptTemplateLineEndings(input.runtimePromptTemplate) === DEFAULT_RUNTIME_PROMPT_TEMPLATE
      ? undefined
      : input.runtimePromptTemplate,
    contextBlocks: input.contextBlocks || [],
  }).userPrompt;
}

export async function loadConfiguredPromptTemplates(input: { repoRoot: string; companyId: string }): Promise<{
  baseSystemPromptTemplate?: string;
  runtimePromptTemplate?: string;
}> {
  const [baseSystemPromptTemplate, runtimePromptTemplate] = await Promise.all([
    loadPromptPolicyTemplateContent({
      repoRoot: input.repoRoot,
      companyId: input.companyId,
      templateId: "base-system-prompt",
    }),
    loadPromptPolicyTemplateContent({
      repoRoot: input.repoRoot,
      companyId: input.companyId,
      templateId: "runtime-prompt-template",
    }),
  ]);
  return {
    baseSystemPromptTemplate: normalizePromptTemplateLineEndings(baseSystemPromptTemplate) === DEFAULT_BASE_SYSTEM_PROMPT_TEMPLATE
      ? undefined
      : baseSystemPromptTemplate,
    runtimePromptTemplate: normalizePromptTemplateLineEndings(runtimePromptTemplate) === DEFAULT_RUNTIME_PROMPT_TEMPLATE
      ? undefined
      : runtimePromptTemplate,
  };
}
