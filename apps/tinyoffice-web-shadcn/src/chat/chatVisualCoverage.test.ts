import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const composer = readFileSync(new URL("./Composer.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./WorkspaceSidebar.tsx", import.meta.url), "utf8");
const messagePanel = readFileSync(new URL("./MessagePanel.tsx", import.meta.url), "utf8");
const contextPanel = readFileSync(new URL("./ContextPanel.tsx", import.meta.url), "utf8");
const accessCards = readFileSync(new URL("../access/AccessRequestCards.tsx", import.meta.url), "utf8");
const chatRoute = readFileSync(new URL("./ChatWorkspaceRoute.tsx", import.meta.url), "utf8");

test("Chat density keeps compact controls and clean 44px stream avatars", () => {
  assert.match(css, /\.tiny-soft-retro-chat \.tiny-message-row \{[\s\S]*?margin-block: 14px;\s*\}/);
  assert.match(css, /\.tiny-soft-retro-chat \.tiny-composer-input \{\s*min-height: 60px;/);
  assert.match(css, /\.tiny-soft-retro-chat \.tiny-tool-button \{\s*width: 28px;\s*height: 28px;/);
  assert.match(css, /\.tiny-soft-retro-chat \.tiny-send-button \{\s*width: 32px;\s*height: 32px;/);
  assert.match(css, /\[data-slot="message-avatar"\] \[data-slot="avatar"\] \{\s*width: 44px;/);
  assert.match(css, /min-height: 44px;/);
  assert.match(css, /background: transparent !important;[\s\S]*?border-radius: 999px !important;/);
  assert.match(messagePanel, /className="size-11"/);
});

test("Chat keeps avatars in an outside gutter and demotes the archived entry", () => {
  assert.match(css, /\.tiny-soft-retro-chat \.tiny-message-item \{\s*width: calc\(100% \+ 92px\);\s*margin-left: -46px;/);
  assert.match(css, /grid-template-columns: 44px minmax\(0, 1fr\) 44px;/);
  assert.match(css, /\[data-align="start"\] > \[data-slot="message-avatar"\] \{\s*grid-column: 1;/);
  assert.match(css, /\[data-align="end"\] > \[data-slot="message-avatar"\] \{\s*grid-column: 3;/);
  assert.match(messagePanel, /className="tiny-message-item"/);
  assert.match(messagePanel, /overflow-visible/);
  assert.match(css, /\.tiny-soft-retro-chat \.tiny-archived-toggle \{/);
  assert.doesNotMatch(css, /\.tiny-soft-retro-chat \.tiny-archived-count \{/);
  assert.doesNotMatch(css, /\.tiny-message-row:hover \{/);
});

test("Chat conditional overlays use shared TinyOffice classes", () => {
  assert.match(composer, /tiny-chat-mention-popover/);
  assert.match(composer, /tiny-chat-mention-item/);
  assert.match(sidebar, /tiny-chat-dialog/);
  assert.match(messagePanel, /tiny-chat-dialog/);
  assert.match(contextPanel, /tiny-chat-dialog/g);
  assert.match(css, /\.tiny-chat-mention-popover,/);
  assert.match(css, /\.tiny-chat-dialog \{/);
});

test("Channel marks and access approvals use the simplified product treatment", () => {
  assert.match(sidebar, /tiny-channel-mark size-5/);
  assert.match(css, /\.tiny-soft-retro-chat \.tiny-channel-mark \{\s*border: 0;/);
  assert.match(accessCards, /tiny-chat-access-card/);
  assert.match(css, /\.tiny-soft-retro-chat \.tiny-chat-access-card \{/);
});

test("Chat uses a responsive Context column and conventional back-action order", () => {
  assert.match(chatRoute, /tiny-chat-workbench tiny-soft-retro-chat/);
  assert.match(css, /grid-template-columns: 274px minmax\(0, 1fr\) clamp\(248px, 22vw, 320px\);/);
  assert.match(messagePanel, /<header[\s\S]*?aria-label="Back to list"[\s\S]*?tiny-room-title/);
});

test("Channel participants expose the current Topic holder with a quiet text status", () => {
  assert.match(contextPanel, /tiny-participant-chat-status/);
  assert.match(contextPanel, /role="status"/);
  assert.match(contextPanel, /motion-safe:animate-pulse/);
  assert.match(css, /\.tiny-participant-chat-status \{/);
  assert.match(css, /\.tiny-participant-chat-status-stopping \{/);
});
