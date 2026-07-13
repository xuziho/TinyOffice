import type { ChatShellModel } from "./chatShellModel";

export type ContextPanelRuntimeMode = {
  showActivityDock: boolean;
  showParticipantSessions: boolean;
};

export function contextPanelRuntimeMode(model: ChatShellModel): ContextPanelRuntimeMode {
  const hasConcreteEntryRoom = Boolean(model.selectedEntry);
  return {
    showActivityDock: hasConcreteEntryRoom,
    showParticipantSessions: hasConcreteEntryRoom,
  };
}
