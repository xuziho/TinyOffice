export type SkillEditorState = { identity: string; content: string; baseline: string };

export function hydrateSkillEditor(current: SkillEditorState, identity: string, serverContent: string): SkillEditorState {
  if (current.identity !== identity || (current.content === current.baseline && current.baseline !== serverContent)) {
    return { identity, content: serverContent, baseline: serverContent };
  }
  return current;
}
