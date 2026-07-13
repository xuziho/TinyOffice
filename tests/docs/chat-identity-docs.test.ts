import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("active Chat docs use member-only selectors outside explicit rejection lists", async () => {
  const [chatDoc, apiGuideDoc, chatEntryContract] = await Promise.all([
    readFile("docs/product/chat.md", "utf8"),
    readFile("docs/product/company-api-guide.md", "utf8"),
    readFile("docs/technical/chat-entry-contract.md", "utf8"),
  ]);

  assert.doesNotMatch(chatDoc, /mentionedEmployeeIds/);
  assert.match(chatDoc, /mentionedMemberIds/);

  assert.doesNotMatch(apiGuideDoc, /employeeId\s+or\s+memberId/);
  assert.doesNotMatch(apiGuideDoc, /members\[\]\.employeeId/);
  assert.match(apiGuideDoc, /members\[\]\.memberId/);

  assert.doesNotMatch(chatEntryContract, /actorEmployeeId\?:/);
  assert.doesNotMatch(chatEntryContract, /mentionedEmployeeIds/);
  assert.doesNotMatch(chatEntryContract, /selected participant employee ids/);
  assert.match(chatEntryContract, /actorMemberId/);
  assert.match(chatEntryContract, /mentionedMemberIds/);
});
