import assert from "node:assert/strict";
import test from "node:test";

import type { ChatShellModel } from "./chatShellModel";
import { centerWorkspaceMode } from "./centerWorkspaceMode";

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

test("center workspace keeps an entry-room selection in the room surface while projection refetch catches up", () => {
  const model = shellModel({
    surface: { kind: "entry-room", entryId: "entry-new" },
    selectedEntry: undefined,
    selectedRoomId: undefined,
  });

  assert.equal(centerWorkspaceMode(model), "entry-room-pending");
});

test("center workspace routes concrete surfaces to the expected panel modes", () => {
  assert.equal(centerWorkspaceMode(shellModel({
    surface: { kind: "draft-entry", containerId: "channel-general" },
  })), "draft-entry");

  assert.equal(centerWorkspaceMode(shellModel({
    surface: { kind: "container-directory", containerId: "channel-general" },
  })), "entry-list");
});
