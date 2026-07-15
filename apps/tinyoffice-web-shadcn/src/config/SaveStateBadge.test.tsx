import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SaveStateBadge } from "./SaveStateBadge";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("keeps save state quiet after a successful save", () => {
  assert.equal(renderToStaticMarkup(<SaveStateBadge dirty={false} />), "");
});

test("shows only actionable save states", () => {
  assert.match(renderToStaticMarkup(<SaveStateBadge dirty />), /Unsaved changes/);
  assert.match(renderToStaticMarkup(<SaveStateBadge dirty saving />), /Saving/);
});
