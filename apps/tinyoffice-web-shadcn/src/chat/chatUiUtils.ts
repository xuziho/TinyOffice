import type { MessagePage } from "tinyoffice/frontend-api-contracts";
import type { ChatShellModel, ChatShellSurface } from "./chatShellModel";

export function entryListHeaderFor(model: ChatShellModel): { title: string; subtitle: string } {
  if (model.surface.kind === "dm-directory") {
    const surface = model.surface;
    const member = model.directMessages.find((item) => item.id === surface.memberId);
    return {
      title: member?.title ?? "Direct messages",
      subtitle: member?.subtitle ?? "AI employee directory",
    };
  }
  if (model.selectedEntry) {
    const parentTitle = model.selectedContainer?.title ?? "Conversation";
    return {
      title: parentTitle,
      subtitle: formatEntryCount(model.directoryEntries.length),
    };
  }
  if (model.selectedContainer) {
    return {
      title: model.selectedContainer.title,
      subtitle: formatEntryCount(model.directoryEntries.length),
    };
  }
  return {
    title: "Entries",
    subtitle: "Select a channel or employee",
  };
}

export function messageHeaderFor(model: ChatShellModel): { title: string; subtitle?: string } {
  if (model.surface.kind === "draft-entry") {
    return {
      title: draftEntryTitleFor(model),
      subtitle: draftEntrySubtitleFor(model),
    };
  }
  if (model.selectedEntry) {
    return {
      title: threadTitleFor(model),
      subtitle: threadSubtitleFor(model),
    };
  }
  if (model.selectedContainer) {
    return {
      title: "Message stream",
      subtitle: `Select one of ${formatEntryCount(model.directoryEntries.length)}`,
    };
  }
  return {
    title: "Message stream",
    subtitle: "No entry selected",
  };
}

export function formatEntryCount(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

export function threadTitleFor(model: ChatShellModel): string {
  if (!model.selectedEntry) {
    return "Message stream";
  }
  return model.selectedEntry.title;
}

export function threadSubtitleFor(model: ChatShellModel): string | undefined {
  return model.context.room.subtitle ?? model.selectedContainer?.title;
}

export function browserTitleFor(model: ChatShellModel): string {
  if (model.surface.kind === "draft-entry") {
    return `TinyOffice - ${draftEntryTitleFor(model)}`;
  }
  if (model.selectedEntry) {
    return `TinyOffice - ${threadTitleFor(model)}`;
  }
  if (model.selectedContainer) {
    return `TinyOffice - ${model.selectedContainer.title}`;
  }
  return "TinyOffice";
}

export function activeEntryContainerId(model: ChatShellModel): string | undefined {
  if (model.surface.kind === "draft-entry") {
    return model.surface.containerId;
  }
  if (model.selectedContainer) {
    return model.selectedContainer.containerId;
  }
  if (model.surface.kind === "dm-directory") {
    const surface = model.surface;
    return surface.containerId ?? model.directMessages.find((message) => message.id === surface.memberId)?.containerId;
  }
  return undefined;
}

export function entryListScrollKey(model: ChatShellModel): string {
  return [
    model.surface.kind,
    model.selectedContainer?.containerId ?? "",
    model.surface.kind === "dm-directory" ? model.surface.memberId : "",
  ].join(":");
}

export function messageStreamScrollKey(model: ChatShellModel): string {
  if (model.surface.kind === "draft-entry") {
    return `draft:${model.surface.containerId}:${model.surface.memberId ?? ""}`;
  }
  return model.selectedRoomId ?? "";
}

export function memberDisplayNameFor(model: ChatShellModel, memberId: string | undefined): string | undefined {
  const normalized = memberId?.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized === model.viewerMemberId) {
    return model.viewerLabel;
  }
  return (
    model.context.participants.find((participant) => participant.id === normalized)?.displayName ||
    model.mentionCandidates.find((candidate) => candidate.memberId === normalized)?.displayName ||
    model.directMessages.find((message) => message.id === normalized)?.title ||
    model.directoryMembers.find((member) => member.memberId === normalized)?.displayName
  );
}

export function startEntryLabelFor(model?: ChatShellModel): string {
  const surface = model?.surface;
  if (model && surface?.kind === "dm-directory") {
    const directMessage = model.directMessages.find((message) => message.id === surface.memberId);
    return `Start new topic${directMessage?.title ? ` with ${directMessage.title}` : ""}`;
  }
  return "Start new topic";
}

export function draftEntryTitleFor(model: ChatShellModel): string {
  return `New topic with ${draftTargetNameFor(model)}`;
}

export function draftEntrySubtitleFor(model: ChatShellModel): string | undefined {
  if (model.selectedContainer?.kind === "channel") {
    return "Draft topic";
  }
  if (model.surface.kind === "draft-entry" && model.surface.memberId) {
    return "Draft direct message";
  }
  if (model.selectedContainer?.kind === "member_dm") {
    return "Draft direct message";
  }
  return "Draft topic";
}

export function emptyEntriesTextFor(model: ChatShellModel): string {
  return model.surface.kind === "dm-directory" || model.selectedContainer?.kind === "member_dm"
    ? "No chats yet."
    : "No topics yet.";
}

export function parentSurfaceFor(model: ChatShellModel): ChatShellSurface {
  if (model.surface.kind === "draft-entry") {
    if (model.selectedContainer?.kind === "channel") {
      return { kind: "container-directory", containerId: model.selectedContainer.containerId };
    }
    if (model.surface.memberId) {
      return {
        kind: "dm-directory",
        memberId: model.surface.memberId,
        containerId: model.surface.containerId,
      };
    }
    if (model.selectedContainer?.kind === "member_dm") {
      const directMessage = model.directMessages.find((item) => item.containerId === model.selectedContainer?.containerId);
      return {
        kind: "dm-directory",
        memberId: directMessage?.id ?? model.selectedContainer.containerId,
        containerId: model.selectedContainer.containerId,
      };
    }
    return { kind: "container-directory", containerId: model.surface.containerId };
  }

  if (model.selectedContainer?.kind === "channel") {
    return { kind: "container-directory", containerId: model.selectedContainer.containerId };
  }

  if (model.selectedContainer?.kind === "member_dm") {
    const directMessage = model.directMessages.find((item) => item.containerId === model.selectedContainer?.containerId);
    return {
      kind: "dm-directory",
      memberId: directMessage?.id ?? model.selectedContainer.containerId,
      containerId: model.selectedContainer.containerId,
    };
  }

  return model.surface.kind === "entry-room" ? { kind: "empty" } : model.surface;
}

function draftTargetNameFor(model: ChatShellModel): string {
  if (model.surface.kind !== "draft-entry") {
    return model.selectedContainer?.title ?? "current space";
  }
  const surface = model.surface;
  if (surface.memberId) {
    const directMessage = model.directMessages.find((message) => message.id === surface.memberId);
    if (directMessage) {
      return directMessage.title;
    }
  }
  return model.selectedContainer?.title ?? "current space";
}

export function messageAlignFor(message: MessagePage["messages"][number], model: ChatShellModel): "start" | "end" {
  if (message.sender.memberId && message.sender.memberId === model.viewerMemberId) {
    return "end";
  }
  return "start";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "T").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const elapsedMs = Math.abs(Date.now() - date.getTime());
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (elapsedMs < minuteMs) {
    return "now";
  }
  if (elapsedMs < hourMs) {
    return `${Math.round(elapsedMs / minuteMs)}m`;
  }
  if (elapsedMs < dayMs) {
    return `${Math.round(elapsedMs / hourMs)}h`;
  }
  if (elapsedMs < 7 * dayMs) {
    return `${Math.round(elapsedMs / dayMs)}d`;
  }

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
