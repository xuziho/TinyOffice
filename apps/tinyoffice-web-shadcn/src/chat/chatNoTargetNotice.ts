import { mentionedMemberIdsForChatSubmit } from "./chatMentionRouting";
import type { ComposerSubmitValue, MentionCandidate } from "./mentionComposerModel";

export const NO_TARGET_MEMBER_NOTICE = "No employee mentioned. Use @ to ask an employee to reply.";

export function noTargetMemberNoticeForChatSubmit(input: {
  value: ComposerSubmitValue;
  mentionCandidates: MentionCandidate[];
  containerKind?: string;
}): string | undefined {
  if (input.containerKind !== "channel") {
    return undefined;
  }
  if (!hasRuntimeMentionCandidate(input.mentionCandidates)) {
    return undefined;
  }
  return mentionedMemberIdsForChatSubmit(input.value, input.mentionCandidates).length === 0
    ? NO_TARGET_MEMBER_NOTICE
    : undefined;
}

function hasRuntimeMentionCandidate(candidates: MentionCandidate[]): boolean {
  return candidates.some((candidate) =>
    Boolean(candidate.memberId?.trim() && candidate.displayName.trim() && candidate.hasRuntimeProfile !== false)
  );
}
