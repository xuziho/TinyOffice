import assert from "node:assert/strict";
import test from "node:test";

import type { MessagePage } from "tinyoffice/frontend-api-contracts";
import { activitySourceForMessage, latestActivitySourceForMessages } from "./messageActivitySource";

test("activitySourceForMessage selects the source message behind a process trace link", () => {
  const message = messageWithRuntimeLinks([
    {
      targetKind: "session",
      targetId: "runtime-session-1",
      sourceMessageId: "message-source-1",
    },
    {
      targetKind: "process_trace",
      targetId: "trace-1",
      sourceMessageId: "message-source-1",
    },
  ]);

  assert.deepEqual(activitySourceForMessage(message), {
    sourceMessageId: "message-source-1",
  });
});

test("activitySourceForMessage ignores messages without traceable runtime links", () => {
  assert.equal(activitySourceForMessage(messageWithRuntimeLinks([])), undefined);
  assert.equal(activitySourceForMessage(messageWithRuntimeLinks([{
    targetKind: "work_run",
    targetId: "work-run-1",
  }])), undefined);
});

test("latestActivitySourceForMessages selects the newest traceable reply", () => {
  const firstReply = messageWithRuntimeLinks(
    [{
      targetKind: "process_trace",
      targetId: "trace-1",
      sourceMessageId: "message-source-1",
    }],
    { messageId: "message-reply-1", createdAt: "2026-07-07T10:00:00.000Z" },
  );
  const userMessage = messageWithRuntimeLinks([], { messageId: "message-user-2", createdAt: "2026-07-07T10:01:00.000Z" });
  const latestReply = messageWithRuntimeLinks(
    [{
      targetKind: "process_trace",
      targetId: "trace-2",
      sourceMessageId: "message-source-2",
    }],
    { messageId: "message-reply-2", createdAt: "2026-07-07T10:02:00.000Z" },
  );

  assert.deepEqual(latestActivitySourceForMessages([firstReply, userMessage, latestReply]), {
    sourceMessageId: "message-source-2",
  });
});

function messageWithRuntimeLinks(
  links: Array<{
    targetKind: "session" | "work_run" | "process_trace" | "session_event";
    targetId: string;
    sourceMessageId?: string;
  }>,
  options: { messageId?: string; createdAt?: string } = {},
): MessagePage["messages"][number] {
  return {
    schema: "message",
    version: 1,
    companyId: "ziho-co",
    conversationId: "room-1",
    messageId: options.messageId ?? "message-reply-1",
    sender: {
      participantId: "employee-hr",
      participantKind: "company_member",
      memberId: "employee-hr",
      displayName: "Mira",
    },
    body: "Done.",
    mentions: [],
    attachments: [],
    runtimeLinks: links.map((link, index) => ({
      schema: "conversation-runtime-link",
      version: 1,
      companyId: "ziho-co",
      conversationId: "room-1",
      linkId: `link-${index + 1}`,
      label: link.targetKind === "process_trace" ? "Worked for 2s" : "Owned Chat employee reply",
      createdAt: "2026-07-07T00:00:00.000Z",
      ...link,
    })),
    createdAt: options.createdAt ?? "2026-07-07T00:00:00.000Z",
    deliveryState: "sent",
  };
}
