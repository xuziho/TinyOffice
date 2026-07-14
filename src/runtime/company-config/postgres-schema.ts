export interface PostgresSchemaMigration {
  id: string;
  sql: string;
}

export const DEFAULT_COMPANY_ID = "tinyoffice";

export function buildInitialPostgresSchemaSql(): string {
  return `
CREATE TABLE IF NOT EXISTS companies (
  company_id text PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id text PRIMARY KEY,
  display_name text NOT NULL,
  avatar_seed text,
  current_company_id text REFERENCES companies(company_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

${buildOwnerAuthenticationSchemaSql()}

${buildSystemAiProviderConfigAuditSql()}

CREATE TABLE IF NOT EXISTS company_members (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  display_name text,
  role text,
  summary text,
  avatar_seed text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, id)
);

CREATE TABLE IF NOT EXISTS member_runtime_profiles (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  member_id text NOT NULL,
  presence_mode text NOT NULL,
  model_provider text,
  model_id text,
  thinking_level text NOT NULL DEFAULT 'minimal',
  resource_policy_json jsonb NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'inactive')),
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, member_id),
  FOREIGN KEY (company_id, member_id) REFERENCES company_members(company_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_channels (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  title text NOT NULL,
  summary text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, channel_id)
);

CREATE TABLE IF NOT EXISTS chat_channel_members (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  member_id text NOT NULL,
  display_name text NOT NULL,
  joined_at timestamptz NOT NULL,
  FOREIGN KEY (company_id, channel_id) REFERENCES chat_channels(company_id, channel_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, member_id) REFERENCES company_members(company_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_channel_members_member_identity
ON chat_channel_members(company_id, channel_id, member_id);
CREATE INDEX IF NOT EXISTS idx_chat_channel_members_member
ON chat_channel_members(company_id, member_id);

CREATE TABLE IF NOT EXISTS conversations (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  title text NOT NULL,
  title_status text NOT NULL DEFAULT 'manual',
  title_source_message_id text,
  title_failure_reason text,
  conversation_kind text NOT NULL,
  participants_json jsonb NOT NULL,
  topic_state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  participant_states_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_message_id text,
  runtime_links_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  realtime_sequence bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_topic_state
ON conversations(company_id, ((topic_state_json->>'topicId')));

CREATE TABLE IF NOT EXISTS conversation_participants (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  participant_id text NOT NULL,
  participant_kind text NOT NULL,
  member_id text,
  display_name text NOT NULL,
  role text,
  joined_at timestamptz NOT NULL,
  left_at timestamptz,
  PRIMARY KEY (company_id, conversation_id, participant_id),
  FOREIGN KEY (company_id, conversation_id) REFERENCES conversations(company_id, conversation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_member
ON conversation_participants(company_id, member_id);

CREATE TABLE IF NOT EXISTS conversation_messages (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  message_id text NOT NULL,
  sender_json jsonb NOT NULL,
  body text NOT NULL,
  attachments_json jsonb NOT NULL,
  mentions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  runtime_links_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivery_state text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, message_id),
  FOREIGN KEY (company_id, conversation_id) REFERENCES conversations(company_id, conversation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation
ON conversation_messages(company_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS chat_attachments (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  attachment_id text NOT NULL,
  owner_member_id text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  byte_length bigint NOT NULL,
  storage_key text NOT NULL,
  content_sha256 text NOT NULL,
  local_path text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, attachment_id),
  CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  CHECK (byte_length >= 0)
);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_owner_member
ON chat_attachments(company_id, owner_member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_attachment_references (
  company_id text NOT NULL,
  attachment_id text NOT NULL,
  message_id text NOT NULL,
  conversation_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, attachment_id, message_id),
  FOREIGN KEY (company_id, attachment_id) REFERENCES chat_attachments(company_id, attachment_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, message_id) REFERENCES conversation_messages(company_id, message_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, conversation_id) REFERENCES conversations(company_id, conversation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_attachment_references_message
ON chat_attachment_references(company_id, message_id);

CREATE TABLE IF NOT EXISTS intake_events (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  schema_version text NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  category text NOT NULL,
  event_type text,
  routing_json jsonb,
  priority text,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  status text NOT NULL,
  summary text,
  payload_json jsonb NOT NULL,
  metadata_json jsonb,
  result_json jsonb,
  error text,
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, category, source, source_event_id)
);
CREATE INDEX IF NOT EXISTS idx_intake_events_category_received ON intake_events(company_id, category, received_at);
CREATE INDEX IF NOT EXISTS idx_intake_events_status ON intake_events(company_id, status);

CREATE TABLE IF NOT EXISTS work_tasks (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL,
  created_by_member_id text NOT NULL,
  owner_member_id text NOT NULL,
  domain text,
  source_kind text NOT NULL,
  source_id text NOT NULL,
  source_channel_topic_id text,
  requester_id text,
  acceptance_criteria text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  canceled_reason text,
  metadata_json jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_work_tasks_owner_status ON work_tasks(company_id, owner_member_id, status);

CREATE TABLE IF NOT EXISTS work_task_revisions (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  work_task_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  title text NOT NULL,
  description text,
  acceptance_criteria text NOT NULL,
  changed_by_member_id text NOT NULL,
  reason text NOT NULL,
  source_work_run_id text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, work_task_id, revision),
  FOREIGN KEY (company_id, work_task_id) REFERENCES work_tasks(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_work_task_revisions_task_revision
ON work_task_revisions(company_id, work_task_id, revision DESC);

CREATE TABLE IF NOT EXISTS work_schedules (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  work_task_id text NOT NULL,
  status text NOT NULL,
  kind text NOT NULL,
  timezone text,
  schedule_rule_json jsonb,
  next_run_at timestamptz,
  last_run_at timestamptz,
  run_count integer NOT NULL DEFAULT 0,
  max_runs integer,
  paused_reason text,
  canceled_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, work_task_id) REFERENCES work_tasks(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_work_schedules_task ON work_schedules(company_id, work_task_id);
CREATE INDEX IF NOT EXISTS idx_work_schedules_status_next_run ON work_schedules(company_id, status, next_run_at);

CREATE TABLE IF NOT EXISTS work_runs (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  work_task_id text NOT NULL,
  status text NOT NULL,
  assignee_member_id text NOT NULL,
  task_revision integer NOT NULL DEFAULT 1 CHECK (task_revision > 0),
  triggered_by text NOT NULL CONSTRAINT work_runs_triggered_by_check
    CHECK (triggered_by IN ('immediate', 'schedule', 'recurrence', 'migration', 'retry')),
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  blocked_reason text,
  failed_reason text,
  canceled_reason text,
  result_summary text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, work_task_id) REFERENCES work_tasks(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_work_runs_task_status ON work_runs(company_id, work_task_id, status);
CREATE INDEX IF NOT EXISTS idx_work_runs_assignee_status ON work_runs(company_id, assignee_member_id, status);

CREATE TABLE IF NOT EXISTS work_run_events (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  work_run_id text NOT NULL,
  timestamp timestamptz NOT NULL,
  actor_member_id text NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  metadata_json jsonb,
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, work_run_id) REFERENCES work_runs(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_work_run_events_run_timestamp ON work_run_events(company_id, work_run_id, timestamp);

CREATE TABLE IF NOT EXISTS work_dispatch_leases (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  work_run_id text NOT NULL,
  assignee_member_id text NOT NULL,
  session_key text NOT NULL,
  status text NOT NULL,
  dispatched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  failed_at timestamptz,
  canceled_at timestamptz,
  failure_reason text,
  retry_of_lease_id text,
  created_by text NOT NULL,
  metadata_json jsonb,
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, work_run_id) REFERENCES work_runs(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_work_dispatch_leases_run_status ON work_dispatch_leases(company_id, work_run_id, status);
CREATE INDEX IF NOT EXISTS idx_work_dispatch_leases_status_expires ON work_dispatch_leases(company_id, status, expires_at);

CREATE TABLE IF NOT EXISTS work_blocked_recovery_requests (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  work_run_id text NOT NULL,
  work_task_id text NOT NULL,
  assignee_member_id text NOT NULL,
  requester_member_id text NOT NULL,
  conversation_id text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  canceled_at timestamptz,
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, work_run_id),
  FOREIGN KEY (company_id, work_run_id) REFERENCES work_runs(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, work_task_id) REFERENCES work_tasks(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, conversation_id) REFERENCES conversations(company_id, conversation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_work_blocked_recovery_requests_conversation_open
ON work_blocked_recovery_requests(company_id, conversation_id, status);
CREATE INDEX IF NOT EXISTS idx_work_blocked_recovery_requests_assignee_status
ON work_blocked_recovery_requests(company_id, assignee_member_id, status);

CREATE TABLE IF NOT EXISTS channel_topics (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  owner_member_id text NOT NULL,
  participant_member_ids_json jsonb NOT NULL,
  progress_summary text NOT NULL,
  waiting_on_participant_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  room_id text,
  conversation_id text,
  chat_entry_id text,
  identity_source text NOT NULL DEFAULT 'tinyoffice_room',
  seen_cursors_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_channel_topics_owner_member ON channel_topics(company_id, owner_member_id);
CREATE INDEX IF NOT EXISTS idx_channel_topics_status ON channel_topics(company_id, status);
CREATE INDEX IF NOT EXISTS idx_channel_topics_owned_room ON channel_topics(company_id, room_id);

CREATE TABLE IF NOT EXISTS channel_topic_handoffs (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  topic_id text NOT NULL,
  room_id text,
  conversation_id text,
  chat_entry_id text,
  action_id text,
  from_id text NOT NULL,
  to_id text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_channel_topic_handoffs_topic_created ON channel_topic_handoffs(company_id, topic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_topic_handoffs_owned_room ON channel_topic_handoffs(company_id, room_id, created_at);

CREATE TABLE IF NOT EXISTS session_records (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  employee_id text NOT NULL,
  session_key text NOT NULL,
  session_id text NOT NULL,
  scene_type text NOT NULL,
  channel_topic_id text,
  task_id text,
  requester_id text,
  model_provider text,
  model_id text,
  metadata_json jsonb,
  status text NOT NULL,
  title text,
  summary text,
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  user_message_count integer NOT NULL DEFAULT 0,
  assistant_message_count integer NOT NULL DEFAULT 0,
  tool_call_count integer NOT NULL DEFAULT 0,
  tool_result_count integer NOT NULL DEFAULT 0,
  token_input_total bigint NOT NULL DEFAULT 0,
  token_output_total bigint NOT NULL DEFAULT 0,
  token_cache_total bigint NOT NULL DEFAULT 0,
  byte_size bigint NOT NULL DEFAULT 0,
  truncated boolean NOT NULL DEFAULT false,
  work_run_id text,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_session_records_session_key ON session_records(company_id, session_key);
CREATE INDEX IF NOT EXISTS idx_session_records_employee_updated ON session_records(company_id, employee_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_session_records_work_run ON session_records(company_id, work_run_id);

CREATE TABLE IF NOT EXISTS session_events (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  session_record_id text NOT NULL,
  sequence integer NOT NULL,
  timestamp timestamptz NOT NULL,
  kind text NOT NULL,
  role text,
  scene_id text,
  turn_id text,
  run_id text,
  model_call_id text,
  source text,
  visibility text,
  semantic_role text,
  raw_event_kind text,
  title text,
  summary text,
  preview text,
  payload_json jsonb,
  byte_size bigint NOT NULL DEFAULT 0,
  truncated boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, session_record_id, sequence),
  FOREIGN KEY (company_id, session_record_id) REFERENCES session_records(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_events_session_sequence ON session_events(company_id, session_record_id, sequence);
CREATE INDEX IF NOT EXISTS idx_session_events_timestamp ON session_events(company_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_session_events_kind ON session_events(company_id, kind);
CREATE INDEX IF NOT EXISTS idx_session_events_model_call ON session_events(company_id, model_call_id);

CREATE TABLE IF NOT EXISTS process_trace_events (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  timestamp timestamptz NOT NULL,
  session_key text NOT NULL,
  channel_topic_id text,
  task_id text,
  employee_id text,
  kind text NOT NULL,
  title text NOT NULL,
  summary text,
  status text,
  preview text,
  payload_json jsonb,
  work_task_id text,
  work_run_id text,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_process_trace_session_timestamp ON process_trace_events(company_id, session_key, timestamp);
CREATE INDEX IF NOT EXISTS idx_process_trace_work_task_timestamp ON process_trace_events(company_id, work_task_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_process_trace_work_run_timestamp ON process_trace_events(company_id, work_run_id, timestamp);

CREATE TABLE IF NOT EXISTS collaboration_action_events (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  timestamp timestamptz NOT NULL,
  employee_id text NOT NULL,
  action_name text NOT NULL,
  channel_topic_id text,
  task_id text,
  status text,
  recipient_id text,
  message text,
  progress_summary text,
  decision text,
  emitted boolean NOT NULL DEFAULT false,
  suppressed_reason text,
  payload_json jsonb,
  work_run_id text,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_collaboration_action_employee_timestamp ON collaboration_action_events(company_id, employee_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_collaboration_action_work_run_timestamp ON collaboration_action_events(company_id, work_run_id, timestamp);

CREATE TABLE IF NOT EXISTS memory_summaries (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  scope_kind text NOT NULL,
  scope_id text NOT NULL,
  employee_id text,
  source_kind text NOT NULL,
  source_id text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  importance real NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  expires_at timestamptz,
  embedding_status text NOT NULL DEFAULT 'not_requested',
  embedding_ref text,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_scope ON memory_summaries(company_id, scope_kind, scope_id);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_employee_updated ON memory_summaries(company_id, employee_id, updated_at);

CREATE TABLE IF NOT EXISTS runtime_storage_retention_state (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  policy_json jsonb NOT NULL,
  last_cleanup_at timestamptz,
  deleted_session_count integer NOT NULL DEFAULT 0,
  deleted_event_count integer NOT NULL DEFAULT 0,
  last_vacuum_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, id)
);

CREATE TABLE IF NOT EXISTS governance_approvals (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  context_kind text NOT NULL,
  context_id text NOT NULL,
  session_key text NOT NULL,
  requested_by_member_id text NOT NULL,
  requested_approver_member_id text,
  requested_action text NOT NULL,
  requested_resource text,
  requested_input_snapshot_json jsonb,
  status text NOT NULL,
  reason text NOT NULL,
  decision_note text,
  resolved_by_member_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_governance_approvals_context ON governance_approvals(company_id, context_kind, context_id);
CREATE INDEX IF NOT EXISTS idx_governance_approvals_status ON governance_approvals(company_id, status);

CREATE TABLE IF NOT EXISTS approval_grants (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  approval_id text NOT NULL,
  member_id text NOT NULL,
  action text NOT NULL,
  resource text,
  scope text NOT NULL,
  context_kind text NOT NULL,
  context_id text NOT NULL,
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, id),
  FOREIGN KEY (company_id, approval_id) REFERENCES governance_approvals(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_approval_grants_approval ON approval_grants(company_id, approval_id);
CREATE INDEX IF NOT EXISTS idx_approval_grants_member_action ON approval_grants(company_id, member_id, action);

CREATE TABLE IF NOT EXISTS office_tool_audit_logs (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  timestamp timestamptz NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  dry_run boolean NOT NULL DEFAULT false,
  target_json jsonb NOT NULL,
  result_json jsonb NOT NULL,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_office_tool_audit_logs_timestamp ON office_tool_audit_logs(company_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_office_tool_audit_logs_action ON office_tool_audit_logs(company_id, action);

CREATE TABLE IF NOT EXISTS operating_events (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  timestamp timestamptz NOT NULL,
  actor_member_id text NOT NULL,
  domain text,
  severity text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  source_intake_event_id text,
  source_kind text,
  source_id text,
  metadata_json jsonb,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_operating_events_timestamp ON operating_events(company_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_operating_events_actor_member ON operating_events(company_id, actor_member_id);
CREATE INDEX IF NOT EXISTS idx_operating_events_domain ON operating_events(company_id, domain, timestamp);

CREATE TABLE IF NOT EXISTS prompt_policy_blocks (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  block_id text NOT NULL,
  title text,
  content text NOT NULL,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, block_id)
);

CREATE TABLE IF NOT EXISTS prompt_policy_templates (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  template_id text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, template_id)
);

CREATE TABLE IF NOT EXISTS prompt_policy_bindings (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  mount_kind text NOT NULL,
  scene_type text,
  block_id text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (company_id, block_id) REFERENCES prompt_policy_blocks(company_id, block_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_policy_bindings_unique
ON prompt_policy_bindings(company_id, mount_kind, COALESCE(scene_type, ''), block_id);
CREATE INDEX IF NOT EXISTS idx_prompt_policy_bindings_scene_position
ON prompt_policy_bindings(company_id, mount_kind, scene_type, position);

CREATE TABLE IF NOT EXISTS tool_safety_policies (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  policy_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, id)
);

CREATE TABLE IF NOT EXISTS handoff_replay_ledger (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  key text NOT NULL,
  resolution text NOT NULL,
  resolved_at timestamptz NOT NULL,
  sender_member_id text NOT NULL,
  thread_id text,
  channel_topic_id text,
  room_id text,
  conversation_id text,
  chat_entry_id text,
  action_id text,
  call_timestamp timestamptz NOT NULL,
  recipient_participant_id text NOT NULL,
  PRIMARY KEY (company_id, key)
);
CREATE INDEX IF NOT EXISTS idx_handoff_replay_ledger_resolved_at
ON handoff_replay_ledger(company_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_handoff_replay_ledger_owned_room
ON handoff_replay_ledger(company_id, room_id);
`;
}

export function buildCompanyConfigSeedSql(): string {
  return "-- TinyOffice pre-release baseline does not seed product data during schema initialization.";
}

export function buildOwnerAuthenticationSchemaSql(): string {
  return `
CREATE TABLE IF NOT EXISTS auth_users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  "expiresAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions("userId");
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions("expiresAt");

CREATE TABLE IF NOT EXISTS auth_accounts (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "accessToken" text,
  "refreshToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  "idToken" text,
  password text,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX IF NOT EXISTS idx_auth_accounts_user ON auth_accounts("userId");

CREATE TABLE IF NOT EXISTS auth_verifications (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_verifications_identifier ON auth_verifications(identifier);

CREATE TABLE IF NOT EXISTS auth_passkeys (
  id text PRIMARY KEY,
  name text,
  "publicKey" text NOT NULL,
  "userId" text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  "credentialID" text NOT NULL UNIQUE,
  counter integer NOT NULL,
  "deviceType" text NOT NULL,
  "backedUp" boolean NOT NULL,
  transports text,
  "createdAt" timestamptz,
  aaguid text
);
CREATE INDEX IF NOT EXISTS idx_auth_passkeys_user ON auth_passkeys("userId");
`;
}

function buildSystemAiProviderConfigAuditSql(): string {
  return `
CREATE TABLE IF NOT EXISTS system_ai_provider_configs (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  capability text NOT NULL,
  provider_kind text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  config_ref text,
  model_ref text,
  config_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, capability)
);
CREATE INDEX IF NOT EXISTS idx_system_ai_provider_configs_enabled
ON system_ai_provider_configs(company_id, capability, enabled);

CREATE TABLE IF NOT EXISTS system_ai_audit_events (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  event_id text NOT NULL,
  capability text NOT NULL,
  request_id text NOT NULL,
  source_json jsonb NOT NULL,
  provider_json jsonb,
  status text NOT NULL,
  error_reason text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_system_ai_audit_events_request
ON system_ai_audit_events(company_id, request_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_system_ai_audit_events_capability_status
ON system_ai_audit_events(company_id, capability, status, occurred_at);
`;
}

export const postgresSchemaMigrations: PostgresSchemaMigration[] = [
  {
    id: "pg_001_pre_release_baseline_20260704_chat_member_identity",
    sql: buildInitialPostgresSchemaSql(),
  },
  {
    id: "pg_002_remove_channel_member_role_20260705",
    sql: `
ALTER TABLE chat_channel_members
  DROP COLUMN IF EXISTS role;
`,
  },
  {
    id: "pg_003_create_work_blocked_recovery_requests_20260709",
    sql: `
CREATE TABLE IF NOT EXISTS work_blocked_recovery_requests (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  work_run_id text NOT NULL,
  work_task_id text NOT NULL,
  assignee_member_id text NOT NULL,
  requester_member_id text NOT NULL,
  conversation_id text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  canceled_at timestamptz,
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, work_run_id),
  FOREIGN KEY (company_id, work_run_id) REFERENCES work_runs(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, work_task_id) REFERENCES work_tasks(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, conversation_id) REFERENCES conversations(company_id, conversation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_work_blocked_recovery_requests_conversation_open
ON work_blocked_recovery_requests(company_id, conversation_id, status);
CREATE INDEX IF NOT EXISTS idx_work_blocked_recovery_requests_assignee_status
ON work_blocked_recovery_requests(company_id, assignee_member_id, status);
`,
  },
  {
    id: "pg_004_hard_cut_work_task_lifecycle_20260710",
    sql: `
UPDATE work_tasks
SET status = 'active',
    updated_at = NOW()
WHERE status = 'paused';

UPDATE work_tasks
SET metadata_json = metadata_json - 'archivedFromStatus'
WHERE status = 'archived'
  AND metadata_json ->> 'archivedFromStatus' = 'paused';

ALTER TABLE work_tasks
  DROP COLUMN IF EXISTS paused_reason;
`,
  },
  {
    id: "pg_005_close_work_run_lifecycle_gaps_20260710",
    sql: `
UPDATE work_runs
SET triggered_by = 'immediate'
WHERE triggered_by = 'manual';

ALTER TABLE work_runs
  DROP COLUMN IF EXISTS handoff_from_member_id,
  DROP COLUMN IF EXISTS handoff_reason;

ALTER TABLE work_runs
  DROP CONSTRAINT IF EXISTS work_runs_triggered_by_check;

ALTER TABLE work_runs
  ADD CONSTRAINT work_runs_triggered_by_check
  CHECK (triggered_by IN ('immediate', 'schedule', 'recurrence', 'migration', 'retry'));
`,
  },
  {
    id: "pg_006_task_revisions_and_schedule_invariants_20260710",
    sql: `
ALTER TABLE work_tasks
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;

ALTER TABLE work_runs
  ADD COLUMN IF NOT EXISTS task_revision integer NOT NULL DEFAULT 1;

ALTER TABLE work_tasks
  DROP CONSTRAINT IF EXISTS work_tasks_revision_check;

ALTER TABLE work_tasks
  ADD CONSTRAINT work_tasks_revision_check CHECK (revision > 0);

ALTER TABLE work_runs
  DROP CONSTRAINT IF EXISTS work_runs_task_revision_check;

ALTER TABLE work_runs
  ADD CONSTRAINT work_runs_task_revision_check CHECK (task_revision > 0);

CREATE TABLE IF NOT EXISTS work_task_revisions (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  id text NOT NULL,
  work_task_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  title text NOT NULL,
  description text,
  acceptance_criteria text NOT NULL,
  changed_by_member_id text NOT NULL,
  reason text NOT NULL,
  source_work_run_id text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, work_task_id, revision),
  FOREIGN KEY (company_id, work_task_id) REFERENCES work_tasks(company_id, id) ON DELETE CASCADE
);

INSERT INTO work_task_revisions (
  company_id, id, work_task_id, revision, title, description,
  acceptance_criteria, changed_by_member_id, reason, created_at
)
SELECT
  company_id,
  'work-task-revision-migration-' || id,
  id,
  1,
  title,
  description,
  acceptance_criteria,
  created_by_member_id,
  'Initial Task objective migrated into revision history.',
  created_at
FROM work_tasks
ON CONFLICT (company_id, work_task_id, revision) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_work_task_revisions_task_revision
ON work_task_revisions(company_id, work_task_id, revision DESC);

ALTER TABLE work_schedules
  DROP CONSTRAINT IF EXISTS work_schedules_enabled_next_run_check;

ALTER TABLE work_schedules
  ADD CONSTRAINT work_schedules_enabled_next_run_check
  CHECK (status <> 'enabled' OR next_run_at IS NOT NULL);
`,
  },
  {
    id: "pg_007_member_runtime_lifecycle_20260711",
    sql: `
ALTER TABLE member_runtime_profiles
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

ALTER TABLE member_runtime_profiles
  DROP CONSTRAINT IF EXISTS member_runtime_profiles_lifecycle_status_check;

ALTER TABLE member_runtime_profiles
  ADD CONSTRAINT member_runtime_profiles_lifecycle_status_check
  CHECK (lifecycle_status IN ('active', 'inactive'));
`,
  },
  {
    id: "pg_008_user_profiles_20260711",
    sql: `
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id text PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
`,
  },
  {
    id: "pg_009_user_current_company_20260712",
    sql: `
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS current_company_id text REFERENCES companies(company_id) ON DELETE SET NULL;
`,
  },
  {
    id: "pg_010_persisted_member_avatars_20260712",
    sql: `
ALTER TABLE company_members
  ADD COLUMN IF NOT EXISTS avatar_seed text;

UPDATE company_members
SET avatar_seed = id
WHERE avatar_seed IS NULL OR btrim(avatar_seed) = '';

ALTER TABLE company_members
  ALTER COLUMN avatar_seed SET NOT NULL;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS avatar_seed text;

UPDATE user_profiles
SET avatar_seed = user_id
WHERE avatar_seed IS NULL OR btrim(avatar_seed) = '';

ALTER TABLE user_profiles
  ALTER COLUMN avatar_seed SET NOT NULL;
`,
  },
  {
    id: "pg_011_chat_attachment_references_20260713",
    sql: `
CREATE TABLE IF NOT EXISTS chat_attachment_references (
  company_id text NOT NULL,
  attachment_id text NOT NULL,
  message_id text NOT NULL,
  conversation_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, attachment_id, message_id),
  FOREIGN KEY (company_id, attachment_id) REFERENCES chat_attachments(company_id, attachment_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, message_id) REFERENCES conversation_messages(company_id, message_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, conversation_id) REFERENCES conversations(company_id, conversation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_attachment_references_message
ON chat_attachment_references(company_id, message_id);

INSERT INTO chat_attachment_references (
  company_id, attachment_id, message_id, conversation_id, created_at
)
SELECT
  message.company_id,
  attachment_snapshot ->> 'attachmentId',
  message.message_id,
  message.conversation_id,
  message.created_at
FROM conversation_messages message
CROSS JOIN LATERAL jsonb_array_elements(message.attachments_json) attachment_snapshot
JOIN chat_attachments attachment
  ON attachment.company_id = message.company_id
 AND attachment.attachment_id = attachment_snapshot ->> 'attachmentId'
WHERE attachment_snapshot ->> 'attachmentId' IS NOT NULL
ON CONFLICT (company_id, attachment_id, message_id) DO NOTHING;
`,
  },
  {
    id: "pg_012_single_owner_authentication_20260714",
    sql: buildOwnerAuthenticationSchemaSql(),
  },
  {
    id: "pg_013_chat_topic_single_ball_chain_20260714",
    sql: `
CREATE TABLE IF NOT EXISTS chat_topic_chains (
  company_id text NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  chain_id text NOT NULL,
  room_id text NOT NULL,
  source_message_id text NOT NULL,
  started_by_member_id text NOT NULL,
  current_run_id text NOT NULL,
  current_holder_member_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'cancel_requested', 'completed', 'canceled', 'failed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  cancel_requested_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, chain_id),
  FOREIGN KEY (company_id, room_id) REFERENCES conversations(company_id, conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, source_message_id) REFERENCES conversation_messages(company_id, message_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_topic_chains_one_active_room
ON chat_topic_chains(company_id, room_id)
WHERE status IN ('active', 'cancel_requested');

CREATE TABLE IF NOT EXISTS chat_topic_chain_runs (
  company_id text NOT NULL,
  chain_id text NOT NULL,
  run_id text NOT NULL,
  holder_member_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, run_id),
  FOREIGN KEY (company_id, chain_id) REFERENCES chat_topic_chains(company_id, chain_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_topic_chain_runs_chain
ON chat_topic_chain_runs(company_id, chain_id, created_at);
`,
  },
];
