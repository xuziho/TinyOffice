type InvalidationAction = () => void;

interface PendingInvalidation {
  action: InvalidationAction;
  pending: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export interface RealtimeInvalidationCoalescer {
  invalidate(key: string, action: InvalidationAction): void;
  dispose(): void;
}

export function createRealtimeInvalidationCoalescer(windowMs = 250): RealtimeInvalidationCoalescer {
  const entries = new Map<string, PendingInvalidation>();

  const flushWindow = (key: string) => {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }
    if (!entry.pending) {
      entries.delete(key);
      return;
    }
    entry.pending = false;
    entry.action();
    entry.timer = setTimeout(() => flushWindow(key), windowMs);
  };

  const startWindow = (key: string, action: InvalidationAction) => {
    entries.set(key, {
      action,
      pending: false,
      timer: setTimeout(() => flushWindow(key), windowMs),
    });
  };

  return {
    invalidate(key, action) {
      const existing = entries.get(key);
      if (existing) {
        existing.action = action;
        existing.pending = true;
        return;
      }
      action();
      startWindow(key, action);
    },
    dispose() {
      for (const entry of entries.values()) {
        clearTimeout(entry.timer);
      }
      entries.clear();
    },
  };
}
