import type { ParticipantRef } from "./participant-ref.js";

export interface ConversationActionContext {
  channelTopicId?: string;
  threadId?: string;
  roomId?: string;
  conversationId?: string;
  chatEntryId?: string;
  runtimeEmployeeId: string;
  reachableMemberIds: string[];
  reachableParticipants?: ParticipantRef[];
}
