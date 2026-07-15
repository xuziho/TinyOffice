import assert from "node:assert/strict";
import test from "node:test";

import {
  appViewHref,
  chatRoomHref,
  navigationHref,
  navigationReturnContextFromState,
  navigationStateWithReturn,
  navigationViewForTarget,
  sessionsHref,
  tasksHref,
} from "./navigationRoutes";

test("appViewHref returns stable top-level module paths", () => {
  assert.equal(appViewHref("chat"), "/chat");
  assert.equal(appViewHref("company"), "/company");
  assert.equal(appViewHref("employees"), "/employees");
  assert.equal(appViewHref("integrations"), "/integrations");
  assert.equal(appViewHref("prompt"), "/prompt");
  assert.equal(appViewHref("access"), "/access");
  assert.equal(appViewHref("capabilities"), "/capabilities");
  assert.equal(appViewHref("doctor"), "/doctor");
  assert.equal(appViewHref("sessions"), "/sessions");
  assert.equal(appViewHref("settings"), "/settings");
  assert.equal(appViewHref("skills"), "/skills");
  assert.equal(appViewHref("system-ai"), "/system-ai");
  assert.equal(appViewHref("tasks"), "/tasks");
  assert.equal(appViewHref("updates"), "/updates");
});

test("chatRoomHref writes concrete room routes", () => {
  assert.equal(chatRoomHref({ roomId: "conversation-1", surface: "direct" }), "/chat?roomId=conversation-1&surface=direct");
  assert.equal(chatRoomHref({ roomId: "room-1", surface: "channel" }), "/chat?roomId=room-1&surface=channel");
  assert.equal(chatRoomHref({ roomId: "conversation-unknown" }), "/chat?roomId=conversation-unknown");
});

test("sessionsHref keeps list and detail session routes explicit", () => {
  assert.equal(sessionsHref(), "/sessions");
  assert.equal(sessionsHref({ employeeId: "employee-hr" }), "/sessions?employeeId=employee-hr");
  assert.equal(
    sessionsHref({ employeeId: "employee-hr", sessionId: "runtime-session-1", query: "roster" }),
    "/sessions?employeeId=employee-hr&sessionId=runtime-session-1&q=roster",
  );
});

test("tasksHref keeps list and detail task routes explicit", () => {
  assert.equal(tasksHref(), "/tasks");
  assert.equal(tasksHref({ taskId: "work-task-1" }), "/tasks?taskId=work-task-1");
});

test("navigationHref gives every cross-page target a canonical URL", () => {
  assert.equal(navigationHref({ kind: "app", view: "employees" }), "/employees");
  assert.equal(navigationHref({ kind: "chat-room", roomId: "conversation-1", surface: "direct" }), "/chat?roomId=conversation-1&surface=direct");
  assert.equal(navigationHref({ kind: "chat-room", roomId: "conversation-unknown" }), "/chat?roomId=conversation-unknown");
  assert.equal(
    navigationHref({ kind: "session", employeeId: "avery", sessionId: "runtime-session-1", query: "approval" }),
    "/sessions?employeeId=avery&sessionId=runtime-session-1&q=approval",
  );
  assert.equal(navigationHref({ kind: "task", taskId: "work-task-1" }), "/tasks?taskId=work-task-1");
});

test("navigationViewForTarget maps canonical targets to their owning page", () => {
  assert.equal(navigationViewForTarget({ kind: "chat-room", roomId: "room-1", surface: "channel" }), "chat");
  assert.equal(navigationViewForTarget({ kind: "session", sessionId: "runtime-session-1" }), "sessions");
  assert.equal(navigationViewForTarget({ kind: "task", taskId: "work-task-1" }), "tasks");
  assert.equal(navigationViewForTarget({ kind: "app", view: "settings" }), "settings");
});

test("navigationStateWithReturn stores source context outside the canonical URL", () => {
  const state = navigationStateWithReturn({
    from: {
      label: "Back to Avery",
      target: { kind: "chat-room", roomId: "conversation-avery", surface: "direct" },
    },
  });

  assert.deepEqual(navigationReturnContextFromState(state), {
    label: "Back to Avery",
    target: { kind: "chat-room", roomId: "conversation-avery", surface: "direct" },
  });
  assert.equal(navigationHref({ kind: "session", employeeId: "avery", sessionId: "runtime-session-1" }), "/sessions?employeeId=avery&sessionId=runtime-session-1");
});

test("navigationReturnContextFromState ignores malformed history state", () => {
  assert.equal(navigationReturnContextFromState(undefined), undefined);
  assert.equal(navigationReturnContextFromState({}), undefined);
  assert.equal(navigationReturnContextFromState({ tinyofficeReturn: { label: "", target: { kind: "unknown" } } }), undefined);
});

