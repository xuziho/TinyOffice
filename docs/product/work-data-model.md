# WorkTask / WorkSchedule / WorkRun Data Model

This page records the target background-work data model: `WorkTask` describes the work, `WorkSchedule` describes when it should create runs, and `WorkRun` records one execution of that task.

Current implementation note: PostgreSQL, repository storage, WorkService, dispatch, execution, intake creation, Process Trace, Tasks, Employee Status, and evidence query use `WorkTask`, `WorkSchedule`, and `WorkRun` product semantics. `workTaskId` is the single current WorkRun parent id.

## Core Objects

| Object | Answers | Current code |
| --- | --- | --- |
| `work_tasks` | Why this work exists, who owns it, and how success is judged. | `src/work/work-repository.ts` |
| `work_task_revisions` | Immutable snapshots of confirmed Task objective changes, including actor, reason, and optional source WorkRun. | `src/work/work-repository.ts` |
| `work_schedules` | When and how often a WorkTask should create WorkRuns. | `src/work/work-repository.ts` |
| `work_runs` | Who executed this run, where execution is now, why it is blocked or failed, and what result was produced. | `src/work/work-repository.ts` |
| `work_run_events` | WorkRun status changes, progress, Access links, cancellation, and result evidence. | `src/work/work-repository.ts` |
| `work_dispatch_leases` | Dispatch lease, execution session key, and ack/fail/cancel state. | `src/work/work-dispatch-lease.ts` |

## `work_tasks`

WorkTask stores durable work facts:

| Field | Meaning |
| --- | --- |
| `id` | WorkTask primary key. |
| `title` / `description` | User-readable title and description. |
| `status` | `active`, `completed`, `canceled`, or `archived`. `blocked` and `failed` belong to WorkRun, not WorkTask. |
| `created_by_member_id` | Member that created the task. |
| `owner_member_id` | Default responsible runtime-capable member; a WorkRun can override it. |
| `source_kind` / `source_id` | Source object. New product flows use `chat_request` or `intake_event`; `manual` is historical read compatibility only. |
| `acceptance_criteria` | Observable completion standard and verification expectation. |
| `revision` | Current confirmed objective revision, starting at `1`. |

`archived` is a WorkTask visibility state, not a WorkRun execution result. Archiving preserves schedules, runs, runtime Sessions, Process Trace, and Chat source evidence. A WorkTask must be completed or canceled before it is archived so hidden Work cannot keep dispatching unexpectedly.

## `work_schedules`

WorkSchedule stores trigger facts for a WorkTask:

| Field | Meaning |
| --- | --- |
| `id` | WorkSchedule primary key. |
| `work_task_id` | Parent WorkTask. |
| `trigger_kind` | `immediate`, `scheduled_once`, or `recurring`. |
| `schedule_rule_json` | Structured schedule rule. |
| `next_run_at` / `last_run_at` | Next and latest trigger times. |
| `run_count` / `max_runs` | Number of WorkRuns triggered and optional run limit. |
| `enabled` / `paused_reason` / `canceled_reason` | Trigger lifecycle state. |

## `work_runs`

WorkRun is one background execution instance:

| Field | Meaning |
| --- | --- |
| `id` | WorkRun primary key. |
| `work_task_id` | Parent WorkTask. |
| `status` | `queued`, `in_progress`, `blocked`, `done`, `failed`, or `canceled`. |
| `assignee_member_id` | Runtime-capable member assigned to this run. |
| `task_revision` | Confirmed Task objective revision this Run currently executes. |
| `triggered_by` | `immediate`, `schedule`, `recurrence`, `migration`, or `retry`. `immediate` is the system-created execution for an immediate Task; it is not a manual product trigger. |
| `started_at` / `completed_at` | Execution lifecycle timestamps. |
| `blocked_reason` / `failed_reason` / `canceled_reason` | Result reason. |
| `verification_status` / `verification_summary` | Evidence summary when the run finishes. |
| `result_summary` / `result_payload_json` | User-readable result and structured artifact. |

## Execution Protocol

Background execution advances through the `finish_work_turn` final-result tool. At the end of each `work_run_execution` session turn, the employee calls the tool; Runtime validates the result and writes WorkRun state.

| Layer | Responsibility |
| --- | --- |
| Employee runtime | Execute the task and report `complete`, `blocked`, `failed`, `canceled`, or `in_progress`. A need to change assignee is reported as a blocker until reassignment exists. |
| WorkTask | Store title, optional description, owner, source anchor, and `acceptanceCriteria`. |
| WorkSchedule | Store trigger rules and create queued WorkRuns when due. |
| WorkRun | Store this execution's status, events, evidence, and result. |
| Runtime | Dispatch WorkRun, keep the same WorkRun attached to the same execution session, validate the final protocol, write state, and prevent unlimited continuation with budgets. |

Runtime does not decide business success by itself. The employee must return `complete` only after satisfying `acceptanceCriteria` and recording concrete evidence in the run event. If evidence, permission, input, material, or a human decision is missing, the result should be `blocked`.

## Continuation Rules

- If the WorkRun is terminal after a turn, Runtime stops.
- If the WorkRun remains `in_progress`, Runtime may continue the same `work_run_execution` session within budget.
- If continuation budget is exhausted, Runtime blocks the WorkRun with a budget-exhausted reason.
- `max_runs` limits how many times a WorkSchedule may trigger WorkRuns; it is not the continuation count for one WorkRun.

## Runtime Records

| Runtime record | Work relation |
| --- | --- |
| `session_records` / `session_events` | WorkRun execution sessions use `work_run_id` as execution context. |
| `process_trace_events` | Process details can be reviewed by WorkTask / WorkRun ids through `work_task_id` and `work_run_id`. |
| `collaboration_action_events` | Collaboration results and WorkTask source evidence. WorkRun state is written by `finish_work_turn`. |
| `approval_grants` | Temporary Access grants can bind to WorkRun context. |
| `operating_log_events` | Important events without a specific WorkRun, or cross-WorkRun operational events. |

## Boundaries

- WorkTask / WorkSchedule / WorkRun is not a general project-management suite.
- WorkTask does not store every model message or tool result; those belong to session storage and process trace.
- WorkSchedule owns long-term recurrence rules; WorkTask and WorkRun do not.
- WorkRun does not own long-term recurrence rules.
- Access remains a separate resource/command permission system and is linked by context when needed.
- Product language and Work storage use member identity for creators, owners, assignees, and event actors. Runtime-capable remains a capability attached to a member.

## Verification

```powershell
node --import tsx --test tests\work\work-service.test.ts tests\work\work-execution-service.test.ts tests\collaboration\collaboration-actions-extension.test.ts tests\runtime\postgres-schema.test.ts
```
