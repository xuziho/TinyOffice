import assert from "node:assert/strict";
import test from "node:test";

import { buildProcessEventsFromSessionEvent } from "../../src/runtime/provider/pi-runtime-provider.js";
import type { EmployeeHome } from "../../src/runtime/registry/employee-home.js";

const employee: EmployeeHome = {
  companyId: "acme",
  employeeId: "mira-hr",
  homePath: "/unused/companies/acme/employees/mira-hr",
  workspacePath: "/unused/companies/acme/employees/mira-hr/workspace",
  profile: {
    employeeId: "mira-hr",
    role: "hr",
    displayName: "Mira",
    presenceMode: "resident",
    mountedActions: [],
  },
  resourcePolicy: { version: 1, filesystem: {} },
};

const input = {
  employee,
  message: "Please handle this topic",
  sessionKey: "mira-hr|work_run_execution|work-run-1",
  threadId: "work-run-1",
  preferredLanguage: "en-US",
};

test("PI thinking deltas do not create process trace spam", () => {
  const delta = buildProcessEventsFromSessionEvent(input, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Checking the first detail" }],
    },
    assistantMessageEvent: {
      type: "thinking_delta",
      contentIndex: 0,
      delta: "Checking the first detail",
    },
  });
  const end = buildProcessEventsFromSessionEvent(input, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Checking the first detail and choosing the next step." }],
    },
    assistantMessageEvent: {
      type: "thinking_end",
      contentIndex: 0,
      content: "Checking the first detail and choosing the next step.",
    },
  });

  assert.deepEqual(delta, []);
  assert.equal(end.length, 1);
  assert.equal(end[0]?.kind, "model_reasoning_observed");
  assert.equal(end[0]?.status, "succeeded");
  assert.equal(end[0]?.summary, "Checking the first detail and choosing the next step.");
});

test("PI assistant thinking snapshots do not duplicate completed thinking stream traces", () => {
  const events = buildProcessEventsFromSessionEvent(input, {
    type: "message",
    id: "message-assistant-final",
    timestamp: "2026-07-07T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Checking the first detail and choosing the next step." }],
    },
  });

  assert.deepEqual(events, []);
});
