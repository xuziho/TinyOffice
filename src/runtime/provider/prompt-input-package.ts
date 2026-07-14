import { createHash } from "node:crypto";

import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import type { RuntimePromptContextBlockInput } from "../prompting/prompt-compiler.js";
import type { EmployeeHome } from "../registry/employee-home.js";

export interface CompanyPromptBlock {
  path: string;
  sha256: string;
  content: string;
}

export interface EmployeeInstructionFile {
  path: string;
  content: string;
}

export interface PromptInputPackageSkill {
  name: string;
  path?: string;
}

export interface PromptInputPackageTool {
  name: string;
}

export interface PromptInputPackageEmployeeInstruction {
  path: string;
  sha256: string;
  content: string;
}

export interface PromptInputPackage {
  version: 1;
  source: "tinyoffice_prompt_input_package";
  employeeId: string;
  sessionKey: string;
  sceneType: string;
  turnId?: string;
  modelCallId?: string;
  createdAt: string;
  model?: {
    provider?: string;
    id?: string;
  };
  requesterUsername?: string;
  threadId?: string;
  roomId?: string;
  conversationId?: string;
  messageId?: string;
  chatEntryId?: string;
  channelTopicId?: string;
  systemPrompt: {
    text: string;
    sha256: string;
  };
  runtimePrompt: {
    userPrompt: string;
    sha256: string;
  };
  userMessage: {
    text: string;
    sha256: string;
  };
  contextBlocks: RuntimePromptContextBlockInput[];
  participants: ParticipantRef[];
  promptBlocks: Array<{
    id: string;
    sha256: string;
    content: string;
  }>;
  employeeInstructions: PromptInputPackageEmployeeInstruction[];
  tools: PromptInputPackageTool[];
  skills: PromptInputPackageSkill[];
  cacheEvidence: {
    fullInputSha256: string;
    stablePrefixSha256: string;
    estimatedStablePrefixChars: number;
    providerCacheReadTokens?: number;
    providerCacheWriteTokens?: number;
  };
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function derivePromptInputSceneType(sessionKey: string): string {
  return sessionKey.split("|")[1] || "unknown";
}

export function buildPromptInputPackage(input: {
  employee: EmployeeHome;
  sessionKey: string;
  turnId?: string;
  modelCallId?: string;
  createdAt: string;
  message: string;
  userPrompt: string;
  systemPromptAppend: string;
  requesterUsername?: string;
  threadId?: string;
  roomId?: string;
  conversationId?: string;
  messageId?: string;
  chatEntryId?: string;
  channelTopicId?: string;
  reachableParticipants?: ParticipantRef[];
  contextBlocks?: RuntimePromptContextBlockInput[];
  promptBlocks?: CompanyPromptBlock[];
  employeeInstructionFiles?: EmployeeInstructionFile[];
  activeToolNames?: string[];
  loadedSkillNames?: string[];
}): PromptInputPackage {
  const promptBlocks = (input.promptBlocks || []).map((block) => ({
    id: block.path,
    sha256: block.sha256,
    content: block.content,
  }));
  const employeeInstructions = (input.employeeInstructionFiles || []).map((file) => ({
    path: file.path,
    sha256: sha256Text(file.content),
    content: file.content,
  }));
  const stablePrefix = [
    input.systemPromptAppend,
    ...promptBlocks.map((block) => block.content),
    ...employeeInstructions.map((file) => file.content),
  ].join("\n\n");
  const fullInput = [
    input.systemPromptAppend,
    ...promptBlocks.map((block) => block.content),
    ...employeeInstructions.map((file) => file.content),
    input.userPrompt,
  ].join("\n\n");

  return {
    version: 1,
    source: "tinyoffice_prompt_input_package",
    employeeId: input.employee.employeeId,
    sessionKey: input.sessionKey,
    sceneType: derivePromptInputSceneType(input.sessionKey),
    turnId: input.turnId,
    modelCallId: input.modelCallId,
    createdAt: input.createdAt,
    model: {
      provider: input.employee.runtime?.modelProvider,
      id: input.employee.runtime?.modelId,
    },
    requesterUsername: input.requesterUsername,
    threadId: input.threadId,
    roomId: input.roomId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    chatEntryId: input.chatEntryId,
    channelTopicId: input.channelTopicId,
    systemPrompt: {
      text: input.systemPromptAppend,
      sha256: sha256Text(input.systemPromptAppend),
    },
    runtimePrompt: {
      userPrompt: input.userPrompt,
      sha256: sha256Text(input.userPrompt),
    },
    userMessage: {
      text: input.message,
      sha256: sha256Text(input.message),
    },
    contextBlocks: input.contextBlocks || [],
    participants: input.reachableParticipants || [],
    promptBlocks,
    employeeInstructions,
    tools: (input.activeToolNames || []).map((name) => ({ name })).sort((a, b) => a.name.localeCompare(b.name)),
    skills: (input.loadedSkillNames || []).map((name) => ({ name })).sort((a, b) => a.name.localeCompare(b.name)),
    cacheEvidence: {
      fullInputSha256: sha256Text(fullInput),
      stablePrefixSha256: sha256Text(stablePrefix),
      estimatedStablePrefixChars: stablePrefix.length,
    },
  };
}
