import assert from "node:assert/strict";
import test from "node:test";

import type {
  ChatProjectionPage,
  CompanyDirectoryDto,
  MessagePage,
  TasksViewModel,
  TinyOfficeCurrentSession,
} from "tinyoffice/frontend-api-contracts";
import { buildChatShellModel, isDirectMessageNavigationItemSelected } from "./chatShellModel";
import { activeEntryContainerId, entryListHeaderFor, formatEntryCount, formatRelativeTime, memberDisplayNameFor, threadSubtitleFor } from "./chatUiUtils";

const session: TinyOfficeCurrentSession = {
  schema: "tinyoffice-current-session",
  version: 2,
  user: { id: "xuziho", displayName: "Xu Ziho" },
  currentCompanyId: "ziho-co",
  companyId: "ziho-co",
  member: { memberId: "xuziho", displayName: "Xu Ziho", role: "boss" },
  needsProfileInitialization: false,
  needsCompanyInitialization: false,
};

test("directory-only direct messages remain selected before a chat container exists", () => {
  assert.equal(isDirectMessageNavigationItemSelected({
    surface: { kind: "dm-directory", memberId: "lina", containerId: "dm:xuziho:lina" },
    item: { id: "lina", containerId: "dm:xuziho:lina" },
  }), true);
  assert.equal(isDirectMessageNavigationItemSelected({
    surface: { kind: "dm-directory", memberId: "mira", containerId: "dm:xuziho:mira" },
    item: { id: "lina", containerId: "dm:xuziho:lina" },
  }), false);
});

const projection: ChatProjectionPage = {
  containers: [
    {
      schema: "chat-container",
      version: 1,
      companyId: "ziho-co",
      containerId: "channel-general",
      kind: "channel",
      title: "General",
      unreadCount: 2,
      mentionCount: 1,
      entryCount: 1,
      runtimeLinks: [],
      members: [
        {
          schema: "chat-channel-member",
          version: 1,
          companyId: "ziho-co",
          chatChannelId: "channel-general",
          memberId: "xuziho",
          displayName: "Xu Ziho",
          hasRuntimeProfile: false,
          joinedAt: "2026-07-01T00:00:00.000Z",
        },
        {
          schema: "chat-channel-member",
          version: 1,
          companyId: "ziho-co",
          chatChannelId: "channel-general",
          memberId: "lena-analytics",
          displayName: "Lena Analytics",
          hasRuntimeProfile: true,
          joinedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    },
    {
      schema: "chat-container",
      version: 1,
      companyId: "ziho-co",
      containerId: "chat-container-member-dm-employee-hr",
      kind: "member_dm",
      title: "HR",
      unreadCount: 0,
      mentionCount: 0,
      entryCount: 1,
      runtimeLinks: [],
    },
  ],
  entries: [
    {
      schema: "chat-entry",
      version: 1,
      companyId: "ziho-co",
      entryId: "entry-general-1",
      kind: "channel_topic",
      parentContainerId: "channel-general",
      title: "Daily ops",
      titleStatus: "manual",
      unreadCount: 2,
      mentionCount: 1,
      openTarget: { kind: "topic_room", roomId: "room-general-1" },
      runtimeLinks: [
        { schema: "chat-runtime-link", version: 1, companyId: "ziho-co", linkId: "session-1", targetKind: "session", targetId: "runtime-session-1", label: "Owned Chat employee reply", createdAt: "2026-07-01T00:00:00.000Z" },
        { schema: "chat-runtime-link", version: 1, companyId: "ziho-co", linkId: "session-1-duplicate", targetKind: "session", targetId: "runtime-session-1", label: "Owned Chat employee reply", createdAt: "2026-07-01T00:00:00.000Z" },
        { schema: "chat-runtime-link", version: 1, companyId: "ziho-co", linkId: "session-event-1", targetKind: "session_event", targetId: "runtime-session-1:event-1", label: "Session event", createdAt: "2026-07-01T00:00:00.000Z" },
        { schema: "chat-runtime-link", version: 1, companyId: "ziho-co", linkId: "trace-1", targetKind: "process_trace", targetId: "trace-1", label: "Trace", createdAt: "2026-07-01T00:00:00.000Z" },
      ],
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
  ],
};

const directory: CompanyDirectoryDto = {
  schema: "company-directory",
  version: 1,
  companyId: "ziho-co",
  directoryMembers: [
    {
      schema: "company-directory-member-entry",
      version: 1,
      companyId: "ziho-co",
      memberId: "employee-hr",
      avatarSeed: "employee-hr",
      selector: { kind: "member", memberId: "employee-hr" },
      employeeId: "legacy-hr",
      displayName: "Mira HR",
      role: "HR",
      hasRuntimeProfile: true,
      runtimeCapability: {
        presenceMode: "resident",
        model: {
          provider: "pi",
          id: "qwen",
          thinkingLevel: "medium",
          input: ["text", "image"],
          supportsImageInput: true,
        },
      },
    },
    {
      schema: "company-directory-member-entry",
      version: 1,
      companyId: "ziho-co",
      memberId: "lena-analytics",
      avatarSeed: "lena-analytics",
      selector: { kind: "member", memberId: "lena-analytics" },
      displayName: "Lena Analytics",
      role: "analytics",
      hasRuntimeProfile: true,
    },
  ],
};

const messages: MessagePage = {
  messages: [
    {
      schema: "message",
      version: 1,
      companyId: "ziho-co",
      conversationId: "room-general-1",
      messageId: "message-1",
      sender: { participantId: "p1", participantKind: "company_member", memberId: "xuziho", displayName: "Xu Ziho" },
      body: "Review today's runtime queue.",
      mentions: [],
      attachments: [],
      runtimeLinks: [],
      createdAt: "2026-07-01T01:00:00.000Z",
      deliveryState: "sent",
    },
  ],
};

function tasksViewModel(): TasksViewModel {
  return {
    contract: { name: "tasks", version: 3, productBoundary: "task-aggregate" },
    routes: {
      htmlPath: "/tasks",
      viewModelJsonPath: "/api/companies/ziho-co/tasks/view-model",
    },
    refresh: { indexIntervalMs: 5000, detailIntervalMs: 3000 },
    filters: { view: "tasks", status: "all", sort: "recent" },
    statusOptions: [],
    sortOptions: [],
    summary: {
      runningRunCount: 0,
      blockedRunCount: 0,
      dispatchFailedCount: 0,
      activeTaskCount: 1,
      enabledScheduleCount: 0,
      participantInputCount: 0,
    },
    tasks: [
      {
        id: "work-task-source-room",
        title: "Publish launch checklist",
        status: "active",
        ownerMemberId: "lena-analytics",
        sourceKind: "chat_request",
        updatedAt: "2026-07-01T02:00:00.000Z",
        acceptanceCriteria: "Checklist is published.",
        revision: 1,
        nextStep: "Ready to run.",
        sourceLink: {
          kind: "conversation-message",
          href: "/app/tasks/source/chat-message/room-general-1%3Amessage-1",
          label: "Message message-1",
          conversationId: "room-general-1",
          messageId: "message-1",
          chatEntryId: "entry-general-1",
        },
        schedule: { kind: "none", runCount: 0 },
        executionCount: 0,
      },
      {
        id: "work-task-other-room",
        title: "Other room task",
        status: "active",
        ownerMemberId: "employee-hr",
        sourceKind: "chat_request",
        updatedAt: "2026-07-01T02:00:00.000Z",
        acceptanceCriteria: "Other room task is done.",
        revision: 1,
        nextStep: "Ready to run.",
        sourceLink: {
          kind: "conversation",
          href: "/app/tasks/source/chat-conversation/room-other",
          label: "Conversation room-other",
          conversationId: "room-other",
        },
        schedule: { kind: "none", runCount: 0 },
        executionCount: 0,
      },
    ],
    selected: { kind: undefined },
    recentOperatingEvents: [],
  };
}

test("builds a selected entry-room chat shell model from TinyOffice API DTOs", () => {
  const model = buildChatShellModel({
    session,
    projection,
    directory,
    messages,
    selectedSurface: { kind: "entry-room", entryId: "entry-general-1" },
  });

  assert.equal(model.companyId, "ziho-co");
  assert.equal(model.viewerLabel, "Xu Ziho");
  assert.deepEqual(model.channels.map((channel) => channel.title), ["General"]);
  assert.deepEqual(model.directMessages.map((dm) => dm.title), ["Mira HR", "Lena Analytics"]);
  assert.deepEqual(model.rooms.map((room) => room.title), ["Daily ops"]);
  assert.equal(model.surface.kind, "entry-room");
  assert.equal(model.selectedEntry?.title, "Daily ops");
  assert.equal(model.selectedRoomId, "room-general-1");
  assert.equal(model.messages[0]?.body, "Review today's runtime queue.");
  assert.equal(model.context.room.kind, "thread");
  assert.equal(model.context.room.title, "Daily ops");
  assert.equal(model.context.room.subtitle, "General");
  assert.equal(model.context.room.rows.some((row) => row.label === "Room"), false);
  assert.equal(model.context.room.rows.some((row) => row.label === "Last active"), true);
  assert.equal(model.context.participants.some((participant) => participant.displayName === "Lena Analytics" && participant.role === "analytics"), true);
  assert.equal(model.context.participants.some((participant) => participant.role === "member"), false);
  assert.deepEqual(model.mentionCandidates.map((candidate) => [candidate.memberId, candidate.displayName]), [["lena-analytics", "Lena Analytics"]]);
  assert.deepEqual(model.context.evidence.sessions.map((link) => link.targetId), ["runtime-session-1"]);
  assert.equal(model.context.evidence.processTraces[0]?.label, "Trace");
});

test("keeps inactive historical Channel members visible but removes their active Chat actions", () => {
  const historicalProjection = {
    ...projection,
    containers: projection.containers.map((container) => container.kind !== "channel" ? container : {
      ...container,
      members: container.members?.map((member) => member.memberId !== "lena-analytics" ? member : {
        ...member,
        avatarSeed: "lena-persisted-avatar",
        displayName: "Lena Current",
        role: "analytics",
        hasRuntimeProfile: false,
      }),
    }),
  };
  const inactiveDirectory = {
    ...directory,
    directoryMembers: directory.directoryMembers.filter((member) => member.memberId !== "lena-analytics"),
  };
  const model = buildChatShellModel({
    session,
    projection: historicalProjection,
    directory: inactiveDirectory,
    messages,
    selectedSurface: { kind: "entry-room", entryId: "entry-general-1" },
  });

  const historicalParticipant = model.context.participants.find((participant) => participant.id === "lena-analytics");
  assert.equal(historicalParticipant?.avatarSeed, "lena-persisted-avatar");
  assert.equal(historicalParticipant?.displayName, "Lena Current");
  assert.equal(historicalParticipant?.role, "analytics");
  assert.equal(historicalParticipant?.hasRuntimeProfile, false);
  assert.equal(model.mentionCandidates.some((candidate) => candidate.memberId === "lena-analytics"), false);
  assert.equal(model.imageAttachmentsEnabled, false);
});

test("projects Tasks created from the selected Chat room as related tasks", () => {
  const model = buildChatShellModel({
    session,
    projection,
    directory,
    messages,
    tasks: tasksViewModel(),
    selectedSurface: { kind: "entry-room", entryId: "entry-general-1" },
  });

  assert.deepEqual(
    model.context.relatedTasks.map((task) => [task.taskId, task.title, task.status, task.ownerMemberId]),
    [["work-task-source-room", "Publish launch checklist", "active", "lena-analytics"]],
  );
});

test("builds a selected entry-room chat shell model from a requested room id", () => {
  const model = buildChatShellModel({
    session,
    projection,
    directory,
    messages,
    selectedRoomId: "room-general-1",
  });

  assert.equal(model.surface.kind, "entry-room");
  assert.equal(model.selectedEntry?.entryId, "entry-general-1");
  assert.equal(model.selectedRoomId, "room-general-1");
  assert.equal(model.messages[0]?.body, "Review today's runtime queue.");
});

test("builds a container directory surface when a channel container is selected", () => {
  const model = buildChatShellModel({ session, projection, directory, selectedSurface: { kind: "container-directory", containerId: "channel-general" } });

  assert.equal(model.surface.kind, "container-directory");
  assert.equal(model.selectedContainer?.title, "General");
  assert.deepEqual(model.directoryEntries.map((entry) => entry.title), ["Daily ops"]);
  assert.equal(model.context.room.kind, "channel");
  assert.equal(model.context.room.title, "General");
  assert.equal(model.context.room.rows.some((row) => row.label === "Channel ID"), false);
  assert.equal(model.context.room.rows.some((row) => row.label === "Purpose"), false);
  assert.equal(model.context.room.rows.some((row) => row.label === "Topics"), false);
  assert.equal(model.context.room.rows.some((row) => row.label === "Members"), false);
  assert.equal(model.context.room.rows.some((row) => row.label === "Last active"), true);
  assert.equal(model.context.room.rows.some((row) => row.label === "Your role"), false);
  assert.equal(model.context.participants.some((participant) => participant.displayName === "Lena Analytics" && participant.role === "analytics"), true);
  assert.equal(model.context.participants.some((participant) => participant.role === "member"), false);
  assert.deepEqual(model.mentionCandidates.map((candidate) => [candidate.memberId, candidate.displayName]), [["lena-analytics", "Lena Analytics"]]);
  assert.equal(model.messages.length, 0);
});

test("defaults to a top-level directory surface instead of opening a room directly", () => {
  const model = buildChatShellModel({ session, projection, directory, messages });

  assert.equal(model.surface.kind, "container-directory");
  assert.equal(model.selectedContainer?.title, "General");
  assert.equal(model.selectedEntry, undefined);
  assert.equal(model.selectedRoomId, undefined);
  assert.equal(model.messages.length, 0);
  assert.deepEqual(model.directoryEntries.map((entry) => entry.title), ["Daily ops"]);
});

test("maps member DM contacts to their container entries", () => {
  const model = buildChatShellModel({
    session,
    projection,
    directory,
    selectedSurface: { kind: "dm-directory", memberId: "employee-hr" },
  });

  assert.equal(model.surface.kind, "dm-directory");
  assert.equal(model.selectedContainer?.title, "HR");
  assert.equal(model.directMessages[0]?.containerId, "chat-container-member-dm-employee-hr");
  assert.deepEqual(model.directoryEntries.map((entry) => entry.title), []);
  assert.equal(model.context.room.kind, "member-dm");
  assert.equal(model.context.room.title, "Mira HR");
  assert.deepEqual(entryListHeaderFor(model), { title: "Mira HR", subtitle: "HR" });
  assert.equal(model.context.room.rows.some((row) => row.label === "Role"), false);
  assert.equal(model.context.room.rows.some((row) => row.label === "Runtime profile"), false);
  assert.equal(model.context.room.rows.some((row) => row.label === "Presence"), false);
  assert.equal(model.context.room.rows.some((row) => row.label === "Model"), false);
  assert.equal(model.imageAttachmentsEnabled, true);
  assert.deepEqual(model.context.participants, []);
  assert.equal(memberDisplayNameFor(model, "employee-hr"), "Mira HR");
  assert.equal(memberDisplayNameFor(model, "missing-member"), undefined);
});

test("formats entry counts with correct singular and plural labels", () => {
  assert.equal(formatEntryCount(0), "0 entries");
  assert.equal(formatEntryCount(1), "1 entry");
  assert.equal(formatEntryCount(2), "2 entries");
});

test("overlays active Chat reply state onto direct message contacts", () => {
  const model = buildChatShellModel({
    session,
    projection,
    directory,
    employeeRuntimeSummary: {
      contract: {
        name: "employee-runtime-summary",
        version: 1,
        productBoundary: "chat-employee-context-runtime-summary",
      },
      routes: {
        summaryJsonPath: "/api/companies/ziho-co/employees/runtime-summary",
      },
      generatedAt: "2026-07-01T00:00:00.000Z",
      employees: [{
        employeeId: "employee-hr",
        displayName: "Mira HR",
        role: "HR",
        status: {
          kind: "idle",
          label: "Idle",
          reason: "No current work.",
        },
        counts: {
          pendingApprovalCount: 0,
          blockedWorkRunCount: 0,
          activeWorkRunCount: 0,
          activeTaskCount: 0,
          recentFailureCount: 0,
        },
        current: [],
        issues: [],
      }],
    },
    chatRunState: {
      runs: {
        "run-1": {
          companyId: "ziho-co",
          conversationId: "room-general-1",
          roomId: "room-general-1",
          runId: "run-1",
          chainId: "run-1",
          sourceMessageId: "message-1",
          targetMemberId: "employee-hr",
          status: "thinking",
          streamedContent: "",
          sequence: 2,
        },
      },
    },
  });

  assert.equal(model.directMessages[0]?.runtimeStatus?.kind, "working");
  assert.equal(model.directMessages[0]?.runtimeStatus?.label, "Replying");
  assert.equal(model.directMessages[0]?.runtimeStatus?.reason, "Responding in Chat.");
  assert.equal(model.directMessages[0]?.subtitle, "Replying...");
});

test("marks only the current Topic holder as replying in Channel participants", () => {
  const model = buildChatShellModel({
    session,
    projection,
    directory,
    selectedSurface: { kind: "entry-room", entryId: "entry-general-1" },
    chatRunState: {
      runs: {
        "run-current-topic": {
          companyId: "ziho-co",
          conversationId: "room-general-1",
          roomId: "room-general-1",
          runId: "run-current-topic",
          chainId: "chain-current-topic",
          sourceMessageId: "message-1",
          targetMemberId: "lena-analytics",
          status: "streaming",
          streamedContent: "Reviewing the queue",
          sequence: 4,
        },
        "run-other-room": {
          companyId: "ziho-co",
          conversationId: "room-other",
          roomId: "room-other",
          runId: "run-other-room",
          chainId: "chain-other-room",
          sourceMessageId: "message-other",
          targetMemberId: "xuziho",
          status: "thinking",
          streamedContent: "",
          sequence: 9,
        },
      },
    },
  });

  assert.deepEqual(model.context.participants.find((participant) => participant.id === "lena-analytics")?.chatStatus, {
    kind: "replying",
    label: "Replying…",
  });
  assert.equal(model.context.participants.find((participant) => participant.id === "xuziho")?.chatStatus, undefined);
});

test("shows Stopping only for a cancel-requested current Topic holder", () => {
  const model = buildChatShellModel({
    session,
    projection,
    directory,
    selectedSurface: { kind: "entry-room", entryId: "entry-general-1" },
    chatRunState: {
      runs: {
        "run-current-topic": {
          companyId: "ziho-co",
          conversationId: "room-general-1",
          roomId: "room-general-1",
          runId: "run-current-topic",
          chainId: "chain-current-topic",
          sourceMessageId: "message-1",
          targetMemberId: "lena-analytics",
          status: "cancel_requested",
          streamedContent: "",
          sequence: 5,
        },
      },
    },
  });

  assert.deepEqual(model.context.participants.find((participant) => participant.id === "lena-analytics")?.chatStatus, {
    kind: "stopping",
    label: "Stopping…",
  });
});

test("formats Topic activity as one relative time or one compact date", () => {
  const now = new Date("2026-07-15T08:00:00.000Z").getTime();
  const olderDate = "2026-07-14T07:59:59.000Z";

  assert.equal(formatRelativeTime("2026-07-15T08:00:00.000Z", now), "now");
  assert.equal(formatRelativeTime("2026-07-15T06:00:00.000Z", now), "2h");
  assert.equal(
    formatRelativeTime(olderDate, now),
    new Date(olderDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  );
});

test("shows Retrying for the current Topic holder while the provider reconnects", () => {
  const model = buildChatShellModel({
    session,
    projection,
    directory,
    selectedSurface: { kind: "entry-room", entryId: "entry-general-1" },
    chatRunState: {
      runs: {
        "run-current-topic": {
          companyId: "ziho-co",
          conversationId: "room-general-1",
          roomId: "room-general-1",
          runId: "run-current-topic",
          chainId: "chain-current-topic",
          sourceMessageId: "message-1",
          targetMemberId: "lena-analytics",
          status: "retrying",
          streamedContent: "",
          sequence: 6,
        },
      },
    },
  });

  assert.deepEqual(model.context.participants.find((participant) => participant.id === "lena-analytics")?.chatStatus, {
    kind: "retrying",
    label: "Retrying…",
  });
});

test("resolves runtime member display names without falling back to ids", () => {
  const model = buildChatShellModel({
    session,
    projection,
    directory,
    selectedSurface: { kind: "entry-room", entryId: "entry-general-1" },
  });

  assert.equal(memberDisplayNameFor(model, "xuziho"), "Xu Ziho");
  assert.equal(memberDisplayNameFor(model, "lena-analytics"), "Lena Analytics");
  assert.equal(memberDisplayNameFor(model, "employee-hr"), "Mira HR");
  assert.equal(memberDisplayNameFor(model, "unknown-runtime-member"), undefined);
});

test("uses the directory display name for selected DM thread subtitles", () => {
  const dmProjection: ChatProjectionPage = {
    containers: projection.containers,
    entries: [
      ...projection.entries,
      {
        schema: "chat-entry",
        version: 1,
        companyId: "ziho-co",
        entryId: "entry-dm-hr-1",
        kind: "dm_session_entry",
        parentContainerId: "chat-container-member-dm-employee-hr",
        title: "Ask HR",
        titleStatus: "manual",
        unreadCount: 0,
        mentionCount: 0,
        openTarget: { kind: "dm_session_entry_room", roomId: "room-dm-hr-1" },
        runtimeLinks: [],
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  };
  const model = buildChatShellModel({
    session,
    projection: dmProjection,
    directory,
    selectedSurface: { kind: "entry-room", entryId: "entry-dm-hr-1" },
  });

  assert.equal(model.context.room.kind, "thread");
  assert.equal(model.context.room.subtitle, "Mira HR");
  assert.equal(threadSubtitleFor(model), "Mira HR");
});

test("disables image attachments for a direct member DM when the runtime model cannot inspect images", () => {
  const textOnlyDirectory: CompanyDirectoryDto = {
    ...directory,
    directoryMembers: directory.directoryMembers.map((member) => member.memberId === "employee-hr"
      ? {
          ...member,
          runtimeCapability: {
            presenceMode: "resident",
            model: {
              provider: "pi",
              id: "text-only",
              thinkingLevel: "medium",
              input: ["text"],
              supportsImageInput: false,
            },
          },
        }
      : member),
  };
  const model = buildChatShellModel({
    session,
    projection,
    directory: textOnlyDirectory,
    selectedSurface: { kind: "dm-directory", memberId: "employee-hr" },
  });

  assert.equal(model.context.room.kind, "member-dm");
  assert.equal(model.imageAttachmentsEnabled, false);
});

test("does not fuzzy-match member DM containers by display title or role", () => {
  const misleadingProjection: ChatProjectionPage = {
    containers: [
      ...projection.containers.filter((container) => container.kind !== "member_dm"),
      {
        schema: "chat-container",
        version: 1,
        companyId: "ziho-co",
        containerId: "chat-container-member-dm-other-member",
        kind: "member_dm",
        title: "Mira HR",
        unreadCount: 7,
        mentionCount: 0,
        entryCount: 1,
        runtimeLinks: [],
      },
    ],
    entries: [],
  };
  const model = buildChatShellModel({
    session,
    projection: misleadingProjection,
    directory,
    selectedSurface: { kind: "dm-directory", memberId: "employee-hr" },
  });

  assert.equal(model.selectedContainer, undefined);
  assert.equal(model.directMessages[0]?.containerId, "chat-container-member-dm-employee-hr");
  assert.equal(model.directMessages[0]?.unreadCount, 0);
});

test("does not match DM contacts by legacy employeeId when memberId differs", () => {
  const legacyProjection: ChatProjectionPage = {
    containers: [
      ...projection.containers.filter((container) => container.kind !== "member_dm"),
      {
        schema: "chat-container",
        version: 1,
        companyId: "ziho-co",
        containerId: "chat-container-member-dm-legacy-hr",
        kind: "member_dm",
        title: "Legacy HR",
        unreadCount: 5,
        mentionCount: 0,
        entryCount: 1,
        runtimeLinks: [],
      },
    ],
    entries: [],
  };
  const model = buildChatShellModel({
    session,
    projection: legacyProjection,
    directory,
    selectedSurface: { kind: "dm-directory", memberId: "employee-hr" },
  });

  assert.equal(model.selectedContainer, undefined);
  assert.equal(model.directMessages[0]?.containerId, "chat-container-member-dm-employee-hr");
  assert.equal(model.directMessages[0]?.unreadCount, 0);
});

test("does not invent channel participants from the whole company directory", () => {
  const channelWithoutMembers: ChatProjectionPage = {
    containers: projection.containers.map((container) => container.containerId === "channel-general"
      ? { ...container, members: undefined }
      : container),
    entries: projection.entries,
  };
  const model = buildChatShellModel({
    session,
    projection: channelWithoutMembers,
    directory,
    selectedSurface: { kind: "container-directory", containerId: "channel-general" },
  });

  assert.equal(model.context.room.kind, "channel");
  assert.deepEqual(model.context.participants, []);
});

test("maps runtime DM contacts without entries to deterministic create-entry containers", () => {
  const emptyProjection: ChatProjectionPage = {
    containers: projection.containers.filter((container) => container.kind !== "member_dm"),
    entries: [],
  };
  const model = buildChatShellModel({
    session,
    projection: emptyProjection,
    directory,
    selectedSurface: { kind: "dm-directory", memberId: "employee-hr" },
  });

  assert.equal(model.surface.kind, "dm-directory");
  assert.equal(model.selectedContainer, undefined);
  assert.equal(model.directMessages[0]?.containerId, "chat-container-member-dm-employee-hr");
  assert.deepEqual(model.directoryEntries, []);
  assert.equal(model.context.room.kind, "member-dm");
  assert.equal(model.context.room.title, "Mira HR");
  assert.equal(model.context.room.rows.find((row) => row.label === "Topics")?.value, "0");
  assert.deepEqual(model.context.participants, []);
});

test("builds a channel draft topic surface without opening a persisted room", () => {
  const model = buildChatShellModel({
    session,
    projection,
    directory,
    messages,
    selectedSurface: { kind: "draft-entry", containerId: "channel-general" },
  });

  assert.equal(model.surface.kind, "draft-entry");
  assert.equal(model.selectedContainer?.containerId, "channel-general");
  assert.equal(model.selectedEntry, undefined);
  assert.equal(model.selectedRoomId, undefined);
  assert.deepEqual(model.messages, []);
  assert.equal(activeEntryContainerId(model), "channel-general");
  assert.equal(model.context.room.kind, "channel");
  assert.equal(model.context.room.title, "General");
});

test("builds a DM draft topic surface for contacts before a persisted room exists", () => {
  const emptyProjection: ChatProjectionPage = {
    containers: projection.containers.filter((container) => container.kind !== "member_dm"),
    entries: [],
  };
  const model = buildChatShellModel({
    session,
    projection: emptyProjection,
    directory,
    messages,
    selectedSurface: {
      kind: "draft-entry",
      containerId: "chat-container-member-dm-employee-hr",
      memberId: "employee-hr",
    },
  });

  assert.equal(model.surface.kind, "draft-entry");
  assert.equal(model.selectedContainer, undefined);
  assert.equal(model.selectedEntry, undefined);
  assert.equal(model.selectedRoomId, undefined);
  assert.deepEqual(model.messages, []);
  assert.equal(activeEntryContainerId(model), "chat-container-member-dm-employee-hr");
  assert.equal(model.context.room.kind, "member-dm");
  assert.equal(model.context.room.title, "Mira HR");
  assert.equal(model.imageAttachmentsEnabled, true);
});
