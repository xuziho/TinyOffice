import assert from "node:assert/strict";
import test from "node:test";

import { createRealtimeInvalidationCoalescer } from "./realtimeInvalidationCoalescer";

test("realtime invalidations execute immediately, coalesce a burst, and preserve a trailing refresh", async () => {
  const coalescer = createRealtimeInvalidationCoalescer(15);
  let count = 0;

  coalescer.invalidate("sessions", () => { count += 1; });
  coalescer.invalidate("sessions", () => { count += 1; });
  coalescer.invalidate("sessions", () => { count += 1; });

  assert.equal(count, 1);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(count, 2);

  coalescer.dispose();
});
