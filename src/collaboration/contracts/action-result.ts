import type { ParticipantRef } from "./participant-ref.js";

export interface ThreadVisibleMessage {
  type: "handoff";
  channelTopicId?: string;
  threadId?: string;
  roomId?: string;
  conversationId?: string;
  chatEntryId?: string;
  actionId?: string;
  senderParticipantId: string;
  recipientParticipantId: string;
  recipientParticipant: ParticipantRef;
  senderEmployeeId?: string;
  recipientEmployeeId?: string;
  message: string;
  previousOwnerEmployeeId?: string;
  newOwnerEmployeeId?: string;
}

export type HandoffCompleted = ThreadVisibleMessage;

export interface ProgressReported {
  type: "progress_reported";
  channelTopicId?: string;
  threadId?: string;
  roomId?: string;
  conversationId?: string;
  chatEntryId?: string;
  actionId?: string;
  senderEmployeeId: string;
  message: string;
  phase?: string;
}

export interface AllowedActionResult<TPayload> {
  status: "allowed";
  payload: TPayload;
}

export interface DeniedActionResult {
  status: "denied";
  reason: string;
}

export type ActionResult<TPayload> =
  | AllowedActionResult<TPayload>
  | DeniedActionResult;
