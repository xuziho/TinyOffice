import assert from "node:assert/strict";
import test from "node:test";

import { buildProcessEventsFromSessionEvent } from "../../src/runtime/provider/pi-runtime-provider.js";
import type { RuntimeProviderReplyRequest } from "../../src/runtime/provider/contracts.js";
import type { EmployeeHome } from "../../src/runtime/registry/employee-home.js";

const employee: EmployeeHome = {
  companyId: "tinyoffice",
  employeeId: "nora-automation",
  homePath: "/unused/companies/tinyoffice/employees/nora-automation",
  workspacePath: "/unused/companies/tinyoffice/employees/nora-automation/workspace",
  profile: {
    employeeId: "nora-automation",
    role: "automation",
    displayName: "Nora Automation",
    presenceMode: "resident",
    mountedActions: [],
  },
  resourcePolicy: { version: 1, filesystem: {} },
};

function request(input: Partial<RuntimeProviderReplyRequest> = {}): RuntimeProviderReplyRequest {
  return {
    employee,
    message: "Please handle this owned Chat room.",
    sessionKey: "nora-automation|chat_direct_room|conversation-1",
    threadId: "conversation-1",
    preferredLanguage: "en-US",
    ...input,
  };
}

const thinkingEvent = {
  type: "message_update",
  message: {
    role: "assistant",
    content: [{ type: "thinking", thinking: "private reasoning" }],
  },
  assistantMessageEvent: {
    type: "thinking_end",
    contentIndex: 0,
    content: "private reasoning",
  },
};

test("provider process trace events do not turn threadId into rootPostId", () => {
  const events = buildProcessEventsFromSessionEvent(request(), thinkingEvent);

  assert.equal(events.length, 1);
  assert.equal("rootPostId" in events[0], false);
});
