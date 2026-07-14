import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import type { HandoffResult } from "../pi/read-collaboration-tool-call-log.js";
import {
  CHAT_CHANNEL_ACTIVE_TOOL_NAMES,
  CHAT_DM_ACTIVE_TOOL_NAMES,
} from "../provider/runtime-tool-contracts.js";
import { validateChannelTopicHandoffAction } from "./channel-turn-result-protocol.js";

export type ChatTurnStateActionSceneType = "dm" | "channel";

export interface ChatAssistantOutput {
  source: "assistant_message";
  message: string;
}

export interface ChatTurnStateAction {
  toolName: "handoff_topic_turn";
  recipientParticipantId: string;
  targetMemberId?: string;
  handoff: HandoffResult;
}

export type ChatTurnStateActionResolution =
  | {
      ok: true;
      stateAction?: ChatTurnStateAction;
    }
  | { ok: false; error: string };

export function buildChatTurnActiveToolNames(sceneType: ChatTurnStateActionSceneType): string[] {
  return sceneType === "channel"
    ? [...CHAT_CHANNEL_ACTIVE_TOOL_NAMES]
    : [...CHAT_DM_ACTIVE_TOOL_NAMES];
}

export function resolveChatTurnStateAction(input: {
  sceneType: ChatTurnStateActionSceneType;
  events: Array<Pick<ProcessTraceEvent, "kind" | "timestamp" | "status" | "metadata">>;
  assistantMessage: string;
  topicId?: string;
  threadId?: string;
  reachableParticipants?: ParticipantRef[];
  reachableMemberIds?: string[];
  timestamp?: string;
}): ChatTurnStateActionResolution {
  if (input.sceneType === "dm") {
    return { ok: true };
  }

  if (!input.topicId) {
    return { ok: false, error: "Channel handoff requires topicId." };
  }
  const handoffCalls = successfulToolArgumentCalls(input.events, "handoff_topic_turn");
  if (handoffCalls.length === 0) {
    return { ok: false, error: "handoff_topic_turn must be called exactly once in every Channel Topic turn." };
  }
  if (handoffCalls.length > 1) {
    return { ok: false, error: "handoff_topic_turn must be called exactly once in every Channel Topic turn." };
  }
  const args = handoffCalls[0] as Record<string, unknown>;
  const toId = stringFrom(args.toId);
  if (!toId) {
    return { ok: false, error: "handoff_topic_turn.toId is required." };
  }
  if (Object.prototype.hasOwnProperty.call(args, "message")) {
    return { ok: false, error: "handoff_topic_turn.message is not part of the Chat contract." };
  }
  if (Object.prototype.hasOwnProperty.call(args, "approvalRequest")) {
    return {
      ok: false,
      error: "handoff_topic_turn approvalRequest is retired; sensitive resource access must use Access.",
    };
  }

  const validation = validateChannelTopicHandoffAction({
    toId,
  }, {
    expectedTopicId: input.topicId,
    reachableParticipants: input.reachableParticipants || [],
    reachableMemberIds: input.reachableMemberIds || [],
    replyMessage: input.assistantMessage,
    timestamp: input.timestamp,
    threadId: input.threadId,
  });
  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    stateAction: {
      toolName: "handoff_topic_turn",
      recipientParticipantId: validation.handoff.recipientParticipantId,
      ...(validation.handoff.targetMemberId
        ? { targetMemberId: validation.handoff.targetMemberId }
        : {}),
      handoff: validation.handoff,
    },
  };
}

function successfulToolArgumentCalls(
  events: Array<Pick<ProcessTraceEvent, "kind" | "timestamp" | "status" | "metadata">>,
  toolName: string,
): Array<Record<string, unknown>> {
  const candidates = events
    .filter((event) =>
      event.kind === "model_tool_call" &&
      event.metadata?.toolName === toolName &&
      event.status === "succeeded"
    );
  return candidates
    .map((event) => event.metadata?.arguments)
    .filter((args): args is Record<string, unknown> =>
      !!args && typeof args === "object" && !Array.isArray(args)
    );
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
