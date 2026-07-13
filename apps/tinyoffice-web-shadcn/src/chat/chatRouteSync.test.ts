import assert from "node:assert/strict";
import test from "node:test";

import { chatRouteForSelectedRoom, chatRouteFocusFromSearch } from "./chatRouteSync";

test("chatRouteFocusFromSearch keeps a requested room while projection is still loading", () => {
  assert.deepEqual(
    chatRouteFocusFromSearch("?roomId=conversation-1&surface=direct"),
    { roomId: "conversation-1", surface: "direct" },
  );
});

test("chatRouteForSelectedRoom writes a concrete direct room route", () => {
  assert.equal(chatRouteForSelectedRoom({
    selectedRoomId: "conversation-1",
    selectedContainerKind: "member_dm",
  }), "/chat?roomId=conversation-1&surface=direct");
});

test("chatRouteForSelectedRoom writes a concrete channel room route", () => {
  assert.equal(chatRouteForSelectedRoom({
    selectedRoomId: "conversation-2",
    selectedContainerKind: "channel",
  }), "/chat?roomId=conversation-2&surface=channel");
});

test("chatRouteForSelectedRoom does not clear unresolved room routes implicitly", () => {
  assert.equal(chatRouteForSelectedRoom({
    selectedRoomId: undefined,
    selectedContainerKind: "member_dm",
  }), undefined);
});
