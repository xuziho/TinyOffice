import assert from "node:assert/strict";
import test from "node:test";

import {
  createCommandAck,
  createRuntimeCommand,
  createRuntimeEvent,
  isRuntimeEvent,
} from "../../src/runtime/contracts/runtime-realtime-contract.js";

test("runtime realtime events carry stable identity, version, entity, and sequence", () => {
  const event = createRuntimeEvent({
    eventId: "evt-work-1",
    type: "work_run.updated",
    occurredAt: "2026-06-17T10:00:00.000Z",
    sequence: 42,
    entity: {
      kind: "work_run",
      id: "work-run-1",
    },
    payload: {
      status: "blocked",
      assigneeMemberId: "quality-editor",
    },
  });

  assert.equal(event.schema, "runtime-event");
  assert.equal(event.version, 1);
  assert.equal(event.eventId, "evt-work-1");
  assert.equal(event.type, "work_run.updated");
  assert.equal(event.sequence, 42);
  assert.deepEqual(event.entity, {
    kind: "work_run",
    id: "work-run-1",
  });
  assert.deepEqual(event.payload, {
    status: "blocked",
    assigneeMemberId: "quality-editor",
  });
  assert.equal(isRuntimeEvent(event), true);
});

test("runtime realtime work contracts use WorkTask and WorkSchedule product event names", () => {
  const taskEvent = createRuntimeEvent({
    eventId: "evt-work-task-1",
    type: "work_task.updated",
    occurredAt: "2026-06-17T10:00:03.000Z",
    sequence: 43,
    entity: {
      kind: "work_task",
      id: "work-task-1",
    },
    payload: {
      status: "active",
    },
  });
  const scheduleEvent = createRuntimeEvent({
    eventId: "evt-work-schedule-1",
    type: "work_schedule.updated",
    occurredAt: "2026-06-17T10:00:04.000Z",
    sequence: 44,
    entity: {
      kind: "work_schedule",
      id: "work-schedule-1",
    },
    payload: {
      workTaskId: "work-task-1",
    },
  });

  assert.equal(taskEvent.type, "work_task.updated");
  assert.equal(taskEvent.entity.kind, "work_task");
  assert.equal(scheduleEvent.type, "work_schedule.updated");
  assert.equal(scheduleEvent.entity.kind, "work_schedule");
  assert.doesNotMatch(JSON.stringify([taskEvent, scheduleEvent]), /work_plan/);
});

test("runtime commands and acknowledgements separate accepted commands from final state", () => {
  const command = createRuntimeCommand({
    commandId: "cmd-stop-1",
    name: "work_run.cancel",
    issuedAt: "2026-06-17T10:00:01.000Z",
    payload: {
      workRunId: "work-run-1",
    },
  });
  const ack = createCommandAck({
    commandId: command.commandId,
    status: "accepted",
    acceptedAt: "2026-06-17T10:00:01.100Z",
  });

  assert.deepEqual(command, {
    schema: "runtime-command",
    version: 1,
    commandId: "cmd-stop-1",
    name: "work_run.cancel",
    issuedAt: "2026-06-17T10:00:01.000Z",
    payload: {
      workRunId: "work-run-1",
    },
  });
  assert.deepEqual(ack, {
    schema: "runtime-command-ack",
    version: 1,
    commandId: "cmd-stop-1",
    status: "accepted",
    acceptedAt: "2026-06-17T10:00:01.100Z",
  });
});

test("runtime command acknowledgements preserve rejected command errors", () => {
  const ack = createCommandAck({
    commandId: "cmd-stop-2",
    status: "rejected",
    acceptedAt: "2026-06-17T10:00:02.000Z",
    error: {
      code: "work_run_not_stoppable",
      message: "This WorkRun is already done.",
    },
  });

  assert.deepEqual(ack.error, {
    code: "work_run_not_stoppable",
    message: "This WorkRun is already done.",
  });
});
