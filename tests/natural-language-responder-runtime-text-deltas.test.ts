import assert from "node:assert/strict";
import test from "node:test";
import type { ProcessTraceEventDraft } from "../src/runtime/contracts/process-trace-event.js";
import type { NaturalLanguageResponseInput } from "../src/runtime/provider/natural-language-responder-contracts.js";
import {
  createRuntimeTextDeltaEmitter,
  RUNTIME_TEXT_DELTA_FLUSH_INTERVAL_MS,
} from "../src/runtime/provider/natural-language-responder-runtime-text-deltas.js";

test("emits buffered reply text at a smooth bounded cadence", () => {
  let now = 1_000;
  const events: ProcessTraceEventDraft[] = [];
  const emitter = createRuntimeTextDeltaEmitter({
    responseInput: {
      enableTextDeltas: true,
      sessionKey: "avery|dm_thread|room-1",
      employee: { employeeId: "avery" },
    } as NaturalLanguageResponseInput,
    preferredLanguage: "en",
    emitProcessEvent: (event) => events.push(event),
    appendModelCallLifecycleEvent: () => undefined,
    scheduleRuntimeSessionFlush: async () => undefined,
    now: () => now,
  });

  emitter.appendTextDelta("A");
  now += RUNTIME_TEXT_DELTA_FLUSH_INTERVAL_MS - 1;
  emitter.appendTextDelta("B");
  now += 1;
  emitter.appendTextDelta("C");

  assert.equal(RUNTIME_TEXT_DELTA_FLUSH_INTERVAL_MS, 50);
  assert.deepEqual(events.map((event) => event.preview), ["A", "BC"]);
});
