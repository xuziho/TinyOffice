import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("section navigation renders one integrated active tab with canonical links", async () => {
  Object.assign(globalThis, { React });
  const { SectionNavigation } = await import("./SectionNavigation");
  const markup = renderToStaticMarkup(
    <SectionNavigation
      activeView="sessions"
      section={{
        title: "Operations",
        items: [
          { view: "sessions", label: "Runtime Sessions" },
          { view: "doctor", label: "Health" },
        ],
      }}
      onSelect={() => undefined}
    />,
  );

  assert.match(markup, /aria-label="Operations pages"/);
  assert.match(markup, /href="\/sessions" aria-current="page"/);
  assert.match(markup, /data-active="true"/);
  assert.match(markup, /href="\/doctor"/);
  assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1);
});
