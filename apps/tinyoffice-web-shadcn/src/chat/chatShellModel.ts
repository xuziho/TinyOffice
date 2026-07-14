import type {
  ChatContainerDto,
  ChatEntryDto,
  ChatRuntimeLinkDto,
  CompanyDirectoryDto,
  CompanyDirectoryMemberEntryDto,
  EmployeeRuntimeSummaryCard,
  EmployeeRuntimeSummaryViewModel,
  MessageDto,
  MessagePage,
  TasksTaskListItem,
  TasksViewModel,
  TinyOfficeCurrentSession,
} from "tinyoffice/frontend-api-contracts";
import type { MentionCandidate } from "./mentionComposerModel";
import { activeChatRunForRoom, type ChatRunRecord, type ChatRunState } from "./chatRunState";

export type ChatShellSurface =
  | { kind: "container-directory"; containerId: string }
  | { kind: "entry-room"; entryId: string }
  | { kind: "draft-entry"; containerId: string; memberId?: string }
  | { kind: "dm-directory"; memberId: string; containerId?: string }
  | { kind: "empty" };

export type ChatShellNavigationItem = {
  id: string;
  avatarSeed?: string;
  title: string;
  subtitle?: string;
  unreadCount: number;
  mentionCount: number;
  kind: "channel" | "dm";
  containerId?: string;
  runtimeStatus?: EmployeeRuntimeSummaryCard["status"];
};

export type ChatShellRoom = ChatEntryDto & { parentTitle?: string };

export type ChatShellContextRow = {
  label: string;
  value: string;
};

export type ChatShellEvidence = {
  sessions: ChatRuntimeLinkDto[];
  workRuns: ChatRuntimeLinkDto[];
  processTraces: ChatRuntimeLinkDto[];
  files: ChatRuntimeLinkDto[];
  other: ChatRuntimeLinkDto[];
};

export type ChatRelatedTask = {
  taskId: string;
  title: string;
  status: TasksTaskListItem["status"];
  ownerMemberId: string;
  sourceMessageId?: string;
  updatedAt: string;
};

export type ChatParticipantStatus = {
  kind: "replying" | "stopping";
  label: "Replying…" | "Stopping…";
};

export type ChatShellModel = {
  companyId?: string;
  viewerLabel: string;
  viewerMemberId?: string;
  surface: ChatShellSurface;
  channels: ChatShellNavigationItem[];
  directMessages: ChatShellNavigationItem[];
  directoryMembers: CompanyDirectoryMemberEntryDto[];
  employeeRuntimeSummaries: EmployeeRuntimeSummaryCard[];
  rooms: ChatShellRoom[];
  directoryEntries: ChatShellRoom[];
  archivedDirectoryEntries?: ChatShellRoom[];
  mentionCandidates: MentionCandidate[];
  imageAttachmentsEnabled: boolean;
  selectedContainer?: ChatContainerDto;
  selectedEntry?: ChatEntryDto;
  selectedRoomId?: string;
  messages: MessageDto[];
  context: {
    room: {
      kind: "workspace" | "channel" | "member-dm" | "thread";
      title: string;
      subtitle?: string;
      rows: ChatShellContextRow[];
    };
    participants: Array<{ id: string; avatarSeed: string; displayName: string; role?: string; hasRuntimeProfile?: boolean; chatStatus?: ChatParticipantStatus }>;
    evidence: ChatShellEvidence;
    runtimeLinks: ChatRuntimeLinkDto[];
    relatedTasks: ChatRelatedTask[];
  };
};

export function buildChatShellModel(input: {
  session?: TinyOfficeCurrentSession;
  projection?: ChatProjectionLike;
  directory?: CompanyDirectoryDto;
  employeeRuntimeSummary?: EmployeeRuntimeSummaryViewModel;
  chatRunState?: ChatRunState;
  tasks?: TasksViewModel;
  messages?: MessagePage;
  selectedEntryId?: string;
  selectedRoomId?: string;
  selectedSurface?: ChatShellSurface;
}): ChatShellModel {
  const companyId = input.session?.companyId ?? input.session?.currentCompanyId;
  const viewerLabel = input.session?.member?.displayName ?? input.session?.user.displayName ?? input.session?.user.id ?? "Unknown";
  const containers = input.projection?.containers ?? [];
  const entries = input.projection?.entries ?? [];
  const archivedEntries = input.projection?.archivedEntries ?? [];
  const rooms = entries.map((entry) => roomFromEntry(entry, containers));
  const employeeRuntimeSummaries = input.employeeRuntimeSummary?.employees ?? [];
  const directMessages = directMessagesFromDirectory(input.directory, containers, employeeRuntimeSummaries, input.chatRunState);
  const surface = resolveSurface(input.selectedSurface, input.selectedEntryId, input.selectedRoomId, containers, entries, directMessages);
  const selectedContainer = selectedContainerFor(surface, containers, entries, directMessages);
  const selectedEntry = surface.kind === "entry-room"
    ? entries.find((entry) => entry.entryId === surface.entryId)
    : undefined;
  const selectedRoomId = selectedEntry?.openTarget.roomId;
  const directoryEntries = selectedContainer
    ? rooms.filter((entry) => entry.parentContainerId === selectedContainer.containerId)
    : [];
  const selectedDirectoryMember = selectedDirectoryMemberFor(surface, selectedContainer, input.directory, containers);
  const runtimeLinks = selectedEntry?.runtimeLinks ?? selectedContainer?.runtimeLinks ?? [];

  return {
    companyId,
    viewerLabel,
    viewerMemberId: input.session?.member?.memberId,
    surface,
    channels: containers.filter((container) => container.kind === "channel").map(navigationItemFromContainer),
    directMessages,
    directoryMembers: input.directory?.directoryMembers ?? [],
    employeeRuntimeSummaries,
    rooms,
    directoryEntries,
    archivedDirectoryEntries: selectedContainer
      ? archivedEntries.map((entry) => roomFromEntry(entry, containers)).filter((entry) => entry.parentContainerId === selectedContainer.containerId)
      : [],
    mentionCandidates: mentionCandidatesFor(surface, selectedContainer, input.directory),
    imageAttachmentsEnabled: imageAttachmentsEnabledFor({
      surface,
      selectedContainer,
      selectedEntry,
      selectedDirectoryMember,
      directory: input.directory,
    }),
    selectedContainer,
    selectedEntry,
    selectedRoomId,
    messages: selectedEntry ? input.messages?.messages ?? [] : [],
    context: {
      room: roomContextFor({
        surface,
        selectedContainer,
        selectedEntry,
        selectedDirectoryMember,
        directoryEntries,
        companyId,
        viewerLabel,
        channelCount: containers.filter((container) => container.kind === "channel").length,
        directMessageCount: directMessages.length,
        messageCount: input.messages?.messages.length ?? 0,
      }),
      participants: participantsFor({
        surface,
        container: selectedContainer,
        selectedDirectoryMember,
        directory: input.directory,
        selectedRoomId,
        chatRunState: input.chatRunState,
      }),
      evidence: evidenceFromLinks(runtimeLinks),
      runtimeLinks,
      relatedTasks: relatedTasksFor({
        selectedEntry,
        selectedRoomId,
        tasks: input.tasks,
      }),
    },
  };
}

function relatedTasksFor(input: {
  selectedEntry?: ChatEntryDto;
  selectedRoomId?: string;
  tasks?: TasksViewModel;
}): ChatRelatedTask[] {
  const selectedRoomId = input.selectedRoomId?.trim();
  const selectedEntryId = input.selectedEntry?.entryId.trim();
  if (!selectedRoomId && !selectedEntryId) {
    return [];
  }
  return (input.tasks?.tasks ?? [])
    .filter((task) => {
      if (task.sourceKind !== "chat_request" || !task.sourceLink) {
        return false;
      }
      return (
        Boolean(selectedRoomId && task.sourceLink.conversationId === selectedRoomId) ||
        Boolean(selectedEntryId && task.sourceLink.chatEntryId === selectedEntryId)
      );
    })
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      status: task.status,
      ownerMemberId: task.ownerMemberId,
      ...(task.sourceLink?.messageId ? { sourceMessageId: task.sourceLink.messageId } : {}),
      updatedAt: task.updatedAt,
    }));
}

function mentionCandidatesFor(
  surface: ChatShellSurface,
  container: ChatContainerDto | undefined,
  directory: CompanyDirectoryDto | undefined,
): MentionCandidate[] {
  if (surface.kind !== "container-directory" && surface.kind !== "entry-room" && surface.kind !== "draft-entry") {
    return [];
  }
  if (container?.kind !== "channel") {
    return [];
  }
  return (container.members ?? [])
    .map((member) => {
      const directoryMember = directoryMemberForChannelMember(member, directory);
      return {
        memberId: member.memberId,
        avatarSeed: directoryMember?.avatarSeed,
        displayName: member.displayName,
        role: directoryMember?.role,
        hasRuntimeProfile: Boolean(member.hasRuntimeProfile && directoryMember?.hasRuntimeProfile),
        supportsImageInput: memberSupportsImageInput(
          member,
          directoryMember,
        ),
      };
    })
    .filter((candidate) => Boolean(candidate.memberId?.trim() && candidate.displayName.trim() && candidate.hasRuntimeProfile));
}

type ChatProjectionLike = {
  containers: ChatContainerDto[];
  entries: ChatEntryDto[];
  archivedEntries?: ChatEntryDto[];
};

function resolveSurface(
  selectedSurface: ChatShellSurface | undefined,
  selectedEntryId: string | undefined,
  selectedRoomId: string | undefined,
  containers: ChatContainerDto[],
  entries: ChatEntryDto[],
  directMessages: ChatShellNavigationItem[],
): ChatShellSurface {
  if (selectedSurface) {
    return selectedSurface;
  }
  if (selectedEntryId) {
    return { kind: "entry-room", entryId: selectedEntryId };
  }
  if (selectedRoomId) {
    const entry = entries.find((candidate) => candidate.openTarget.roomId === selectedRoomId);
    if (entry) {
      return { kind: "entry-room", entryId: entry.entryId };
    }
  }
  const firstChannel = containers.find((container) => container.kind === "channel");
  if (firstChannel) {
    return { kind: "container-directory", containerId: firstChannel.containerId };
  }
  const firstDirectMessage = directMessages[0];
  if (firstDirectMessage) {
    return {
      kind: "dm-directory",
      memberId: firstDirectMessage.id,
      containerId: firstDirectMessage.containerId,
    };
  }
  const firstContainer = containers[0];
  if (firstContainer) {
    if (firstContainer.kind === "member_dm") {
      return {
        kind: "dm-directory",
        memberId: firstContainer.containerId,
        containerId: firstContainer.containerId,
      };
    }
    return { kind: "container-directory", containerId: firstContainer.containerId };
  }
  return { kind: "empty" };
}

function selectedContainerFor(
  surface: ChatShellSurface,
  containers: ChatContainerDto[],
  entries: ChatEntryDto[],
  directMessages: ChatShellNavigationItem[],
): ChatContainerDto | undefined {
  if (surface.kind === "container-directory") {
    return containers.find((container) => container.containerId === surface.containerId);
  }
  if (surface.kind === "draft-entry") {
    return containers.find((container) => container.containerId === surface.containerId);
  }
  if (surface.kind === "dm-directory") {
    const containerId = surface.containerId ?? directMessages.find((message) => message.id === surface.memberId)?.containerId;
    return containerId
      ? containers.find((container) => container.containerId === containerId)
      : undefined;
  }
  if (surface.kind === "entry-room") {
    const entry = entries.find((candidate) => candidate.entryId === surface.entryId);
    return entry ? containers.find((container) => container.containerId === entry.parentContainerId) : undefined;
  }
  return undefined;
}

function roomFromEntry(entry: ChatEntryDto, containers: ChatContainerDto[]): ChatShellRoom {
  return {
    ...entry,
    parentTitle: containers.find((container) => container.containerId === entry.parentContainerId)?.title,
  };
}

function navigationItemFromContainer(container: ChatContainerDto): ChatShellNavigationItem {
  return {
    id: container.containerId,
    title: container.title,
    subtitle: container.summary,
    unreadCount: container.unreadCount,
    mentionCount: container.mentionCount,
    kind: "channel",
  };
}

function directMessagesFromDirectory(
  directory: CompanyDirectoryDto | undefined,
  containers: ChatContainerDto[],
  employeeRuntimeSummaries: EmployeeRuntimeSummaryCard[],
  chatRunState: ChatRunState | undefined,
): ChatShellNavigationItem[] {
  const chatRuntimeStatuses = chatRuntimeStatusByMember(chatRunState);
  return (directory?.directoryMembers ?? [])
    .filter((member) => member.hasRuntimeProfile)
    .map((member) => {
      const container = dmContainerForMember(member, containers);
      const runtimeSummary = employeeRuntimeSummaries.find((summary) => summary.employeeId === member.memberId);
      const runtimeStatus = mergedNavigationRuntimeStatus(runtimeSummary?.status, chatRuntimeStatuses.get(member.memberId));
      return {
        id: member.memberId,
        avatarSeed: member.avatarSeed,
        title: member.displayName,
        subtitle: navigationSubtitleFor(runtimeStatus, member.role),
        unreadCount: container?.unreadCount ?? 0,
        mentionCount: container?.mentionCount ?? 0,
        kind: "dm" as const,
        containerId: container?.containerId ?? dmContainerIdForMember(member),
        runtimeStatus,
      };
    });
}

function chatRuntimeStatusByMember(chatRunState: ChatRunState | undefined): Map<string, EmployeeRuntimeSummaryCard["status"]> {
  const statuses = new Map<string, EmployeeRuntimeSummaryCard["status"]>();
  const sequences = new Map<string, number>();
  for (const run of Object.values(chatRunState?.runs ?? {})) {
    if (["completed", "canceled", "failed"].includes(run.status)) {
      continue;
    }
    if ((sequences.get(run.targetMemberId) ?? -1) > run.sequence) {
      continue;
    }
    sequences.set(run.targetMemberId, run.sequence);
    statuses.set(run.targetMemberId, {
      kind: "working",
      label: "Replying",
      reason: "Responding in Chat.",
    });
  }
  return statuses;
}

function mergedNavigationRuntimeStatus(
  summaryStatus: EmployeeRuntimeSummaryCard["status"] | undefined,
  chatStatus: EmployeeRuntimeSummaryCard["status"] | undefined,
): EmployeeRuntimeSummaryCard["status"] | undefined {
  if (!chatStatus) {
    return summaryStatus;
  }
  if (summaryStatus?.kind === "blocked" || summaryStatus?.kind === "needs_approval") {
    return summaryStatus;
  }
  return chatStatus;
}

function navigationSubtitleFor(
  status: EmployeeRuntimeSummaryCard["status"] | undefined,
  fallback: string | undefined,
): string | undefined {
  if (!status || status.kind === "idle") {
    return fallback;
  }
  if (status.kind === "needs_approval") {
    return "Needs approval";
  }
  if (status.kind === "blocked") {
    return "Blocked";
  }
  if (status.label === "Replying") {
    return "Replying...";
  }
  return "Working...";
}

function dmContainerIdForMember(member: CompanyDirectoryMemberEntryDto): string {
  return `chat-container-member-dm-${member.memberId}`;
}

function dmContainerForMember(member: CompanyDirectoryMemberEntryDto, containers: ChatContainerDto[]): ChatContainerDto | undefined {
  return containers.find((container) => container.kind === "member_dm" && container.containerId === dmContainerIdForMember(member));
}

function selectedDirectoryMemberFor(
  surface: ChatShellSurface,
  container: ChatContainerDto | undefined,
  directory: CompanyDirectoryDto | undefined,
  containers: ChatContainerDto[],
): CompanyDirectoryMemberEntryDto | undefined {
  const members = directory?.directoryMembers ?? [];
  if (surface.kind === "dm-directory") {
    return members.find((member) => member.memberId === surface.memberId);
  }
  if (surface.kind === "draft-entry" && surface.memberId) {
    return members.find((member) => member.memberId === surface.memberId);
  }
  if (container?.kind === "member_dm") {
    return members.find((member) => dmContainerForMember(member, containers)?.containerId === container.containerId);
  }
  return undefined;
}

function participantsFor(input: {
  surface: ChatShellSurface;
  container?: ChatContainerDto;
  selectedDirectoryMember?: CompanyDirectoryMemberEntryDto;
  directory?: CompanyDirectoryDto;
  selectedRoomId?: string;
  chatRunState?: ChatRunState;
}): ChatShellModel["context"]["participants"] {
  if ((input.surface.kind === "dm-directory" || input.container?.kind === "member_dm") && input.selectedDirectoryMember) {
    return [];
  }
  if (input.surface.kind === "entry-room" && input.container?.kind === "member_dm") {
    return [];
  }
  if (input.container?.members?.length) {
    const activeRun = input.chatRunState
      ? activeChatRunForRoom(input.chatRunState, input.selectedRoomId)
      : undefined;
    return input.container.members.map((member) => {
      const directoryMember = directoryMemberForChannelMember(member, input.directory);
      const chatStatus = activeRun?.targetMemberId === member.memberId
        ? participantStatusForRun(activeRun.status)
        : undefined;
      return {
        id: member.memberId,
        avatarSeed: member.avatarSeed ?? directoryMember?.avatarSeed ?? member.memberId,
        displayName: member.displayName,
        role: member.role ?? directoryMember?.role,
        hasRuntimeProfile: Boolean(member.hasRuntimeProfile && directoryMember?.hasRuntimeProfile),
        ...(chatStatus ? { chatStatus } : {}),
      };
    });
  }
  return [];
}

function participantStatusForRun(status: ChatRunRecord["status"]): ChatParticipantStatus {
  return status === "cancel_requested"
    ? { kind: "stopping", label: "Stopping…" }
    : { kind: "replying", label: "Replying…" };
}

function imageAttachmentsEnabledFor(input: {
  surface: ChatShellSurface;
  selectedContainer?: ChatContainerDto;
  selectedEntry?: ChatEntryDto;
  selectedDirectoryMember?: CompanyDirectoryMemberEntryDto;
  directory?: CompanyDirectoryDto;
}): boolean {
  if (input.surface.kind === "empty") {
    return false;
  }
  if (input.selectedContainer?.kind === "member_dm" || input.surface.kind === "dm-directory" || (input.surface.kind === "draft-entry" && input.surface.memberId)) {
    return memberSupportsImageInput(input.selectedDirectoryMember, undefined);
  }
  const members = input.selectedContainer?.members ?? [];
  const runtimeMembers = members.filter((member) =>
    member.hasRuntimeProfile && input.directory?.directoryMembers.some((directoryMember) =>
      directoryMember.memberId === member.memberId && directoryMember.hasRuntimeProfile
    )
  );
  if (runtimeMembers.length === 0) {
    return false;
  }
  return runtimeMembers.some((member) => memberSupportsImageInput(
    member,
    input.directory?.directoryMembers.find((directoryMember) =>
      directoryMember.memberId === member.memberId
    ),
  ));
}

function memberSupportsImageInput(
  member: {
    runtimeCapability?: CompanyDirectoryMemberEntryDto["runtimeCapability"];
    hasRuntimeProfile?: boolean;
    memberId?: string;
  } | undefined,
  directoryMember: CompanyDirectoryMemberEntryDto | undefined,
): boolean {
  if (member?.hasRuntimeProfile === false) {
    return false;
  }
  return Boolean(
    member?.runtimeCapability?.model.supportsImageInput ||
    directoryMember?.runtimeCapability?.model.supportsImageInput,
  );
}

function directoryMemberForChannelMember(
  member: { memberId?: string },
  directory: CompanyDirectoryDto | undefined,
): CompanyDirectoryMemberEntryDto | undefined {
  return directory?.directoryMembers.find((directoryMember) =>
    directoryMember.memberId === member.memberId
  );
}

function roomContextFor(input: {
  surface: ChatShellSurface;
  selectedContainer?: ChatContainerDto;
  selectedEntry?: ChatEntryDto;
  selectedDirectoryMember?: CompanyDirectoryMemberEntryDto;
  directoryEntries: ChatShellRoom[];
  companyId?: string;
  viewerLabel: string;
  channelCount: number;
  directMessageCount: number;
  messageCount: number;
}): ChatShellModel["context"]["room"] {
  if (input.selectedEntry) {
    return {
      kind: "thread",
      title: input.selectedEntry.title,
      subtitle: input.selectedDirectoryMember?.displayName ?? input.selectedContainer?.title,
      rows: compactRows([
        row("Last active", input.selectedEntry.updatedAt),
        row("Messages", String(input.messageCount)),
        input.selectedEntry.summary ? row("Summary", input.selectedEntry.summary) : undefined,
        input.selectedEntry.unreadCount > 0 ? row("Unread", String(input.selectedEntry.unreadCount)) : undefined,
      ]),
    };
  }
  if (input.selectedContainer) {
    const lastActive = lastActiveFromEntries(input.directoryEntries);
    if (input.selectedContainer.kind === "member_dm") {
      const member = input.selectedDirectoryMember;
      return {
        kind: "member-dm",
        title: member?.displayName ?? input.selectedContainer.title,
        subtitle: member?.role,
        rows: compactRows([
          member?.summary ? row("Summary", member.summary) : undefined,
          row("Topics", String(input.selectedContainer.entryCount)),
          lastActive ? row("Last active", lastActive) : undefined,
          input.selectedContainer.unreadCount > 0 ? row("Unread", String(input.selectedContainer.unreadCount)) : undefined,
        ]),
      };
    }
    return {
      kind: "channel",
      title: input.selectedContainer.title,
      subtitle: input.selectedContainer.summary,
      rows: compactRows([
        lastActive ? row("Last active", lastActive) : undefined,
        input.selectedContainer.unreadCount > 0 ? row("Unread", String(input.selectedContainer.unreadCount)) : undefined,
      ]),
    };
  }
  if (input.surface.kind === "draft-entry" && input.surface.memberId && input.selectedDirectoryMember) {
    const member = input.selectedDirectoryMember;
    return {
      kind: "member-dm",
      title: member.displayName,
      subtitle: member.role,
      rows: compactRows([
        member.summary ? row("Summary", member.summary) : undefined,
        row("Topics", "0"),
      ]),
    };
  }
  if (input.surface.kind === "dm-directory" && input.selectedDirectoryMember) {
    const member = input.selectedDirectoryMember;
    return {
      kind: "member-dm",
      title: member.displayName,
      subtitle: member.role,
      rows: compactRows([
        member.summary ? row("Summary", member.summary) : undefined,
        row("Topics", "0"),
      ]),
    };
  }
  return {
    kind: "workspace",
    title: "Workspace",
    subtitle: input.companyId,
    rows: compactRows([
      input.companyId ? row("Company", input.companyId) : undefined,
      row("Current user", input.viewerLabel),
      row("Channels", String(input.channelCount)),
      row("Direct messages", String(input.directMessageCount)),
    ]),
  };
}

function row(label: string, value: string): ChatShellContextRow {
  return { label, value };
}

function compactRows(rows: Array<ChatShellContextRow | undefined>): ChatShellContextRow[] {
  return rows.filter((candidate): candidate is ChatShellContextRow => candidate !== undefined && candidate.value.trim().length > 0);
}

function lastActiveFromEntries(entries: ChatShellRoom[]): string | undefined {
  return entries
    .map((entry) => entry.updatedAt)
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function evidenceFromLinks(links: ChatRuntimeLinkDto[]): ChatShellEvidence {
  const sessionLinks = uniqueLinksByTarget(links.filter((link) => link.targetKind === "session"));
  return {
    sessions: sessionLinks,
    workRuns: links.filter((link) => link.targetKind === "work_run"),
    processTraces: links.filter((link) => link.targetKind === "process_trace"),
    files: links.filter((link) => link.targetKind === "attachment"),
    other: links.filter((link) => !["session", "session_event", "work_run", "process_trace", "attachment"].includes(link.targetKind)),
  };
}

function uniqueLinksByTarget(links: ChatRuntimeLinkDto[]): ChatRuntimeLinkDto[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.targetKind}:${link.targetId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
