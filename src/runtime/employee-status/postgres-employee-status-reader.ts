import { topicFromRow } from "../../channel-topics/storage/postgres-channel-topic-store.js";
import type { ChannelTopic } from "../../channel-topics/domain/channel-topic.js";
import type { WorkRunRecord, WorkScheduleRecord, WorkTaskRecord } from "../../work/domain.js";
import { leaseFromRow } from "../../work/postgres-work-dispatch-lease-repository.js";
import {
  workRunFromRow,
  workScheduleFromRow,
  workTaskFromRow,
} from "../../work/postgres-work-repository.js";
import type { WorkDispatchLeaseRecord } from "../../work/work-dispatch-lease.js";
import type { PostgresMigrationClient } from "../company-config/postgres-company-database.js";
import { sessionRecordFromRow } from "../storage/postgres-runtime-session-repository.js";
import type { RuntimeSessionRecord } from "../storage/runtime-session-repository.js";

export interface EmployeeStatusPostgresSnapshot {
  workTasks: WorkTaskRecord[];
  workSchedules: WorkScheduleRecord[];
  workRuns: WorkRunRecord[];
  dispatchLeases: WorkDispatchLeaseRecord[];
  sessions: RuntimeSessionRecord[];
  channelTopics: ChannelTopic[];
}

export async function readEmployeeStatusPostgresSnapshot(
  client: PostgresMigrationClient,
  companyId: string,
): Promise<EmployeeStatusPostgresSnapshot> {
  const workTasks = await client.query(
    "SELECT * FROM work_tasks WHERE company_id = $1 ORDER BY updated_at DESC, created_at DESC, id ASC",
    [companyId],
  );
  const workSchedules = await client.query(
    "SELECT * FROM work_schedules WHERE company_id = $1 ORDER BY updated_at DESC, created_at DESC, id ASC",
    [companyId],
  );
  const workRuns = await client.query(
    "SELECT * FROM work_runs WHERE company_id = $1 ORDER BY created_at ASC, id ASC",
    [companyId],
  );
  const dispatchLeases = await client.query(
    "SELECT * FROM work_dispatch_leases WHERE company_id = $1 ORDER BY dispatched_at DESC, id DESC",
    [companyId],
  );
  const sessions = await client.query(
    "SELECT * FROM session_records WHERE company_id = $1 ORDER BY updated_at DESC, started_at DESC",
    [companyId],
  );
  const channelTopics = await client.query(
    "SELECT * FROM channel_topics WHERE company_id = $1 ORDER BY updated_at ASC, id ASC",
    [companyId],
  );

  return {
    workTasks: workTasks.rows.map(workTaskFromRow),
    workSchedules: workSchedules.rows.map(workScheduleFromRow),
    workRuns: workRuns.rows.map(workRunFromRow),
    dispatchLeases: dispatchLeases.rows.map(leaseFromRow),
    sessions: sessions.rows.map(sessionRecordFromRow),
    channelTopics: channelTopics.rows.map(topicFromRow),
  };
}
