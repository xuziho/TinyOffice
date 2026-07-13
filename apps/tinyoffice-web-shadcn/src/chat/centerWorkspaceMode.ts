import type { ChatShellModel } from "./chatShellModel";

export type CenterWorkspaceMode = "entry-room" | "entry-room-pending" | "draft-entry" | "entry-list";

export function centerWorkspaceMode(model: ChatShellModel): CenterWorkspaceMode {
  if (model.selectedEntry) {
    return "entry-room";
  }
  if (model.surface.kind === "entry-room") {
    return "entry-room-pending";
  }
  if (model.surface.kind === "draft-entry") {
    return "draft-entry";
  }
  return "entry-list";
}
