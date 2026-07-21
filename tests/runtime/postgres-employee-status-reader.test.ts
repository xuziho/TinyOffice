import assert from "node:assert/strict";
import test from "node:test";

import { readEmployeeStatusPostgresSnapshot } from "../../src/runtime/employee-status/postgres-employee-status-reader.js";

test("employee status postgres reader uses one narrow snapshot without historical evidence tables", async () => {
  const queries: string[] = [];
  const snapshot = await readEmployeeStatusPostgresSnapshot({
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
  }, "company-1");

  assert.deepEqual(snapshot, {
    workTasks: [],
    workSchedules: [],
    workRuns: [],
    dispatchLeases: [],
    sessions: [],
    channelTopics: [],
  });
  assert.equal(queries.length, 6);
  assert.match(queries.join("\n"), /FROM work_tasks/);
  assert.match(queries.join("\n"), /FROM session_records/);
  assert.doesNotMatch(
    queries.join("\n"),
    /work_task_revisions|work_run_events|session_events|process_trace_events|collaboration_action_events|memory_summaries|runtime_storage_retention_state|channel_topic_handoffs/,
  );
});
