import type { ProcessEventEmitter } from "./natural-language-responder-contracts.js";
import type { NaturalLanguageResponseInput } from "./natural-language-responder-contracts.js";

export const RUNTIME_TEXT_DELTA_FLUSH_INTERVAL_MS = 50;

export function createRuntimeTextDeltaEmitter(input: {
  responseInput: NaturalLanguageResponseInput;
  preferredLanguage: string;
  emitProcessEvent: ProcessEventEmitter;
  appendModelCallLifecycleEvent: (event: {
    title: string;
    summary?: string;
    preview?: string;
    payload?: Record<string, unknown>;
    byteSize?: number;
    timestamp?: string;
    semanticRole?: string;
  }) => void;
  scheduleRuntimeSessionFlush: () => Promise<void>;
  now?: () => number;
  scheduleTimer?: (callback: () => void, delayMs: number) => unknown;
  cancelTimer?: (timer: unknown) => void;
}) {
  let bufferedDelta = "";
  let lastDeltaFlushAt: number | undefined;
  let scheduledFlush: unknown;

  const cancelScheduledFlush = () => {
    if (scheduledFlush === undefined) {
      return;
    }
    (input.cancelTimer ?? clearTimeout)(scheduledFlush as ReturnType<typeof setTimeout>);
    scheduledFlush = undefined;
  };

  const scheduleTrailingFlush = (delayMs: number) => {
    if (scheduledFlush !== undefined) {
      return;
    }
    scheduledFlush = (input.scheduleTimer ?? setTimeout)(() => {
      scheduledFlush = undefined;
      flushTextDelta(false);
    }, delayMs);
  };

  const flushTextDelta = (force = false) => {
    const responseInput = input.responseInput;
    if (!responseInput.enableTextDeltas || !bufferedDelta.trim()) {
      if (force) {
        cancelScheduledFlush();
      }
      return;
    }

    const now = input.now?.() ?? Date.now();
    if (!force && lastDeltaFlushAt !== undefined) {
      const elapsed = now - lastDeltaFlushAt;
      if (elapsed < RUNTIME_TEXT_DELTA_FLUSH_INTERVAL_MS) {
        scheduleTrailingFlush(RUNTIME_TEXT_DELTA_FLUSH_INTERVAL_MS - Math.max(0, elapsed));
        return;
      }
    }

    cancelScheduledFlush();
    const preview = bufferedDelta.slice(-800);
    bufferedDelta = "";
    lastDeltaFlushAt = now;
    input.emitProcessEvent({
      kind: "model_text_delta",
      sessionKey: responseInput.sessionKey,
      channelTopicId: responseInput.channelTopicId,
      employeeId: responseInput.employee.employeeId,
      title: `${responseInput.employee.employeeId} is generating`,
      preview,
      status: "running",
    });
  };

  return {
    appendTextDelta(delta: string) {
      bufferedDelta += delta;
      flushTextDelta(false);
    },
    flushTextDelta,
    resetTextDelta() {
      cancelScheduledFlush();
      bufferedDelta = "";
      lastDeltaFlushAt = undefined;
    },
  };
}
