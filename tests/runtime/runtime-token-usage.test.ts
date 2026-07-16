import assert from "node:assert/strict";
import test from "node:test";

import { buildTurnUsage } from "../../src/runtime/pi/session-explorer-projection-detail.js";
import type { RuntimeSessionEvent } from "../../src/runtime/storage/runtime-session-repository.js";

test("runtime turn usage counts each model call once and sums follow-up calls", () => {
  const base = {
    sessionRecordId: "session-usage",
    timestamp: "2026-06-09T12:00:00.000Z",
    turnId: "turn-1",
    byteSize: 0,
    truncated: false,
  };
  const events = [{
    ...base,
    id: "usage-primary-message-end",
    sequence: 1,
    kind: "message_end",
    modelCallId: "call-primary",
    payload: { usage: { input: 100, output: 20, cacheRead: 8 } },
  }, {
    ...base,
    id: "usage-primary-turn-end",
    sequence: 2,
    kind: "turn_end",
    modelCallId: "call-primary",
    payload: { usage: { input: 100, output: 20, cacheRead: 8 } },
  }, {
    ...base,
    id: "usage-state-action-repair",
    sequence: 3,
    kind: "model_call_usage",
    modelCallId: "call-repair",
    payload: { usage: { input: 30, output: 4, cacheWrite: 2 } },
  }] satisfies RuntimeSessionEvent[];

  const usage = buildTurnUsage(events);
  assert.deepEqual(usage.usageByTurn.get("turn-1")?.usage, {
    inputTokens: 130,
    outputTokens: 24,
    cacheTokens: 10,
  });
  assert.equal(usage.usageByModelCall.size, 2);
});
