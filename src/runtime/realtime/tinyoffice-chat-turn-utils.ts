import type { ConversationDto } from "../../collaboration/contracts/conversation-message-contract.js";
import type { ChatTurnStateActionSceneType } from "./chat-turn-state-action.js";
import type { TinyOfficeChatTurnDispatchSceneType } from "./tinyoffice-chat-dispatch-decision.js";
import type { TinyOfficeChatRoomContext } from "./tinyoffice-chat-room-context.js";

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function trimRequired(value: string | undefined, fieldName: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

export function participantMemberIds(conversation: Pick<ConversationDto, "participants">): string[] {
  return uniqueStrings(
    conversation.participants
      .map((participant) => participant.memberId)
      .filter((memberId): memberId is string => Boolean(memberId)),
  );
}

export function finalOutputSceneTypeFromChatScene(
  sceneType: TinyOfficeChatTurnDispatchSceneType,
): ChatTurnStateActionSceneType {
  return sceneType === "chat_direct_room" ? "dm" : "channel";
}

export function finalOutputReachableParticipants(context: TinyOfficeChatRoomContext) {
  return context.conversation.handoffCandidates;
}
