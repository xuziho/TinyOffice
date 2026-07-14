import { chatUserFacingErrorMessage } from "./chatErrorMessages";

export type MentionCandidate = {
  memberId?: string;
  avatarSeed?: string;
  displayName: string;
  role?: string;
  hasRuntimeProfile?: boolean;
  supportsImageInput?: boolean;
};

export type ComposerSubmitValue = {
  body: string;
  mentionedMemberIds: string[];
  attachmentIds?: string[];
};

export function buildComposerSubmitValue(input: {
  draft: string;
  uploadedAttachmentIds: string[];
  mentionCandidates: MentionCandidate[];
  selectedMentionCandidates: MentionCandidate[];
}): ComposerSubmitValue | undefined {
  const body = input.draft.trim();
  const attachmentIds = input.uploadedAttachmentIds.filter((attachmentId) => attachmentId.trim());
  if (!body && attachmentIds.length === 0) {
    return undefined;
  }
  return {
    body,
    mentionedMemberIds: selectedMentionIds(body, [
      ...input.mentionCandidates,
      ...input.selectedMentionCandidates,
    ]),
    ...(attachmentIds.length ? { attachmentIds } : {}),
  };
}

export function composerErrorMessage(error: unknown): string {
  return chatUserFacingErrorMessage(error);
}

export function visibleMentionOptions(
  draft: string,
  candidates: MentionCandidate[],
): Array<MentionCandidate & { memberId: string }> {
  const query = activeMentionQuery(draft);
  if (query === undefined) {
    return [];
  }
  const normalizedQuery = normalize(query);
  return candidates
    .filter((candidate): candidate is MentionCandidate & { memberId: string } => {
      return Boolean(candidate.memberId?.trim() && candidate.displayName.trim() && candidate.hasRuntimeProfile !== false);
    })
    .filter((candidate) => {
      if (!normalizedQuery) {
        return true;
      }
      return normalize(candidate.displayName).includes(normalizedQuery)
        || normalize(candidate.memberId).includes(normalizedQuery)
        || normalize(candidate.role || "").includes(normalizedQuery);
    })
    .slice(0, 8);
}

export function isAllMentionOptionVisible(draft: string): boolean {
  const query = activeMentionQuery(draft);
  return query !== undefined && (query.trim() === "" || "all".includes(normalize(query)));
}

export function applyAllMentionSelection(draft: string): string {
  return applyMentionSelection(draft, { displayName: "all" });
}

export function selectedMentionIds(
  draft: string,
  candidates: MentionCandidate[],
): string[] {
  const normalizedDraft = normalizeMentionText(draft);
  const selected = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.memberId?.trim() || candidate.hasRuntimeProfile === false) {
      continue;
    }
    const label = normalizeMentionText(`@${candidate.displayName}`);
    if (normalizedDraft.includes(label)) {
      selected.add(candidate.memberId.trim());
    }
  }
  return [...selected];
}

export function applyMentionSelection(draft: string, candidate: MentionCandidate): string {
  const label = `@${candidate.displayName.trim()} `;
  const range = activeMentionRange(draft);
  if (!range) {
    return `${draft}${draft.endsWith(" ") || draft.length === 0 ? "" : " "}${label}`;
  }
  return `${draft.slice(0, range.start)}${label}${draft.slice(range.end)}`;
}

export function ensureMentionStarter(draft: string): string {
  if (activeMentionRange(draft)) {
    return draft;
  }
  return `${draft}${draft.endsWith(" ") || draft.length === 0 ? "" : " "}@`;
}

function activeMentionQuery(draft: string): string | undefined {
  const range = activeMentionRange(draft);
  return range ? draft.slice(range.start + 1, range.end) : undefined;
}

function activeMentionRange(draft: string): { start: number; end: number } | undefined {
  const atIndex = draft.lastIndexOf("@");
  if (atIndex < 0) {
    return undefined;
  }
  const tail = draft.slice(atIndex + 1);
  if (tail.includes("\n") || /[，。！？,.!?;；:：]/.test(tail)) {
    return undefined;
  }
  return { start: atIndex, end: draft.length };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeMentionText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
