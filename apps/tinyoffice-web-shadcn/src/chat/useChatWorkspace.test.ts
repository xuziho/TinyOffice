import assert from "node:assert/strict";
import test from "node:test";

import type { ChatShellModel } from "./chatShellModel";
import { memberDisplayNamesForCreateEntry } from "./chatCreateEntryDisplayNames";
import { accessDecisionContinuationMessage, accessRequestForegroundRoomId, accessRequestsForRoom } from "./chatAccessRequests";
import type { AccessRequestDto } from "tinyoffice/frontend-api-contracts";

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
