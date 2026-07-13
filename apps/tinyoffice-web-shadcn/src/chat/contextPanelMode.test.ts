import assert from "node:assert/strict";
import test from "node:test";

import type { ChatShellModel } from "./chatShellModel";
import { contextPanelRuntimeMode } from "./contextPanelMode";

function shellModel(input: Partial<ChatShellModel>): ChatShellModel {
  return {
    companyId: "ziho-co",
    viewerLabel: "Xu Ziho",
    viewerMemberId: "xuziho",
    surface: { kind: "empty" },
    channels: [],
    directMessages: [],
    directoryMembers: [],
    employeeRuntimeSummaries: [],
    rooms: [],
    directoryEntries: [],
    mentionCandidates: [],
    imageAttachmentsEnabled: true,
    messages: [],
    context: {
      room: { kind: "workspace", title: "Workspace", rows: [] },
      participants: [],
      evidence: { sessions: [], workRuns: [], processTraces: [], files: [], other: [] },
      runtimeLinks: [],
      relatedTasks: [],
    },
    ...input,
  };
}

test("context panel exposes runtime surfaces only for concrete entry rooms", () => {
  const entryRoom = shellModel({
    surface: { kind: "entry-room", entryId: "entry-1" },
    selectedEntry: {
      schema: "chat-entry",
      version: 1,
      companyId: "ziho-co",
      entryId: "entry-1",
      kind: "channel_topic",
      parentContainerId: "channel-general",
      title: "Entry",
      titleStatus: "manual",
      unreadCount: 0,
      mentionCount: 0,
      openTarget: { kind: "topic_room", roomId: "room-entry-1" },
      runtimeLinks: [],
      updatedAt: "2026-07-06T00:00:00.000Z",
    },
  });

  assert.deepEqual(contextPanelRuntimeMode(entryRoom), {
    showActivityDock: true,
    showParticipantSessions: true,
  });
});

test("context panel hides runtime surfaces for directory and pending room states", () => {
  assert.deepEqual(contextPanelRuntimeMode(shellModel({
    surface: { kind: "container-directory", containerId: "channel-general" },
  })), {
    showActivityDock: false,
    showParticipantSessions: false,
  });

  assert.deepEqual(contextPanelRuntimeMode(shellModel({
    surface: { kind: "entry-room", entryId: "entry-new" },
    selectedEntry: undefined,
  })), {
    showActivityDock: false,
    showParticipantSessions: false,
  });
});
