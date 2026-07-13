import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import type { RuntimePromptContextBlockInput } from "../prompting/prompt-compiler.js";
import type { EmployeeHome } from "../registry/employee-home.js";
import type { RuntimeSessionRepositoryLike } from "../storage/runtime-session-repository.js";
import type {
  ProcessTraceEventDraft,
  RuntimeImageInput,
  RuntimeProvider,
  RuntimeTokenUsage,
} from "./contracts.js";

export interface NaturalLanguageResponseInput {
  employee: EmployeeHome;
  message: string;
  sessionKey: string;
  imageInputs?: RuntimeImageInput[];
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
  userMessageSource?: string;
  userMessagePayload?: Record<string, unknown>;
  runtimeSessionRepository?: RuntimeSessionRepositoryLike;
  onProcessEvent?: (event: ProcessTraceEventDraft) => void | Promise<void>;
  enableTextDeltas?: boolean;
  allowEmptyReply?: boolean;
  onRuntimeSessionPersisted?: (input: RuntimeSessionPersistResult) => void | Promise<void>;
  repoRoot?: string;
  runtimeProvider?: RuntimeProvider;
}

export interface NaturalLanguageResponse {
  message: string;
  usage?: RuntimeTokenUsage;
}

export type RuntimeSessionRecordInput = Parameters<RuntimeSessionRepositoryLike["upsertSessionRecord"]>[0];
export type RuntimeSessionEventInput = Parameters<RuntimeSessionRepositoryLike["appendSessionEvent"]>[0];

export interface RuntimeSessionPersistResult {
  record: RuntimeSessionRecordInput;
  appendedEventCount: number;
}

export type ProcessEventEmitter = (
  event: ProcessTraceEventDraft,
) => void | Promise<void>;
