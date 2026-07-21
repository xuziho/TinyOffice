import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("renders GFM tables and visually distinct links in message bodies", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { MarkdownMessageBody } = await import("./MessagePanel");
  const html = renderToStaticMarkup(
    <MarkdownMessageBody body={`| Platform | Link |\n| --- | --- |\n| Registry | [Official MCP Registry](https://example.com) |`} />,
  );

  assert.match(html, /data-slot="table"/);
  assert.match(html, /data-slot="table-head"/);
  assert.match(html, /data-slot="table-cell"/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /text-\[var\(--tiny-tab-active-ink\)\]/);
  assert.match(html, /Official MCP Registry/);
  assert.doesNotMatch(html, /\| Platform \| Link \|/);
});
