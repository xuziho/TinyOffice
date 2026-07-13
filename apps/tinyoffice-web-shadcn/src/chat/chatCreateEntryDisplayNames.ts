import type { ChatShellModel } from "./chatShellModel";
import { activeEntryContainerId } from "./chatUiUtils";

export function memberDisplayNamesForCreateEntry(model: ChatShellModel): Record<string, string> | undefined {
  const surfaceMemberId = model.surface.kind === "dm-directory" || model.surface.kind === "draft-entry"
    ? model.surface.memberId
    : undefined;
  const isDirectMessageCreate =
    model.surface.kind === "dm-directory" ||
    model.selectedContainer?.kind === "member_dm" ||
    Boolean(surfaceMemberId);
  if (!isDirectMessageCreate) {
    return undefined;
  }
  const directMessage = model.directMessages.find((message) =>
    message.containerId === activeEntryContainerId(model) ||
    (surfaceMemberId !== undefined && message.id === surfaceMemberId)
  );
  if (!directMessage?.id || !directMessage.title.trim()) {
    const directoryMember = model.directoryMembers.find((member) => member.memberId === surfaceMemberId);
    return directoryMember?.displayName.trim()
      ? { [directoryMember.memberId]: directoryMember.displayName }
      : undefined;
  }
  return { [directMessage.id]: directMessage.title };
}
