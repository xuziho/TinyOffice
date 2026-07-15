# Work System

This page defines TinyOffice's background-work product model. Live collaboration still happens in DM or Channel turns; only work that needs background execution, future trigger, repeated execution, recovery, retry, or explicit success criteria enters the Work system.

## Product Objects

| Layer | When it appears | Stores | Does not store |
| --- | --- | --- | --- |
| Conversation Turn | User collaborates with an employee in DM or Channel thread. | Current thread/session context, final-result output, Access cards, trace. | No default background work and no required success criteria. |
| WorkTask | Member or runtime intentionally creates background work. | Goal, source, owner member, acceptance criteria, and active/completed/canceled lifecycle. | Long-term schedule rules or per-run execution detail. |
| WorkSchedule | A timing rule for a WorkTask. | Trigger kind, one-shot/recurring rule, timezone, next run, enabled/paused state, and run limits. | Task body, execution result, trace, or session content. |
| WorkRun | One execution instance of a WorkTask. | Assigned member, status, events, process trace, blockers, result, session, and evidence links. | Long-term schedule rules or source conversation content. |

Implementation note: PostgreSQL, repository storage, WorkService, dispatch, execution, intake creation, evidence query, and Tasks use `WorkTask`, `WorkSchedule`, and `WorkRun` semantics with member identity fields such as `createdByMemberId`, `ownerMemberId`, `assigneeMemberId`, and `actorMemberId`. Chat employee context may surface compact current-work and attention signals, but Tasks remains the visible product contract for source, schedule, execution history, and WorkRun operations.

Tasks Run mutations derive their human actor from the authenticated current Company Member session. Browser request bodies do not select or override `actorMemberId`, and the Work action layer requires an explicit resolved actor rather than inventing a synthetic operator identity.

## When To Create Work

Create background Work only when:

- the user explicitly asks to schedule, run later, run repeatedly, or track a deliverable
- the task cannot naturally finish in the current turn
- there is a clear deliverable and acceptance criteria
- the process may need pause, resume, participant recovery, or retry

If the employee can answer, analyze, execute, and deliver in the current turn, finish in the current scene instead of creating Work.

DM and Channel Work creation follows the same confirmed-action pattern as other AI-callable TinyOffice capabilities. The employee first presents a confirmation checklist with goal, owner member, acceptance criteria, trigger kind, schedule or recurrence details, and source summary. After the operator confirms, the employee calls `tinyoffice_capability_call` with the registered `work.create` capability. The runtime records the current actor and Chat source anchor where available.

Intake can still create Work through its formal `finish_intake_turn` result. Intake-created Work may skip operator confirmation only when explicit employee guidance says that kind of external signal should become Work.

WorkTask lifecycle separates execution state from operator visibility. A WorkTask is `active`, `completed`, or `canceled`; `archived` is a visibility state for an already completed or canceled Task. WorkTask has no failed state: a technical execution failure belongs to one WorkRun, while the Task remains active for retry or explicit cancellation. The operator can control Task/run state from Tasks, or ask an employee in Chat to retry, cancel, archive, restore, pause, resume, or cancel schedules. Chat mutations require explicit confirmation. Archiving preserves WorkRuns, runtime Sessions, Process Trace, Chat source messages, and other evidence.

## Schedule And Dispatch

The Company Control Plane is the resident owner of schedule ticks and WorkRun dispatch:

```text
WorkSchedule due
  -> create queued WorkRun for the referenced WorkTask
  -> atomically dispatch the WorkRun to its assignee
  -> start the assignee's work_run_execution session through the employee daemon
  -> employee reports through finish_work_turn
  -> Runtime writes WorkRun state, Session, Process Trace, and realtime updates
```

Dispatch must prevent the same WorkRun from being started twice. The product risk is duplicate execution of one WorkRun, not merely two different employees choosing the same task. `CompanyControlPlane` owns due schedule scans, queued WorkRun creation, dispatch lease recovery, and the dispatch call into the assignee employee daemon/session. The dispatch lease is the execution ownership mechanism for a queued WorkRun.

`Retry Dispatch` does not create a new WorkRun. It creates one retry lease linked to the failed lease and marks that pending lease as an explicit operator retry intent. The Company Control Plane prioritizes that exact queued WorkRun, acknowledges the retry lease, and starts the original WorkRun Session. If the assignee cannot be resolved, the retry lease fails immediately with the real reason instead of waiting for lease expiry.

## WorkRun Execution

Queued WorkRuns are dispatched to the assignee's `work_run_execution` session. Each turn ends with `finish_work_turn`:

- `complete`: acceptance criteria are met and evidence is provided
- `blocked`: the employee cannot continue this execution without more information, permission, material, or direction; this is recoverable and non-terminal
- `failed`: confirmed unable to complete
- `canceled`: execution canceled
- `in_progress`: progress was made, not terminal

Runtime updates WorkRun status and events. It does not create broad business Approval from WorkRun output. Access requests for sensitive resources come from the concrete tool/access layer.

When a WorkRun becomes `blocked`, its WorkTask remains active and Runtime opens or reuses the one recovery DM permanently linked to that WorkRun. The employee explains the blocker there. Ordinary replies supply information and wake the original `work_run_execution` Session without granting sensitive access or automatically clearing the blocker. The employee's `finish_work_turn` result decides whether the WorkRun stays blocked, continues, completes, fails, or is canceled. Repeated block/resume cycles reuse the same DM. Tasks remains the command center for viewing and canceling work; it is not the participant-reply recovery surface.

A recovery reply must leave the original WorkRun in a stable observable state. When the reply returns `in_progress`, Runtime continues that same Session within the recovery operation. If the continuation still cannot complete within its bounded turn budget, Runtime returns the WorkRun to `blocked` and keeps the same recovery DM open; it must not close recovery and leave a completed Session behind an orphaned `in_progress` Run.

Ordinary clarification does not rewrite the Task objective. If the operator changes the goal, brief, or acceptance criteria, the employee must restate the proposed objective and obtain explicit confirmation before calling `work.revise`. TinyOffice then updates the current Task, appends an immutable Task revision, and moves the active source WorkRun to that revision. Future WorkRuns snapshot the latest confirmed Task revision.

Every WorkRun turn has two outputs: a normal user-visible message and one internal `finish_work_turn` state action. The tool ends the turn, not necessarily the WorkRun. Only `done`, `failed`, and `canceled` are terminal WorkRun states. Retrying a terminal failed WorkRun creates a new queued WorkRun and preserves the failed attempt as evidence.

If a provider finishes one turn without calling `finish_work_turn`, Runtime issues one bounded protocol-repair turn in the same Session. The repair may summarize work already performed but must call `finish_work_turn` exactly once. A second omission fails the WorkRun explicitly.

WorkRun reassignment is not a current product capability. If the assignee believes another employee is needed, the employee returns `blocked` and explains that requirement in `blockerMessage`; TinyOffice does not expose a nominal `handoff` result that silently degrades to blocked.

External cancellation is a runtime boundary, not only a database status update. Canceling a Task or active WorkRun first makes `canceled` authoritative, then cancels pending or acknowledged dispatch ownership, closes blocked recovery, aborts the exact `work_run_execution` session, marks its Session record `canceled`, and suppresses provider events or final results observed after cancellation.

WorkSchedule status is governed only by its trigger/operator lifecycle. A once-only or exhausted bounded schedule becomes `completed` when its trigger budget is consumed, even if the WorkRun later fails or is canceled. WorkRun outcome never rewrites a fired schedule to `paused` or `canceled`; Task state and retry controls own the execution outcome.

An enabled one-time or recurring Schedule always has `nextRunAt`. `scheduled_once` requires an RFC3339 timestamp with an explicit `Z` or UTC offset; `recurring` additionally requires a positive interval. WorkService normalizes that absolute timestamp to UTC before persistence. `timezone` preserves display and recurrence semantics but never reinterprets an offset-less timestamp. WorkService rejects ambiguous schedule input before persistence, and PostgreSQL rejects enabled schedules without a next trigger time.

When a WorkRun becomes terminal, every pending Access request scoped to that WorkRun is canceled. Access also reconciles terminal WorkRun contexts when loading foreground cards, so a failed cleanup notification cannot leave a stale pending approval visible indefinitely.

## Topic And WorkRun Boundary

Topic is the live TinyOffice Channel/Chat collaboration context. WorkRun is the background execution object. A Topic can create or discuss Work, but Topic itself is not a WorkRun.

Channel handoff changes Topic `ownerId`. WorkRun blocker, recovery, and completion do not map to Topic status.

## Evidence Links

Work evidence navigation should use TinyOffice-owned ids where they exist:

- `workRunId` identifies the WorkRun.
- `sessionId` identifies the runtime session that executed the WorkRun.
- `processTraceId` identifies trace rows for the run.
- `conversationId`, `messageId`, and `chatEntryId` identify the Chat source message when the WorkTask was created from owned Chat.

Historical source anchors may exist for older rows, but Work identity and Tasks navigation should use TinyOffice-owned ids. Chat-to-Task association is derived from these source anchors rather than title matching, message-body parsing, or runtime evidence links: Chat Context can list related Tasks for the selected room, and Task detail can return to the source Chat room when the anchor includes a `conversationId`.

## Access Boundary

Access is separate from Work state:

- Access may ask for a one-time decision when a WorkRun touches a sensitive resource.
- Approved Access creates a scoped grant for the original employee/session.
- Ordinary Chat text never creates an Access grant; only the foreground Access card can allow or reject the request.
- Runtime does not use approval to execute the business task on behalf of the employee.
- The employee retries through the original tool path and reports through `finish_work_turn`.

## Current Implementation Mapping

| Object/capability | Current code entry |
| --- | --- |
| WorkTask / WorkSchedule / WorkRun data and service | `src/work/domain.ts`, `src/work/work-repository.ts`, `src/work/work-service.ts` |
| Create background work | `work.create` in `src/runtime/capabilities/capability-registry.ts`, `tinyoffice_capability_call`, `finish_intake_turn` `create_work`, and Work service. There is no direct frontend Work creation route. |
| WorkTask lifecycle | `work.cancel`, `work.archive`, `work.restore`; `/api/companies/:companyId/work/:workTaskId/cancel`, `/archive`, and `/restore`; Tasks foreground actions; Work service lifecycle methods |
| WorkSchedule lifecycle | `schedule.pause`, `schedule.resume`, and `schedule.cancel` in the capability registry and Work service schedule/task lifecycle methods |
| WorkRun final result, retry, and cancellation | `src/work/finish-work-turn-result.ts`, `src/work/work-service.ts`, `src/work/work-cancellation-service.ts`, `src/work/tasks-run-actions.ts` |
| Company schedule tick and dispatch owner | `src/work/company-control-plane.ts` |
| Dispatch and execution | `src/work/work-dispatcher.ts`, `src/work/work-dispatch-runner.ts`, `src/work/work-execution-service.ts` |
| Blocked recovery | `src/work/work-blocked-recovery-service.ts`, `src/work/work-blocked-recovery-conversation-service.ts`, `src/work/work-blocked-recovery-request.ts` |
| Tasks | `src/work/tasks-loader.ts`, `src/work/tasks-view-model.ts`, `apps/tinyoffice-web-shadcn/src/tasks/TasksPage.tsx`, `apps/tinyoffice-web-shadcn/src/api/tasksClient.ts` |
| Operating log | `src/operating-log/operating-log-service.ts`, `src/operating-log/operating-log-repository.ts` |

## Verification

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test --test-concurrency=1 tests\work\work-e2e-verification.test.ts
node --import tsx --test tests\work\work-service.test.ts tests\work\work-execution-service.test.ts tests\work\company-control-plane.test.ts tests\collaboration\collaboration-actions-extension.test.ts
node --import tsx --test apps\tinyoffice-web-shadcn\src\api\tasksClient.test.ts apps\tinyoffice-web-shadcn\src\tasks\TasksPage.test.tsx
npm run check:tinyoffice-web-shadcn
npm run docs:sync-obsidian
npm run docs:build
```

The end-to-end smoke covers one scheduled WorkTask chain through WorkSchedule due tick, queued WorkRun creation, Company Control Plane dispatch, assignee `work_run_execution`, `finish_work_turn`, Tasks status projection, Session evidence, Process Trace evidence, Operating Log evidence, and Evidence Query reads.
