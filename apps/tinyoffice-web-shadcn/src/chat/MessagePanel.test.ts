import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./MessagePanel.tsx", import.meta.url), "utf8");
const draftEntrySource = readFileSync(new URL("./DraftEntryPanel.tsx", import.meta.url), "utf8");

test("streaming reply uses the final message row geometry from its first visible content", () => {
  const streamingReply = source.match(/function ReplyRunRow\([\s\S]*?<MessageScrollerItem messageId=\{`draft-\$\{draftReply\.runId\}`\}[\s\S]*?<\/MessageScrollerItem>/)?.[0];

  assert.ok(streamingReply, "expected the streaming reply block to exist");
  assert.match(streamingReply, /className="tiny-message-row max-w-full overflow-visible px-0\.5 py-1\.5"/);
  assert.match(streamingReply, /<MessageAvatar>/);
  assert.match(streamingReply, /<Bubble variant="ghost" className="max-w-full">/);
  assert.doesNotMatch(streamingReply, /border-dashed/);
});

test("streaming reply keeps one stable scroller item while persisted data is reconciled", () => {
  assert.match(source, /persistedMessageForDraftReply\(model\.messages, draftReply\)/);
  assert.match(source, /messagesWithoutReconciledReply\(model\.messages, persistedDraftReply\)/);
  assert.match(source, /<MarkdownMessageBody body=\{persistedMessage\?\.body \?\? draftReply\.content\} \/>/);
});

test("Activity selection does not add a persistent second frame around message content", () => {
  assert.doesNotMatch(source, /bg-muted\/45 ring-1 ring-border/);
  assert.match(source, /hover:bg-muted\/20 focus-visible:bg-muted\/30 focus-visible:outline-none/);
  assert.doesNotMatch(source, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.match(source, /aria-pressed=\{activitySource \? isActivitySourceSelected : undefined\}/);
});

test("channel composers offer literal @all in both new and existing topics", () => {
  assert.match(source, /allowAllMention=\{model\.selectedContainer\?\.kind === "channel"\}/);
  assert.match(draftEntrySource, /allowAllMention=\{model\.selectedContainer\?\.kind === "channel"\}/);
});
