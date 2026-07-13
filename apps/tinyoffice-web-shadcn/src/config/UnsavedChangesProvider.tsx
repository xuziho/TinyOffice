import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { UnsavedChangesContext, type UnsavedTransitionAction } from "./unsavedChangesContext";

export function UnsavedChangesProvider({ children }: { children: ReactNode }): ReactElement {
  const [dirtyScopes, setDirtyScopes] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<UnsavedTransitionAction>();
  const hasUnsavedChanges = dirtyScopes.size > 0;

  const setScopeDirty = useCallback((scope: string, dirty: boolean) => {
    setDirtyScopes((current) => {
      const next = new Set(current);
      if (dirty) {
        next.add(scope);
      } else {
        next.delete(scope);
      }
      return setsEqual(current, next) ? current : next;
    });
  }, []);

  const requestTransition = useCallback((action: UnsavedTransitionAction) => {
    if (hasUnsavedChanges) {
      setPendingAction(() => action);
      return;
    }
    action();
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const value = useMemo(() => ({ hasUnsavedChanges, setScopeDirty, requestTransition }), [hasUnsavedChanges, requestTransition, setScopeDirty]);
  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      <Dialog open={Boolean(pendingAction)} onOpenChange={(open) => { if (!open) setPendingAction(undefined); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Your latest edits have not been saved. Leaving now will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingAction(undefined)}>Keep editing</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const action = pendingAction;
                setPendingAction(undefined);
                action?.();
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UnsavedChangesContext.Provider>
  );
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
