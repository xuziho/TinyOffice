import assert from "node:assert/strict";
import test from "node:test";

import { mentionedMemberIdsForChatSubmit } from "./chatMentionRouting";

test("mentionedMemberIdsForChatSubmit derives exact visible at-labels from current channel candidates", () => {
  const ids = mentionedMemberIdsForChatSubmit({
    body: "@Aster please confirm this with @Lena Analytics.",
    mentionedMemberIds: [],
  }, [
    { memberId: "aster", displayName: "Aster", role: "analytics", hasRuntimeProfile: true },
    { memberId: "lena-analytics", displayName: "Lena Analytics", role: "website-analytics", hasRuntimeProfile: true },
  ]);

  assert.deepEqual(ids, ["aster", "lena-analytics"]);
});

test("mentionedMemberIdsForChatSubmit preserves explicit selected ids and ignores non-runtime candidates", () => {
  const ids = mentionedMemberIdsForChatSubmit({
    body: "@Xuziho and @Aster",
    mentionedMemberIds: ["aster"],
  }, [
    { memberId: "xuziho", displayName: "Xuziho", role: "boss", hasRuntimeProfile: false },
    { memberId: "aster", displayName: "Aster", role: "analytics", hasRuntimeProfile: true },
  ]);

  assert.deepEqual(ids, ["aster"]);
});
