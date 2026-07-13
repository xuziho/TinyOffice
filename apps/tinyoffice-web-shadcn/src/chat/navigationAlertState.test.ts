import assert from "node:assert/strict";
import test from "node:test";

import { navigationAlertState } from "./navigationAlertState";

test("navigation alerts keep unread Chat activity on Chat", () => {
  const projection = {
    containers: [],
    entries: [{ unreadCount: 1, mentionCount: 0 }],
  };

  assert.deepEqual(navigationAlertState({ projection }), { chat: true, tasks: false });
});

test("navigation alerts keep foreground Access requests on Chat", () => {
  const accessRequests = {
    requests: [{
      status: "pending",
      requestedApproverMemberId: "boss",
      foregroundTarget: { kind: "chat-room", roomId: "room-1", surface: "direct" },
    }],
  };

  assert.deepEqual(navigationAlertState({ accessRequests, viewerMemberId: "boss" }), { chat: true, tasks: false });
  assert.deepEqual(navigationAlertState({ accessRequests, viewerMemberId: "other" }), { chat: false, tasks: false });
});

test("navigation alerts keep failed and dispatch-failed execution controls on Tasks", () => {
  const tasks: NonNullable<Parameters<typeof navigationAlertState>[0]["tasks"]> = {
    tasks: [{ status: "active", latestExecution: { status: "failed", actions: [] } }],
  };
  assert.deepEqual(navigationAlertState({ tasks }), { chat: false, tasks: true });

  tasks.tasks[0]!.latestExecution = {
    ...tasks.tasks[0]!.latestExecution!,
    status: "queued",
    actions: [{ id: "retry-dispatch", enabled: true }],
  };
  assert.deepEqual(navigationAlertState({ tasks }), { chat: false, tasks: true });
});

test("navigation alerts do not duplicate blocked recovery or handoff state onto Tasks", () => {
  const tasks = {
    tasks: [{
      status: "active",
      latestExecution: { status: "blocked", actions: [], needsParticipantInput: true },
    }],
  };

  assert.deepEqual(navigationAlertState({ tasks }), { chat: false, tasks: false });
});
