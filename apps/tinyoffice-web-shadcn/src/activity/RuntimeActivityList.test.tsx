import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RuntimeActivityItem } from "tinyoffice/frontend-api-contracts";

const sampleActivity: RuntimeActivityItem[] = [
  {
    id: "activity:run-started",
    kind: "run_started",
    title: "Run started",
    details: "Chat runtime accepted message-1 and started preparing a reply.",
    status: "running",
    timestamp: "2026-07-07T10:33:50.000Z",
    primary: {
      targetMemberId: "employee-hr",
    },
    raw: {
      eventIds: ["trace-1"],
      events: [{
        id: "trace-1",
        timestamp: "2026-07-07T10:33:50.000Z",
        kind: "employee_reply_started",
        sessionKey: "employee-hr|chat_direct_room|conversation-1",
        employeeId: "employee-hr",
        title: "employee-hr started Chat reply",
        summary: "Chat runtime accepted message-1 and started preparing a reply.",
        status: "running",
      }],
    },
  },
];

const noisyChatActivity: RuntimeActivityItem[] = [
  sampleActivity[0],
  {
    id: "activity:thinking",
    kind: "thinking",
    title: "Thinking",
    details: "**Considering task creation in Chinese** I need to respond in Chinese and explain the available workflow without hiding the rest of this step when the item is expanded.",
    status: "running",
    timestamp: "2026-07-07T10:33:51.000Z",
    raw: { eventIds: ["trace-thinking"], events: [] },
  },
  {
    id: "activity:tool",
    kind: "tool_call",
    title: "Tool call",
    details: "`tinyoffice_capability_call` created a task.",
    status: "succeeded",
    timestamp: "2026-07-07T10:33:52.000Z",
    primary: { toolName: "tinyoffice_capability_call" },
    raw: { eventIds: ["trace-tool"], events: [] },
  },
  {
    id: "activity:completed",
    kind: "run_completed",
    title: "Run completed",
    details: "Reply posted to conversation.",
    status: "succeeded",
    timestamp: "2026-07-07T10:33:53.000Z",
    raw: { eventIds: ["trace-completed"], events: [] },
  },
];

const handoffActivity: RuntimeActivityItem[] = [{
  id: "activity:handoff",
  kind: "handoff",
  title: "Handoff",
  details: "{\"toId\":\"olivia\",\"reason\":\"SEO owner\"}",
  status: "succeeded",
  timestamp: "2026-07-07T10:33:52.000Z",
  primary: {
    toolName: "handoff_topic_turn",
    targetMemberId: "Olivia",
  },
  raw: { eventIds: ["trace-handoff"], events: [] },
}];

test("renders compact activity as a quiet event stream", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { RuntimeActivityList } = await import("./RuntimeActivityList");

  const html = renderToStaticMarkup(
    <RuntimeActivityList items={sampleActivity} density="compact" maxHeight="274px" />,
  );

  assert.match(html, /Run started/);
  assert.match(html, /Target employee-hr/);
  assert.match(html, /max-h-\[274px\]/);
  assert.doesNotMatch(html, />RUN STARTED</);
  assert.doesNotMatch(html, /Raw evidence/);
  assert.doesNotMatch(html, /employee_reply_started/);
});

test("keeps raw evidence available in full activity mode", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { RuntimeActivityList } = await import("./RuntimeActivityList");

  const html = renderToStaticMarkup(
    <RuntimeActivityList items={sampleActivity} density="full" maxHeight="360px" />,
  );

  assert.match(html, /Evidence/);
  assert.match(html, /1 event/);
  assert.match(html, /employee_reply_started/);
});

test("does not constrain expanded activity unless a caller opts into a max height", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { RuntimeActivityList } = await import("./RuntimeActivityList");

  const html = renderToStaticMarkup(
    <RuntimeActivityList items={noisyChatActivity} density="summary" />,
  );

  assert.doesNotMatch(html, /max-h-\[/);
  assert.doesNotMatch(html, /max-height/);
  assert.match(html, /without hiding the rest of this step/);
});

test("renders chat summary activity as expandable per-step details", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { RuntimeActivityList } = await import("./RuntimeActivityList");

  const html = renderToStaticMarkup(
    <RuntimeActivityList items={noisyChatActivity} density="summary" maxHeight="274px" />,
  );

  assert.match(html, /Run started/);
  assert.match(html, /Thinking/);
  assert.match(html, /Tool call/);
  assert.match(html, /Run completed/);
  assert.match(html, /Considering task creation in Chinese/);
  assert.match(html, /without hiding the rest of this step/);
  assert.match(html, /tinyoffice_capability_call/);
  assert.match(html, /text-xs/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, />run started</);
  assert.doesNotMatch(html, />thinking</);
  assert.doesNotMatch(html, />tool call</);
  assert.doesNotMatch(html, />run completed</);
  assert.doesNotMatch(html, /line-clamp/);
  assert.doesNotMatch(html, /workflow without hiding the rest of this step\.\.\./);
  assert.doesNotMatch(html, /\*\*Considering task creation/);
  assert.doesNotMatch(html, /`tinyoffice_capability_call`/);
  assert.doesNotMatch(html, /more event/);
  assert.doesNotMatch(html, /Evidence/);
});

test("renders topic handoff target in the collapsed activity row", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { RuntimeActivityList } = await import("./RuntimeActivityList");

  const html = renderToStaticMarkup(
    <RuntimeActivityList items={handoffActivity} density="summary" maxHeight="274px" />,
  );

  assert.match(html, /Handoff/);
  assert.match(html, /to Olivia/);
  assert.match(html, /To Olivia/);
  assert.doesNotMatch(html, /Tool call/);
  assert.doesNotMatch(html, /Tool handoff_topic_turn/);
});
