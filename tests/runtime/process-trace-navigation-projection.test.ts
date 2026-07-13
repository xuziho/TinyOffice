import assert from "node:assert/strict";
import test from "node:test";

import { projectProcessTraceNavigationEvent } from "../../src/runtime/realtime/process-trace-store.js";

test("process trace navigation projects owned runtime links", () => {
  const projected = projectProcessTraceNavigationEvent({
    id: "trace-owned-navigation",
    timestamp: "2026-06-26T00:00:00.000Z",
    kind: "turn_received",
    sessionKey: "nora-automation|chat_topic_room|conversation-owned",
    title: "Turn received",
    metadata: {
      conversationId: "conversation-owned",
      messageId: "message-owned",
      chatEntryId: "chat-entry-owned",
    },
  });

  assert.deepEqual(projected.runtimeLinks.map((link) => [link.kind, link.targetId]), [
    ["process-trace", "trace-owned-navigation"],
    ["message", "message-owned"],
    ["chat-entry", "chat-entry-owned"],
  ]);
  assert.doesNotMatch(JSON.stringify(projected), /rootPostId|legacyCarrier/);
});
