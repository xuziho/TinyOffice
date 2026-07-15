import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeShutdownCoordinator } from "../../scripts/runtime/runtime-shutdown-coordinator.js";

test("signal shutdown closes the runtime once when terminating the web child emits exit", () => {
  let webTerminationCount = 0;
  let runtimeCloseCount = 0;
  const exitCodes: number[] = [];
  let completeRuntimeClose: (() => void) | undefined;
  const coordinator = createRuntimeShutdownCoordinator({
    terminateWeb() {
      webTerminationCount += 1;
    },
    closeRuntime(onClosed) {
      runtimeCloseCount += 1;
      completeRuntimeClose = onClosed;
    },
    exit(exitCode) {
      exitCodes.push(exitCode);
    },
  });

  coordinator.shutdown({ exitCode: 0, terminateWeb: true });
  coordinator.shutdown({ exitCode: 9, terminateWeb: false });
  coordinator.shutdown({ exitCode: 0, terminateWeb: true });
  completeRuntimeClose?.();

  assert.equal(webTerminationCount, 1);
  assert.equal(runtimeCloseCount, 1);
  assert.deepEqual(exitCodes, [0]);
});

test("unexpected web exit closes the runtime without trying to terminate the web child again", () => {
  let webTerminationCount = 0;
  let runtimeCloseCount = 0;
  const exitCodes: number[] = [];
  const coordinator = createRuntimeShutdownCoordinator({
    terminateWeb() {
      webTerminationCount += 1;
    },
    closeRuntime(onClosed) {
      runtimeCloseCount += 1;
      onClosed();
    },
    exit(exitCode) {
      exitCodes.push(exitCode);
    },
  });

  coordinator.shutdown({ exitCode: 17, terminateWeb: false });

  assert.equal(webTerminationCount, 0);
  assert.equal(runtimeCloseCount, 1);
  assert.deepEqual(exitCodes, [17]);
});
