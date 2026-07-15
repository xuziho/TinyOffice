export interface AccessPolicyEditorState {
  companyId: string;
  serverJson: string;
  draftJson: string;
}

export function reconcileAccessPolicyEditor(
  current: AccessPolicyEditorState | undefined,
  companyId: string,
  serverJson: string,
): AccessPolicyEditorState {
  if (!current || current.companyId !== companyId) {
    return { companyId, serverJson, draftJson: serverJson };
  }
  if (current.serverJson === serverJson) {
    return current;
  }
  return {
    companyId,
    serverJson,
    draftJson: current.draftJson === current.serverJson ? serverJson : current.draftJson,
  };
}
