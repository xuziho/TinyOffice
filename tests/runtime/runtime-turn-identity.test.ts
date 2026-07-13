import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeTurnIdentity,
} from "../../src/runtime/orchestration/runtime-turn-identity.js";
import {
  buildRuntimeModelCallLifecycleEvent,
  buildRuntimeSceneTurn,
} from "../../src/runtime/orchestration/runtime-scene-turn.js";

test("runtime turn identity uses the owned session subject", () => {
  const identity = buildRuntimeTurnIdentity({
    employeeId: "mira-hr",
    sessionKey: "mira-hr|dm_thread|room-1",
  });

  assert.equal(identity.sceneType, "dm_thread");
  assert.equal(identity.sceneId, "mira-hr|dm_thread|room-1");
  assert.equal(identity.primaryModelCallId.endsWith("|model_call|primary"), true);
});

test("runtime turn identity keeps malformed session keys as owned session subjects", () => {
  const identity = buildRuntimeTurnIdentity({
    employeeId: "mira-hr",
    sessionKey: "malformed-session-key",
  });

  assert.equal(identity.sceneType, "channel_thread");
  assert.equal(identity.sceneId, "mira-hr|channel_thread|malformed-session-key");
});

test("runtime scene turn selects the primary model call by default", () => {
  const turn = buildRuntimeSceneTurn({
    employeeId: "mira-hr",
    sessionKey: "mira-hr|dm_thread|room-1",
  });

  assert.equal(turn.identity.sceneType, "dm_thread");
  assert.equal(turn.modelCall.purpose, "primary");
  assert.equal(turn.modelCall.id, turn.identity.primaryModelCallId);
});

test("runtime scene turn has no completion policy boundary on the primary model call", () => {
  const turn = buildRuntimeSceneTurn({
    employeeId: "mira-hr",
    sessionKey: "mira-hr|channel_thread|room-1",
  });

  assert.equal(turn.modelCall.purpose, "primary");
  assert.equal(turn.modelCall.id, turn.identity.primaryModelCallId);
  assert.equal(Object.prototype.hasOwnProperty.call(turn.modelCall, "completionPolicyKind"), false);
});

test("runtime scene turn builds model call lifecycle events with stable boundary payload", () => {
  const turn = buildRuntimeSceneTurn({
    employeeId: "mira-hr",
    sessionKey: "mira-hr|channel_thread|room-1",
  });

  const event = buildRuntimeModelCallLifecycleEvent(turn, "model_call_started", {
    title: "Model call started",
    payload: { activeToolNames: ["handoff"] },
  });

  assert.equal(event.kind, "model_call_started");
  assert.equal(event.source, "runtime.model_call");
  assert.equal(event.visibility, "diagnostic");
  assert.equal(event.semanticRole, "model_call_lifecycle");
  assert.equal(event.rawEventKind, "model_call_started");
  assert.equal(event.payload.sceneId, turn.identity.sceneId);
  assert.equal(event.payload.turnId, turn.identity.turnId);
  assert.equal(event.payload.runId, turn.identity.runId);
  assert.equal(event.payload.modelCallId, turn.modelCall.id);
  assert.equal(event.payload.modelCallPurpose, "primary");
  assert.deepEqual(event.payload.activeToolNames, ["handoff"]);
});
