import assert from "node:assert/strict";
import test from "node:test";

import { selectSingleHandoffCall } from "../../src/runtime/realtime/handoff-call-selection.js";

test("selectSingleHandoffCall uses earliest call when multiple calls exist", () => {
  const earlier = {
    timestamp: "2026-06-04T01:00:00.000Z",
    message: "earlier",
  };
  const later = {
    timestamp: "2026-06-04T01:00:01.000Z",
    message: "later",
  };

  const result = selectSingleHandoffCall([later, earlier]);

  assert.equal(result.selected, earlier);
  assert.deepEqual(result.suppressed, [later]);
});

test("selectSingleHandoffCall returns empty selection for empty input", () => {
  const result = selectSingleHandoffCall([]);

  assert.equal(result.selected, undefined);
  assert.deepEqual(result.suppressed, []);
});
