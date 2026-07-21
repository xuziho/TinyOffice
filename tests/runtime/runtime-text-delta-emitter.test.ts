import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeTextDeltaEmitter } from "../../src/runtime/provider/natural-language-responder-runtime-text-deltas.js";

test("runtime text deltas emit realtime-only process events without persistent session writes", () => {
  const processEvents: unknown[] = [];
  let lifecycleEventCount = 0;
  let flushCount = 0;

  const emitter = createRuntimeTextDeltaEmitter({
    responseInput: {
      enableTextDeltas: true,
      sessionKey: "alex|chat_direct_room|room-1",
      employee: { employeeId: "alex" },
    } as never,
    preferredLanguage: "en-US",
    emitProcessEvent: (event) => {
      processEvents.push(event);
    },
    appendModelCallLifecycleEvent: () => {
      lifecycleEventCount += 1;
    },
    scheduleRuntimeSessionFlush: async () => {
      flushCount += 1;
    },
  });

  emitter.appendTextDelta("Hello");

  assert.equal(processEvents.length, 1);
  assert.equal(lifecycleEventCount, 0);
  assert.equal(flushCount, 0);
});

test("runtime text delta reset drops buffered text from the failed provider attempt", () => {
  const previews: string[] = [];
  let now = 0;
  const emitter = createRuntimeTextDeltaEmitter({
    responseInput: {
      enableTextDeltas: true,
      sessionKey: "alex|chat_direct_room|room-1",
      employee: { employeeId: "alex" },
    } as never,
    preferredLanguage: "en-US",
    emitProcessEvent: (event) => {
      previews.push(event.preview || "");
    },
    appendModelCallLifecycleEvent: () => undefined,
    scheduleRuntimeSessionFlush: async () => undefined,
    now: () => now,
  });

  emitter.appendTextDelta("visible attempt");
  now = 10;
  emitter.appendTextDelta("partial attempt");
  emitter.resetTextDelta();
  now = 100;
  emitter.appendTextDelta("clean retry");

  assert.deepEqual(previews, ["visible attempt", "clean retry"]);
});

test("runtime text deltas flush a buffered tail when the cadence timer expires", () => {
  const previews: string[] = [];
  let now = 100;
  let scheduled: { callback: () => void; delayMs: number } | undefined;
  const emitter = createRuntimeTextDeltaEmitter({
    responseInput: {
      enableTextDeltas: true,
      sessionKey: "alex|chat_direct_room|room-1",
      employee: { employeeId: "alex" },
    } as never,
    preferredLanguage: "en-US",
    emitProcessEvent: (event) => previews.push(event.preview || ""),
    appendModelCallLifecycleEvent: () => undefined,
    scheduleRuntimeSessionFlush: async () => undefined,
    now: () => now,
    scheduleTimer(callback, delayMs) {
      scheduled = {
        callback() {
          scheduled = undefined;
          callback();
        },
        delayMs,
      };
      return scheduled;
    },
    cancelTimer(timer) {
      if (scheduled === timer) {
        scheduled = undefined;
      }
    },
  });

  emitter.appendTextDelta("A");
  now = 110;
  emitter.appendTextDelta("B");

  assert.deepEqual(previews, ["A"]);
  assert.equal(scheduled?.delayMs, 40);

  now = 150;
  const trailingFlush = scheduled?.callback;
  assert.ok(trailingFlush);
  trailingFlush();

  assert.deepEqual(previews, ["A", "B"]);
  assert.equal(scheduled, undefined);
});
