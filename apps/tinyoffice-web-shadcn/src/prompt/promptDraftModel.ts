export type PromptDraft = {
  targetKey: string;
  persistedContent: string;
  content: string;
};

export const emptyPromptDraft: PromptDraft = {
  targetKey: "",
  persistedContent: "",
  content: "",
};

export function promptDraftValue(draft: PromptDraft, targetKey: string | undefined, persistedContent: string): string {
  if (!targetKey || draft.targetKey !== targetKey || draft.content === draft.persistedContent) {
    return persistedContent;
  }
  return draft.content;
}

export function promptDraftIsDirty(draft: PromptDraft, targetKey: string | undefined, persistedContent: string): boolean {
  return Boolean(
    targetKey
    && draft.targetKey === targetKey
    && draft.content !== draft.persistedContent
    && draft.content !== persistedContent,
  );
}

export function reconcilePromptDraft(draft: PromptDraft, targetKey: string | undefined, persistedContent: string): PromptDraft {
  if (!targetKey) {
    return emptyPromptDraft;
  }
  if (draft.targetKey !== targetKey || draft.content === draft.persistedContent) {
    return { targetKey, persistedContent, content: persistedContent };
  }
  if (draft.content === persistedContent) {
    return { ...draft, persistedContent };
  }
  return draft;
}

export function editPromptDraft(targetKey: string, persistedContent: string, content: string): PromptDraft {
  return { targetKey, persistedContent, content };
}
