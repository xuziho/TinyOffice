import type { ProcessEventEmitter } from "./natural-language-responder-contracts.js";
import { appendRuntimeResponderTrace } from "./natural-language-responder-trace.js";

export function createRuntimeProcessEventDispatcher(input: {
  employeeId: string;
  sessionKey: string;
  onProcessEvent?: ProcessEventEmitter;
}) {
  const pendingProcessEvents = new Set<Promise<void>>();
  const trackPendingProcessEvent = (promise: Promise<void>) => {
    const pending = Promise.resolve(promise)
      .catch((error) =>
        appendRuntimeResponderTrace({
          phase: "reply.process_event_error",
          employeeId: input.employeeId,
          sessionKey: input.sessionKey,
          error: error instanceof Error ? error.stack || error.message : String(error),
        }).catch(() => undefined),
      )
      .finally(() => {
        pendingProcessEvents.delete(pending);
      });
    pendingProcessEvents.add(pending);
    return pending;
  };

  const emitProcessEvent: ProcessEventEmitter = (event) => {
    const result = input.onProcessEvent?.(event);

    if (!result || typeof result.then !== "function") {
      return undefined;
    }

    return trackPendingProcessEvent(Promise.resolve(result));
  };

  const waitForProcessEvents = async () => {
    while (pendingProcessEvents.size > 0) {
      await Promise.allSettled([...pendingProcessEvents]);
    }
  };

  return {
    emitProcessEvent,
    waitForProcessEvents,
  };
}
