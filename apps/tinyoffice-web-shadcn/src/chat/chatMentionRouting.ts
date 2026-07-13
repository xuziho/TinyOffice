import { selectedMentionIds, type ComposerSubmitValue, type MentionCandidate } from "./mentionComposerModel";

export function mentionedMemberIdsForChatSubmit(
  value: ComposerSubmitValue,
  mentionCandidates: MentionCandidate[],
): string[] {
  return uniqueIds([
    ...value.mentionedMemberIds,
    ...selectedMentionIds(value.body, mentionCandidates),
  ]);
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
