import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import type { RuntimePromptContextBlockInput } from "../prompting/prompt-compiler.js";
import type { EmployeeHome } from "../registry/employee-home.js";
import type { RuntimeSessionRepositoryLike } from "../storage/runtime-session-repository.js";
import type { PromptInputPackage } from "../provider/prompt-input-package.js";

export type ProcessTraceEventDraft =
  Omit<ProcessTraceEvent, "id" | "timestamp"> &
  Partial<Pick<ProcessTraceEvent, "id" | "timestamp">>;

export type RuntimeSessionEventInput = Parameters<RuntimeSessionRepositoryLike["appendSessionEvent"]>[0];

export type RuntimeSessionEventDraft =
  Omit<RuntimeSessionEventInput, "id" | "sessionRecordId" | "sequence" | "timestamp"> & {
    timestamp?: string;
  };

export interface RuntimeTokenUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    total?: number;
  };
}

export interface RuntimeProviderEvent {
  provider: string;
  rawEvent?: unknown;
  usage?: RuntimeTokenUsage;
  runtimeSessionEvent?: RuntimeSessionEventDraft;
  processTraceEvents?: ProcessTraceEventDraft[];
}

export interface RuntimeProviderReplyRequest {
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
  onTextDelta?: (delta: string) => void;
  onProviderEvent?: (event: RuntimeProviderEvent) => void;
}

export interface RuntimeImageInput {
  attachmentId: string;
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteLength: number;
  previewUrl?: string;
  downloadUrl?: string;
  storageKey?: string;
  contentSha256?: string;
}

export interface RuntimeProviderReply {
  message: string;
  promptInputPackage: PromptInputPackage;
}

export interface RuntimeProvider {
  readonly providerId: string;
  warm(employee: EmployeeHome): Promise<void>;
  reply(input: RuntimeProviderReplyRequest): Promise<string | RuntimeProviderReply>;
  abortWhere(predicate: (input: { companyId: string; employeeId: string; sessionKey: string }) => boolean): Promise<number>;
  reloadWhere(predicate: (input: { companyId: string; employeeId: string; sessionKey: string }) => boolean): Promise<{
    reloadedCount: number;
    sessionKeys: string[];
  }>;
}
