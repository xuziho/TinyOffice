import assert from "node:assert/strict";
import test from "node:test";

import type { ChatProjectionPage, CreateChatEntryResponse } from "tinyoffice/frontend-api-contracts";
import { projectionWithCreatedEntry } from "./chatProjectionCache";

test("projection cache inserts the created entry before projection refetch returns", () => {
  const next = projectionWithCreatedEntry(undefined, createEntryResponse());

  assert.deepEqual(next.containers.map((container) => container.containerId), ["channel-general"]);
  assert.deepEqual(next.entries.map((entry) => entry.entryId), ["entry-new"]);
  assert.equal(next.entries[0]?.openTarget.roomId, "room-new");
});

test("projection cache updates existing created entry without duplicating rows", () => {
  const existing: ChatProjectionPage = {
    containers: [{ ...createEntryResponse().container, title: "Old General" }],
    entries: [{ ...createEntryResponse().entry, title: "Old title" }],
  };
  const next = projectionWithCreatedEntry(existing, createEntryResponse());

  assert.deepEqual(next.containers.map((container) => container.title), ["General"]);
  assert.deepEqual(next.entries.map((entry) => entry.title), ["New topic"]);
});

function createEntryResponse(): CreateChatEntryResponse {
  return {
    schema: "chat-create-entry-result",
    version: 1,
    companyId: "acme",
    container: {
      schema: "chat-container",
      version: 1,
      companyId: "acme",
      containerId: "channel-general",
      kind: "channel",
      title: "General",
      unreadCount: 0,
      mentionCount: 0,
      entryCount: 1,
      runtimeLinks: [],
      members: [],
    },
    entry: {
      schema: "chat-entry",
      version: 1,
      companyId: "acme",
      entryId: "entry-new",
      kind: "channel_topic",
      parentContainerId: "channel-general",
      title: "New topic",
      titleStatus: "placeholder",
      unreadCount: 0,
      mentionCount: 0,
      openTarget: { kind: "topic_room", roomId: "room-new" },
      runtimeLinks: [],
      updatedAt: "2026-07-06T00:00:00.000Z",
    },
    openTarget: { kind: "topic_room", roomId: "room-new" },
    firstMessageId: "message-new",
  };
}
