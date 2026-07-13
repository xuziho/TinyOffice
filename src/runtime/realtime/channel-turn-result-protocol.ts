import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import type { HandoffResult } from "../pi/read-collaboration-tool-call-log.js";

export interface ChannelTopicHandoffAction {
  toId: string;
}

export type BoundChannelTopicHandoffAction = ChannelTopicHandoffAction & { topicId: string };

export type ChannelTopicHandoffActionValidationResult =
  | {
      ok: true;
      result: BoundChannelTopicHandoffAction;
      handoff: HandoffResult;
    }
  | { ok: false; error: string };

export function validateChannelTopicHandoffAction(
  action: ChannelTopicHandoffAction,
  input: {
    expectedTopicId: string;
    reachableParticipants: ParticipantRef[];
    reachableMemberIds: string[];
    replyMessage: string;
    timestamp?: string;
    threadId?: string;
  },
): ChannelTopicHandoffActionValidationResult {
  const participant = input.reachableParticipants.find((candidate) => candidate.id === action.toId);
  if (!participant) {
    return {
      ok: false,
      error: `Channel topic handoff target ${action.toId} is not reachable in this Topic.`,
    };
  }

  if (!input.replyMessage.trim()) {
    return { ok: false, error: "Channel topic handoff requires a visible assistant reply." };
  }

  const boundResult = {
    ...action,
    topicId: input.expectedTopicId,
  };

  return {
    ok: true,
    result: boundResult,
    handoff: {
      timestamp: input.timestamp || new Date().toISOString(),
      channelTopicId: input.expectedTopicId,
      threadId: input.threadId || "",
      recipientParticipantId: action.toId,
      recipientParticipant: participant,
      targetMemberId: input.reachableMemberIds.includes(action.toId)
        ? action.toId
        : undefined,
      message: input.replyMessage,
    },
  };
}
