import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInitialPostgresSchemaSql,
  postgresSchemaMigrations,
} from "../../src/runtime/company-config/postgres-schema.js";
import {
  runPostgresSchemaMigrations,
  type PostgresMigrationClient,
} from "../../src/runtime/company-config/postgres-company-database.js";

function createTableSql(sql: string, tableName: string): string {
  const match = sql.match(new RegExp("CREATE TABLE IF NOT EXISTS " + tableName + " \\([\\s\\S]*?\\n\\);"));
  assert.ok(match, "missing CREATE TABLE for " + tableName);
  return match[0];
}

test("postgres initial schema covers active tables and excludes retired legacy tables", () => {
  const sql = buildInitialPostgresSchemaSql();

  assert.match(createTableSql(sql, "user_profiles"), /current_company_id text REFERENCES companies\(company_id\) ON DELETE SET NULL/);
  const companyMembersTable = createTableSql(sql, "company_members");
  assert.match(companyMembersTable, /display_name text NOT NULL CHECK \(btrim\(display_name\) <> ''\)/);
  assert.match(companyMembersTable, /role text NOT NULL CHECK \(btrim\(role\) <> ''\)/);
  assert.match(companyMembersTable, /avatar_seed text NOT NULL CHECK \(btrim\(avatar_seed\) <> ''\)/);

  for (const tableName of [
    "companies",
    "company_members",
    "member_runtime_profiles",
    "chat_channels",
    "chat_channel_members",
    "conversations",
    "conversation_participants",
    "conversation_messages",
    "chat_attachments",
    "intake_events",
    "work_tasks",
    "work_task_revisions",
    "work_schedules",
    "work_runs",
    "work_run_events",
    "work_dispatch_leases",
    "work_blocked_recovery_requests",
    "channel_topics",
    "channel_topic_handoffs",
    "session_records",
    "session_events",
    "process_trace_events",
    "collaboration_action_events",
    "memory_summaries",
    "runtime_storage_retention_state",
    "governance_approvals",
    "approval_grants",
    "office_tool_audit_logs",
    "operating_events",
    "prompt_policy_blocks",
    "prompt_policy_templates",
    "prompt_policy_bindings",
    "tool_safety_policies",
    "handoff_replay_ledger",
    "system_ai_provider_configs",
    "system_ai_audit_events",
  ]) {
    assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS " + tableName + "\\b"));
  }

  for (const retiredTableName of [
    "tasks",
    "task_action_logs",
    "task_dispatch_leases",
    "work_plans",
    "responsibility_domains",
    "company_participants",
    "company_mattermost_bindings",
    "employee_mattermost_accounts",
    "employees",
    "employee_runtime_configs",
    "employee_resource_policies",
    "conversation_carriers",
    "message_carriers",
    "employee_account_links",
    "channel_topic_bindings",
  ]) {
    assert.doesNotMatch(sql, new RegExp("CREATE TABLE IF NOT EXISTS " + retiredTableName + "\\b"));
  }
});

test("postgres initial schema scopes shared runtime tables by company", () => {
  const sql = buildInitialPostgresSchemaSql();
  const companyScopedTables = [
    "company_members",
    "member_runtime_profiles",
    "chat_channels",
    "chat_channel_members",
    "conversations",
    "conversation_participants",
    "conversation_messages",
    "chat_attachments",
    "intake_events",
    "prompt_policy_blocks",
    "prompt_policy_templates",
    "prompt_policy_bindings",
    "tool_safety_policies",
    "work_tasks",
    "work_task_revisions",
    "work_schedules",
    "work_runs",
    "work_run_events",
    "work_dispatch_leases",
    "work_blocked_recovery_requests",
    "channel_topics",
    "channel_topic_handoffs",
    "session_records",
    "session_events",
    "process_trace_events",
    "collaboration_action_events",
    "memory_summaries",
    "runtime_storage_retention_state",
    "governance_approvals",
    "approval_grants",
    "office_tool_audit_logs",
    "operating_events",
    "handoff_replay_ledger",
    "system_ai_provider_configs",
    "system_ai_audit_events",
  ];

  assert.match(sql, /CREATE TABLE IF NOT EXISTS companies \(\s+company_id text PRIMARY KEY,/);
  for (const tableName of companyScopedTables) {
    assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS " + tableName + " \\([\\s\\S]*?company_id text NOT NULL REFERENCES companies\\(company_id\\) ON DELETE CASCADE,"));
  }
});

test("postgres initial schema uses member-first Chat and Work identity", () => {
  const sql = buildInitialPostgresSchemaSql();

  const chatChannelMembersTable = createTableSql(sql, "chat_channel_members");
  assert.match(chatChannelMembersTable, /member_id text NOT NULL/);
  assert.doesNotMatch(chatChannelMembersTable, /employee_id text/);
  assert.doesNotMatch(chatChannelMembersTable, /CONSTRAINT chat_channel_members_identity_check CHECK/);
  assert.match(sql, /idx_chat_channel_members_member_identity/);
  assert.doesNotMatch(sql, /idx_chat_channel_members_employee_identity/);

  const chatAttachmentsTable = createTableSql(sql, "chat_attachments");
  assert.match(chatAttachmentsTable, /owner_member_id text NOT NULL/);
  assert.doesNotMatch(chatAttachmentsTable, /owner_employee_id/);

  const channelTopicsTable = createTableSql(sql, "channel_topics");
  assert.match(channelTopicsTable, /owner_member_id text NOT NULL/);
  assert.match(channelTopicsTable, /participant_member_ids_json jsonb NOT NULL/);
  assert.doesNotMatch(channelTopicsTable, /owner_employee_id|participant_employee_ids_json/);
  assert.match(sql, /idx_channel_topics_owner_member/);
  assert.doesNotMatch(sql, /idx_channel_topics_owner ON/);

  const workTasksTable = createTableSql(sql, "work_tasks");
  assert.match(workTasksTable, /created_by_member_id text NOT NULL/);
  assert.match(workTasksTable, /owner_member_id text NOT NULL/);
  assert.doesNotMatch(workTasksTable, /paused_reason/);
  assert.doesNotMatch(workTasksTable, /created_by_employee_id|owner_employee_id/);

  const workRunsTable = createTableSql(sql, "work_runs");
  assert.match(workRunsTable, /assignee_member_id text NOT NULL/);
  assert.match(workRunsTable, /triggered_by IN \('immediate', 'schedule', 'recurrence', 'migration', 'retry'\)/);
  assert.doesNotMatch(workRunsTable, /handoff_from_member_id|handoff_reason/);
  assert.doesNotMatch(workRunsTable, /assignee_employee_id|handoff_from_employee_id/);

  const workRunEventsTable = createTableSql(sql, "work_run_events");
  assert.match(workRunEventsTable, /actor_member_id text NOT NULL/);
  assert.doesNotMatch(workRunEventsTable, /actor_employee_id/);

  const workBlockedRecoveryRequestsTable = createTableSql(sql, "work_blocked_recovery_requests");
  assert.match(workBlockedRecoveryRequestsTable, /assignee_member_id text NOT NULL/);
  assert.match(workBlockedRecoveryRequestsTable, /requester_member_id text NOT NULL/);
  assert.doesNotMatch(workBlockedRecoveryRequestsTable, /assignee_employee_id|requester_employee_id/);

  const governanceApprovalsTable = createTableSql(sql, "governance_approvals");
  assert.match(governanceApprovalsTable, /requested_by_member_id text NOT NULL/);
  assert.match(governanceApprovalsTable, /requested_approver_member_id text/);
  assert.match(governanceApprovalsTable, /resolved_by_member_id text/);
  assert.doesNotMatch(governanceApprovalsTable, /requested_by_employee_id|requested_approver_id|resolved_by_participant_id/);

  const approvalGrantsTable = createTableSql(sql, "approval_grants");
  assert.match(approvalGrantsTable, /member_id text NOT NULL/);
  assert.doesNotMatch(approvalGrantsTable, /employee_id text/);
  assert.match(sql, /idx_approval_grants_member_action/);

  const attachmentReferencesTable = createTableSql(sql, "chat_attachment_references");
  assert.match(attachmentReferencesTable, /FOREIGN KEY \(company_id, attachment_id\) REFERENCES chat_attachments/);
  assert.match(attachmentReferencesTable, /FOREIGN KEY \(company_id, message_id\) REFERENCES conversation_messages/);

  const operatingEventsTable = createTableSql(sql, "operating_events");
  assert.match(operatingEventsTable, /actor_member_id text NOT NULL/);
  assert.doesNotMatch(operatingEventsTable, /actor_employee_id/);
  assert.match(sql, /idx_operating_events_actor_member/);

  const handoffReplayLedgerTable = createTableSql(sql, "handoff_replay_ledger");
  assert.match(handoffReplayLedgerTable, /sender_member_id text NOT NULL/);
  assert.doesNotMatch(handoffReplayLedgerTable, /sender_employee_id/);
});

test("postgres initial schema excludes retired carrier and compatibility residue", () => {
  const sql = buildInitialPostgresSchemaSql();

  assert.doesNotMatch(sql, /mattermost_login_id/);
  assert.doesNotMatch(sql, /mattermost_user_id text/);
  assert.doesNotMatch(sql, /root_post_id text/);
  assert.doesNotMatch(sql, /source_root_post_id text/);
  assert.doesNotMatch(sql, /outcome text/);
  assert.doesNotMatch(sql, /context_mode text/);
  assert.doesNotMatch(sql, /work_plan_id text/);
  assert.match(sql, /topic_state_json jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /participant_states_json jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /runtime_links_json jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /mentions_json jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /identity_source text NOT NULL DEFAULT 'tinyoffice_room'/);
});

test("postgres migrations include the baseline and Channel role hard cut without historical residue", () => {
  assert.deepEqual(
    postgresSchemaMigrations.map((migration) => migration.id),
    [
      "pg_001_pre_release_baseline_20260704_chat_member_identity",
      "pg_002_remove_channel_member_role_20260705",
      "pg_003_create_work_blocked_recovery_requests_20260709",
      "pg_004_hard_cut_work_task_lifecycle_20260710",
      "pg_005_close_work_run_lifecycle_gaps_20260710",
      "pg_006_task_revisions_and_schedule_invariants_20260710",
      "pg_007_member_runtime_lifecycle_20260711",
      "pg_008_user_profiles_20260711",
      "pg_009_user_current_company_20260712",
      "pg_010_persisted_member_avatars_20260712",
      "pg_011_chat_attachment_references_20260713",
      "pg_012_single_owner_authentication_20260714",
      "pg_013_chat_topic_single_ball_chain_20260714",
      "pg_014_owner_profile_initialization_20260714",
      "pg_015_company_member_identity_integrity_20260715",
    ],
  );
  assert.equal(postgresSchemaMigrations[0]?.sql, buildInitialPostgresSchemaSql());

  const migrationSql = postgresSchemaMigrations.map((migration) => migration.sql).join("\n");
  assert.doesNotMatch(migrationSql, /RAISE EXCEPTION/);
  assert.doesNotMatch(migrationSql, /to_regclass|information_schema\.columns/);
  assert.doesNotMatch(migrationSql, /DROP TABLE IF EXISTS/);
  assert.match(migrationSql, /ALTER TABLE chat_channel_members\s+DROP COLUMN IF EXISTS role/);
  assert.match(migrationSql, /UPDATE work_tasks[\s\S]*status = 'active'[\s\S]*WHERE status = 'paused'/);
  assert.match(migrationSql, /ALTER TABLE work_tasks\s+DROP COLUMN IF EXISTS paused_reason/);
  assert.match(migrationSql, /UPDATE work_runs[\s\S]*triggered_by = 'immediate'[\s\S]*WHERE triggered_by = 'manual'/);
  assert.match(migrationSql, /DROP COLUMN IF EXISTS handoff_from_member_id/);
  assert.match(migrationSql, /work_runs_triggered_by_check/);
  assert.match(migrationSql, /work_schedules_enabled_next_run_check/);
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS work_task_revisions/);
  assert.match(migrationSql, /member_runtime_profiles_lifecycle_status_check/);
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS chat_topic_chains/);
  assert.match(migrationSql, /idx_chat_topic_chains_one_active_room/);
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS chat_topic_chain_runs/);
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS profile_initialized_at timestamptz/);
  assert.match(migrationSql, /ALTER COLUMN display_name SET NOT NULL/);
  assert.match(migrationSql, /company_members_role_nonempty/);
  assert.doesNotMatch(migrationSql, /assignee_employee_id|created_by_employee_id|handoff_from_employee_id/);
  assert.doesNotMatch(migrationSql, /requested_by_employee_id|requested_approver_id|resolved_by_participant_id|actor_employee_id/);
  assert.doesNotMatch(createTableSql(migrationSql, "work_tasks"), /owner_employee_id/);
  assert.doesNotMatch(createTableSql(migrationSql, "approval_grants"), /employee_id/);
  assert.doesNotMatch(createTableSql(migrationSql, "chat_attachments"), /owner_employee_id/);
  assert.doesNotMatch(createTableSql(migrationSql, "channel_topics"), /owner_employee_id|participant_employee_ids_json/);
  assert.doesNotMatch(createTableSql(migrationSql, "handoff_replay_ledger"), /sender_employee_id/);
  assert.doesNotMatch(migrationSql, /chat_channel_members_identity_check/);
});

class FakePostgresClient implements PostgresMigrationClient {
  readonly queries: string[] = [];

  constructor(private readonly appliedIds: string[] = []) {}

  async query(sql: string, params?: unknown[]) {
    this.queries.push(params ? sql + " " + JSON.stringify(params) : sql);
    if (/SELECT id FROM schema_migrations/.test(sql)) {
      return {
        rows: this.appliedIds.map((id) => ({ id })),
      };
    }
    return { rows: [] };
  }
}

test("postgres migration runner applies pending migrations transactionally", async () => {
  const client = new FakePostgresClient();

  const result = await runPostgresSchemaMigrations(client);

  assert.deepEqual(result.appliedMigrationIds, [
    "pg_001_pre_release_baseline_20260704_chat_member_identity",
    "pg_002_remove_channel_member_role_20260705",
    "pg_003_create_work_blocked_recovery_requests_20260709",
    "pg_004_hard_cut_work_task_lifecycle_20260710",
    "pg_005_close_work_run_lifecycle_gaps_20260710",
    "pg_006_task_revisions_and_schedule_invariants_20260710",
    "pg_007_member_runtime_lifecycle_20260711",
    "pg_008_user_profiles_20260711",
    "pg_009_user_current_company_20260712",
    "pg_010_persisted_member_avatars_20260712",
    "pg_011_chat_attachment_references_20260713",
    "pg_012_single_owner_authentication_20260714",
    "pg_013_chat_topic_single_ball_chain_20260714",
    "pg_014_owner_profile_initialization_20260714",
    "pg_015_company_member_identity_integrity_20260715",
  ]);
  assert.ok(client.queries.some((query) => query === "BEGIN"));
  assert.ok(client.queries.some((query) => /CREATE TABLE IF NOT EXISTS schema_migrations/.test(query)));
  assert.ok(client.queries.some((query) => /CREATE TABLE IF NOT EXISTS member_runtime_profiles/.test(query)));
  assert.ok(client.queries.some((query) => /ALTER TABLE chat_channel_members\s+DROP COLUMN IF EXISTS role/.test(query)));
  assert.ok(client.queries.some((query) => /INSERT INTO schema_migrations/.test(query)));
  assert.ok(client.queries.some((query) => query === "COMMIT"));
});

test("postgres migration runner applies current migrations after the baseline", async () => {
  const client = new FakePostgresClient(["pg_001_pre_release_baseline_20260704_chat_member_identity"]);

  const result = await runPostgresSchemaMigrations(client);

  assert.deepEqual(result.appliedMigrationIds, [
    "pg_002_remove_channel_member_role_20260705",
    "pg_003_create_work_blocked_recovery_requests_20260709",
    "pg_004_hard_cut_work_task_lifecycle_20260710",
    "pg_005_close_work_run_lifecycle_gaps_20260710",
    "pg_006_task_revisions_and_schedule_invariants_20260710",
    "pg_007_member_runtime_lifecycle_20260711",
    "pg_008_user_profiles_20260711",
    "pg_009_user_current_company_20260712",
    "pg_010_persisted_member_avatars_20260712",
    "pg_011_chat_attachment_references_20260713",
    "pg_012_single_owner_authentication_20260714",
    "pg_013_chat_topic_single_ball_chain_20260714",
    "pg_014_owner_profile_initialization_20260714",
    "pg_015_company_member_identity_integrity_20260715",
  ]);
  assert.ok(client.queries.some((query) => /ALTER TABLE chat_channel_members\s+DROP COLUMN IF EXISTS role/.test(query)));
  assert.ok(client.queries.some((query) => /CREATE TABLE IF NOT EXISTS work_blocked_recovery_requests/.test(query)));
  assert.ok(client.queries.some((query) => /DROP COLUMN IF EXISTS paused_reason/.test(query)));
});

test("postgres migration runner skips current migrations when already applied", async () => {
  const client = new FakePostgresClient([
    "pg_001_pre_release_baseline_20260704_chat_member_identity",
    "pg_002_remove_channel_member_role_20260705",
    "pg_003_create_work_blocked_recovery_requests_20260709",
    "pg_004_hard_cut_work_task_lifecycle_20260710",
    "pg_005_close_work_run_lifecycle_gaps_20260710",
    "pg_006_task_revisions_and_schedule_invariants_20260710",
    "pg_007_member_runtime_lifecycle_20260711",
    "pg_008_user_profiles_20260711",
    "pg_009_user_current_company_20260712",
    "pg_010_persisted_member_avatars_20260712",
    "pg_011_chat_attachment_references_20260713",
    "pg_012_single_owner_authentication_20260714",
    "pg_013_chat_topic_single_ball_chain_20260714",
    "pg_014_owner_profile_initialization_20260714",
    "pg_015_company_member_identity_integrity_20260715",
  ]);

  const result = await runPostgresSchemaMigrations(client);

  assert.deepEqual(result.appliedMigrationIds, []);
  assert.ok(client.queries.some((query) => /SELECT id FROM schema_migrations/.test(query)));
  assert.equal(client.queries.includes("BEGIN"), false);
  assert.equal(client.queries.includes("COMMIT"), false);
});

test("postgres migration runner rejects retired pre-release migration history", async () => {
  const client = new FakePostgresClient(["pg_001_initial", "pg_034_work_member_identity_hard_cut"]);

  await assert.rejects(
    () => runPostgresSchemaMigrations(client),
    /retired pre-release migrations: pg_001_initial, pg_034_work_member_identity_hard_cut.*Reset the TinyOffice test database/,
  );
  assert.equal(client.queries.includes("BEGIN"), false);
  assert.equal(client.queries.includes("COMMIT"), false);
});
