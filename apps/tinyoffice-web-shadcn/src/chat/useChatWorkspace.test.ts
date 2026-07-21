import assert from "node:assert/strict";
import test from "node:test";

import type { ChatShellModel } from "./chatShellModel";
import { memberDisplayNamesForCreateEntry } from "./chatCreateEntryDisplayNames";
import { accessDecisionContinuationMessage, accessRequestForegroundRoomId, accessRequestsForRoom } from "./chatAccessRequests";
import type { AccessRequestDto, RuntimeActivity } from "tinyoffice/frontend-api-contracts";
import { activityDisplaySnapshot, activityQueryPlaceholderData, mergeRuntimeActivity } from "./useChatWorkspace";

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

test("memberDisplayNamesForCreateEntry sends the DM peer display name for direct-message topics", () => {
  const model = shellModel({
    surface: {
      kind: "dm-directory",
      memberId: "alex",
      containerId: "chat-container-member-dm-alex",
    },
    selectedContainer: {
      schema: "chat-container",
      version: 1,
      companyId: "ziho-co",
      containerId: "chat-container-member-dm-alex",
      kind: "member_dm",
      title: "alex",
      unreadCount: 0,
      mentionCount: 0,
      entryCount: 0,
      runtimeLinks: [],
    },
    directMessages: [{
      id: "alex",
      title: "Alex",
      subtitle: "automation-operations-manager",
      unreadCount: 0,
      mentionCount: 0,
      kind: "dm",
      containerId: "chat-container-member-dm-alex",
    }],
  });

  assert.deepEqual(memberDisplayNamesForCreateEntry(model), { alex: "Alex" });
});

test("Activity keeps the last settled turn visible while a handoff target has no projected trace yet", () => {
  const previous = runtimeActivity("Run completed");
  const settled = {
    activity: previous,
    selection: { sourceMessageId: "message-avery" },
  };

  assert.equal(activityQueryPlaceholderData(previous), previous);
  assert.equal(activityQueryPlaceholderData(undefined), undefined);
  assert.equal(activityDisplaySnapshot({
    currentActivity: { items: [] },
    currentSelection: { sourceMessageId: "message-olivia" },
    activeSourceMessageId: "message-olivia",
    isPlaceholderData: false,
    settled,
  }), settled);
  assert.equal(activityDisplaySnapshot({
    currentActivity: previous,
    currentSelection: { sourceMessageId: "message-olivia" },
    activeSourceMessageId: "message-olivia",
    isPlaceholderData: true,
    settled,
  }), settled);
});

test("Activity switches atomically once the handoff target has real projected trace", () => {
  const current = runtimeActivity("Run started");
  const displayed = activityDisplaySnapshot({
    currentActivity: current,
    currentSelection: { sourceMessageId: "message-olivia" },
    activeSourceMessageId: "message-olivia",
    isPlaceholderData: false,
    settled: {
      activity: runtimeActivity("Run completed"),
      selection: { sourceMessageId: "message-avery" },
    },
  });

  assert.equal(displayed.activity, current);
  assert.deepEqual(displayed.selection, { sourceMessageId: "message-olivia" });
});

test("memberDisplayNamesForCreateEntry sends the draft DM peer display name from the directory", () => {
  const model = shellModel({
    surface: {
      kind: "draft-entry",
      containerId: "chat-container-member-dm-employee-hr",
      memberId: "employee-hr",
    },
    selectedContainer: {
      schema: "chat-container",
      version: 1,
      companyId: "ziho-co",
      containerId: "chat-container-member-dm-employee-hr",
      kind: "member_dm",
      title: "employee-hr",
      unreadCount: 0,
      mentionCount: 0,
      entryCount: 0,
      runtimeLinks: [],
    },
    directoryMembers: [{
      schema: "company-directory-member-entry",
      version: 1,
      companyId: "ziho-co",
      memberId: "employee-hr",
      avatarSeed: "employee-hr",
      displayName: "Mira",
      role: "hr",
      selector: { kind: "member", memberId: "employee-hr" },
      hasRuntimeProfile: true,
      runtimeCapability: {
        presenceMode: "resident",
        model: {
          provider: "openai",
          id: "gpt-5",
          thinkingLevel: "minimal",
          supportsImageInput: true,
        },
      },
    }],
  });

  assert.deepEqual(memberDisplayNamesForCreateEntry(model), { "employee-hr": "Mira" });
});

test("memberDisplayNamesForCreateEntry sends the draft DM peer display name before the DM container exists", () => {
  const model = shellModel({
    surface: {
      kind: "draft-entry",
      containerId: "chat-container-member-dm-employee-hr",
      memberId: "employee-hr",
    },
    selectedContainer: undefined,
    directoryMembers: [{
      schema: "company-directory-member-entry",
      version: 1,
      companyId: "ziho-co",
      memberId: "employee-hr",
      avatarSeed: "employee-hr",
      displayName: "Mira",
      role: "hr",
      selector: { kind: "member", memberId: "employee-hr" },
      hasRuntimeProfile: true,
      runtimeCapability: {
        presenceMode: "resident",
        model: {
          provider: "openai",
          id: "gpt-5",
          thinkingLevel: "minimal",
          supportsImageInput: true,
        },
      },
    }],
  });

  assert.deepEqual(memberDisplayNamesForCreateEntry(model), { "employee-hr": "Mira" });
});

test("memberDisplayNamesForCreateEntry does not send display-name maps for channel topics", () => {
  const model = shellModel({
    surface: { kind: "container-directory", containerId: "chat-container-channel-general" },
    selectedContainer: {
      schema: "chat-container",
      version: 1,
      companyId: "ziho-co",
      containerId: "chat-container-channel-general",
      kind: "channel",
      title: "General",
      unreadCount: 0,
      mentionCount: 0,
      entryCount: 0,
      runtimeLinks: [],
    },
  });

  assert.equal(memberDisplayNamesForCreateEntry(model), undefined);
});

test("accessRequestsForRoom keeps pending approvals scoped to the selected conversation", () => {
  const requests = [
    accessRequest({ id: "current", contextId: "room-1", status: "pending" }),
    accessRequest({
      id: "work-run-recovery",
      contextId: "work-run-1",
      contextKind: "work_run",
      foregroundRoomId: "room-1",
      status: "pending",
    }),
    accessRequest({ id: "resolved", contextId: "room-1", status: "approved" }),
    accessRequest({ id: "other-room", contextId: "room-2", status: "pending" }),
  ];

  assert.deepEqual(accessRequestsForRoom(requests, "room-1").map((request) => request.id), [
    "current",
    "work-run-recovery",
  ]);
  assert.deepEqual(accessRequestsForRoom(requests, undefined), []);
  assert.equal(accessRequestForegroundRoomId(requests[1]!), "room-1");
});

test("accessDecisionContinuationMessage tells the employee whether to retry or stop", () => {
  const request = accessRequest({ id: "current", contextId: "room-1", status: "pending" });

  assert.equal(
    accessDecisionContinuationMessage({ request, decision: "allow_once" }),
    "Access approved once for read .env.\nPlease retry the blocked action now through the original tool path.",
  );
  assert.equal(
    accessDecisionContinuationMessage({ request, decision: "allow_in_context", note: "Only for connector setup." }),
    "Access approved in this conversation for read .env.\nNote: Only for connector setup.\nPlease retry the blocked action now through the original tool path.",
  );
  assert.equal(
    accessDecisionContinuationMessage({ request, decision: "reject", note: "Use the configured credential alias instead." }),
    "Access rejected for read .env.\nReason: Use the configured credential alias instead.",
  );
  assert.equal(
    accessDecisionContinuationMessage({
      request: accessRequest({ id: "work", contextId: "work-run-1", contextKind: "work_run", status: "pending" }),
      decision: "allow_in_context",
    }),
    "Access approved for this WorkRun for read .env.\nPlease retry the blocked action now through the original tool path.",
  );
});

function runtimeActivity(title: string): RuntimeActivity {
  return {
    items: [{
      id: `activity-${title}`,
      kind: title === "Run started" ? "run_started" : "run_completed",
      title,
      raw: { eventIds: [], events: [] },
    }],
  };
}

test("mergeRuntimeActivity keeps durable history and lets backend live upserts win by id", () => {
  const persisted: RuntimeActivity = {
    items: [{
      id: "activity:thinking:run-1",
      kind: "thinking",
      title: "Thinking",
      details: "Initial thought",
      timestamp: "2026-07-21T00:00:00.000Z",
      raw: { eventIds: ["trace-1"], events: [] },
    }],
  };
  const live: RuntimeActivity = {
    items: [{
      ...persisted.items[0]!,
      details: "Latest thought",
      raw: { eventIds: ["trace-1", "trace-2"], events: [] },
    }, {
      id: "activity:tool_call:run-1:tool-1",
      kind: "tool_call",
      title: "Tool call",
      timestamp: "2026-07-21T00:00:01.000Z",
      raw: { eventIds: ["trace-3"], events: [] },
    }],
  };

  assert.deepEqual(mergeRuntimeActivity(persisted, live), {
    items: [live.items[0], live.items[1]],
  });
});

function accessRequest(input: {
  id: string;
  contextId: string;
  status: "pending" | "approved" | "rejected";
  sessionKey?: string;
  contextKind?: AccessRequestDto["contextKind"];
  foregroundRoomId?: string;
}): AccessRequestDto {
  return {
    id: input.id,
    status: input.status,
    requestedByMemberId: "avery",
    requestedAction: "read",
    requestedResource: ".env",
    reason: "Sensitive path read requires approval.",
    contextKind: input.contextKind ?? "dm_thread",
    contextId: input.contextId,
    ...(input.foregroundRoomId
      ? { foregroundTarget: { kind: "chat-room" as const, roomId: input.foregroundRoomId, surface: "direct" as const } }
      : {}),
    sessionKey: input.sessionKey ?? `avery|chat_direct_room|${input.contextId}`,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    actions: ["allow_once", "allow_in_context", "reject"],
  };
}
