import type { ProcessEventEmitter } from "./natural-language-responder-contracts.js";
import type { NaturalLanguageResponseInput } from "./natural-language-responder-contracts.js";

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
}) {
  let bufferedDelta = "";
  let lastDeltaFlushAt = 0;

  const flushTextDelta = (force = false) => {
    const responseInput = input.responseInput;
    if (!responseInput.enableTextDeltas || !bufferedDelta.trim()) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastDeltaFlushAt < 400) {
      return;
    }

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
  };
}
