import assert from "node:assert/strict";
import test from "node:test";

import { canAcceptImageFile, pendingImageFromFile } from "./imageAttachmentState";

test("canAcceptImageFile accepts png jpeg and webp only", () => {
  assert.equal(canAcceptImageFile(new File(["x"], "a.png", { type: "image/png" })), true);
  assert.equal(canAcceptImageFile(new File(["x"], "a.jpg", { type: "image/jpeg" })), true);
  assert.equal(canAcceptImageFile(new File(["x"], "a.webp", { type: "image/webp" })), true);
  assert.equal(canAcceptImageFile(new File(["x"], "a.gif", { type: "image/gif" })), false);
  assert.equal(canAcceptImageFile(new File(["x"], "a.txt", { type: "text/plain" })), false);
});

test("pendingImageFromFile creates local preview state", () => {
  const pending = pendingImageFromFile(new File(["x"], "a.png", { type: "image/png" }));
  assert.equal(pending.fileName, "a.png");
  assert.equal(pending.mimeType, "image/png");
  assert.equal(pending.status, "queued");
  assert.equal(typeof pending.previewObjectUrl, "string");
});
