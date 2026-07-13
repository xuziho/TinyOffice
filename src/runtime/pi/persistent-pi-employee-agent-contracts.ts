import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import type { RuntimePromptContextBlockInput } from "../prompting/prompt-compiler.js";
import type { PromptInputPackage } from "../provider/prompt-input-package.js";
import { TINYOFFICE_RUNTIME_TOOL_NAMES } from "../provider/runtime-tool-contracts.js";

export interface PersistentPiEmployeeAgentStatus {
  companyId: string;
  employeeId: string;
  sessionKey: string;
  bootstrapped: boolean;
  sessionDir: string;
  lastPromptAt?: string;
  lastReplyAt?: string;
}

export interface PersistentPiEmployeeAgentResponseInput {
  message: string;
  sessionKey: string;
  imageInputs?: PiPromptImageInput[];
  channelTopicId?: string;
  threadId?: string;
  roomId?: string;
  conversationId?: string;
  messageId?: string;
  chatEntryId?: string;
  actorMemberId?: string;
  reachableMemberIds?: string[];
  reachableParticipants?: ParticipantRef[];
  contextBlocks?: RuntimePromptContextBlockInput[];
  requesterUsername?: string;
  preferredLanguage?: string;
  activeToolNames?: string[];
  onTextDelta?: (delta: string) => void;
  onSessionEvent?: (event: unknown) => void;
}

export interface PiPromptImageInput {
  type: "image";
  data: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export interface PersistentPiEmployeeAgentReply {
  message: string;
  promptInputPackage: PromptInputPackage;
}

export type PromptBlockScene =
  | "dm_thread"
  | "channel_thread"
  | "work_run_execution"
  | "intake_event";

export interface CompanyPromptBlock {
  path: string;
  sha256: string;
  content: string;
}

export interface EmployeeInstructionFile {
  path: string;
  content: string;
}

export interface PiSessionTransportStartInput {
  cwd: string;
  employeeHomePath?: string;
  sessionDir: string;
  env: NodeJS.ProcessEnv;
  systemPromptAppend: string;
  promptBlocks?: CompanyPromptBlock[];
  activeToolNames?: string[];
}

export interface PiSessionTransportReplyInput extends PiSessionTransportStartInput {
  userPrompt: string;
  imageInputs?: PiPromptImageInput[];
  activeToolNames?: string[];
  onTextDelta?: (delta: string) => void;
  onSessionEvent?: (event: unknown) => void;
}

export interface PiSessionTransport {
  start(input: PiSessionTransportStartInput): Promise<void>;
  reply(input: PiSessionTransportReplyInput): Promise<{
    message: string;
    loadedSkillNames: string[];
    employeeInstructionFiles?: EmployeeInstructionFile[];
  }>;
  abort?(): Promise<void>;
}

export const PI_EMPLOYEE_TOOL_NAMES = TINYOFFICE_RUNTIME_TOOL_NAMES;
