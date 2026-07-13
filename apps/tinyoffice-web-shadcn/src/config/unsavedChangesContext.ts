import { createContext, useContext, useEffect } from "react";

export type UnsavedTransitionAction = () => void;

export interface UnsavedChangesContextValue {
  hasUnsavedChanges: boolean;
  setScopeDirty(scope: string, dirty: boolean): void;
  requestTransition(action: UnsavedTransitionAction): void;
}

export const UnsavedChangesContext = createContext<UnsavedChangesContextValue | undefined>(undefined);

export function useUnsavedChanges(scope: string, dirty: boolean): void {
  const { setScopeDirty } = useRequiredUnsavedChangesContext();
  useEffect(() => {
    setScopeDirty(scope, dirty);
    return () => setScopeDirty(scope, false);
  }, [dirty, scope, setScopeDirty]);
}

export function useUnsavedChangesNavigation(): Pick<UnsavedChangesContextValue, "hasUnsavedChanges" | "requestTransition"> {
  const { hasUnsavedChanges, requestTransition } = useRequiredUnsavedChangesContext();
  return { hasUnsavedChanges, requestTransition };
}

function useRequiredUnsavedChangesContext(): UnsavedChangesContextValue {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    throw new Error("UnsavedChangesProvider is required");
  }
  return context;
}
