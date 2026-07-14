import assert from "node:assert/strict";
import test from "node:test";

import { logicalRuntimeSessionToolCounts } from "../../src/runtime/storage/runtime-session-tool-counts.js";

test("runtime session tool counts include raw PI execution events without double-counting semantic evidence", () => {
  const counts = logicalRuntimeSessionToolCounts([
    { id: "semantic-call", kind: "model_tool_call", payload: { toolCallId: "call-1" } },
    { id: "raw-call", kind: "tool_execution_start", rawEventKind: "tool_execution_start", payload: { toolCallId: "call-1", toolName: "read" } },
    { id: "raw-result", kind: "tool_execution_end", rawEventKind: "tool_execution_end", payload: { toolCallId: "call-1", toolName: "read" } },
    { id: "second-call", kind: "tool_execution_start", rawEventKind: "tool_execution_start", payload: { toolCallId: "call-2", toolName: "bash" } },
  ]);

  assert.deepEqual(counts, { toolCallCount: 2, toolResultCount: 1 });
});
