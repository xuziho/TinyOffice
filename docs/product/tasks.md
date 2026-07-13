# Tasks

Tasks is TinyOffice's operations surface for background work. It lets operators inspect and control WorkTask / WorkSchedule / WorkRun execution without turning Chat into a project-management dashboard.

## Purpose

- See current background work status.
- Handle blocked, failed, retry, dispatch-retry, and cancel states.
- Inspect source, owner, assignee, result, evidence, usage, and timeline.

## Entry Points

| Entry | Purpose |
| --- | --- |
| shadcn app Tasks module | `/tasks` in `apps/tinyoffice-web-shadcn`; consumes the Tasks view-model API as the foreground operations console. |
| `/api/companies/:companyId/tasks/view-model` | JSON view model consumed by the React Tasks product. |
| `/api/companies/:companyId/work/:workTaskId/cancel`, `/archive`, `/restore` | Operator lifecycle actions for WorkTask cancellation and visibility governance. |
| Chat AI capabilities | Confirmed conversation creates and manages Tasks through `work.*` and `schedule.*`; Tasks has no manual creation form. |

## Core Concepts

The backend storage model remains WorkTask / WorkSchedule / WorkRun, but the foreground UI uses the simpler operator-facing word `Task`. Operators manage Tasks. Schedule and execution records are child data of a Task, not peer product objects. The Tasks workspace separates the queue into `Current`, `Scheduled`, and `History`: Current contains active work, Scheduled contains active Tasks with an enabled future schedule, and History contains completed, canceled, or archived Tasks. These are operator views over Task aggregates, not new persisted lifecycle states. The list uses the high-signal columns `Task`, `State`, `Owner`, `Next action`, and `Updated`.

`Source` means where the Task was created from. New Tasks come from confirmed Chat requests or Intake events. Historical `manual` source rows may remain readable, but no active API or frontend path creates them. Missing or unknown source kinds must fail at the API boundary instead of silently falling back to a fake source. Schedule and run evidence remain available in Task detail instead of occupying daily scanning columns. The page uses a full-width Task list first; selecting a Task opens a full-width Task detail view with a return action back to the list. When the Task was opened from another TinyOffice surface, that source return action replaces the local list return; direct Task URLs remain canonical and do not invent source returns. A selected Task with a Chat source anchor may also offer `Open source discussion`, which opens the originating Chat room from its `sourceLink.conversationId`. This is separate from the top return action: return answers "where did I come from this time?", while source answers "where did this Task originate?" Tasks should not expose WorkSchedule or WorkRun as peer top-level navigation, and it should not show raw phrases such as `trigger rules`, `Work`, or naked `active` task state when a clearer product status can be derived.

The Work domain validates that every new immediate run, due scheduled run, and retry assignee is an active runtime-capable member in the same Company. Caller guidance or directory selection is not sufficient enforcement. When a source Channel is dissolved, the Task and its execution evidence remain readable, but the source is marked unavailable and the UI must not offer navigation to the deleted Chat room.

Task ownership is historical member identity, not active employee discovery. The Tasks backend projects the owner's current display name and avatar from `company_members`; the frontend renders that projection without querying the active-only directory. Deactivating an owner therefore blocks new execution and assignment at the Work boundary without degrading existing Task rows to raw member ids or synthetic avatars.

When the company has never created a Task, the first-empty state explains the two supported paths: confirm work with an AI employee in Chat, or connect an external source through Integrations. It links to those surfaces and does not present a manual Task form. A filter that happens to match no Tasks uses a separate filtered-empty state so it does not repeat onboarding guidance.

| Concept | Meaning |
| --- | --- |
| [WorkTask](work-data-model.md) | A formal unit of background work with goal, owner, success criteria, and verification criteria. |
| [WorkSchedule](work-data-model.md) | A trigger rule that creates WorkRuns for a WorkTask. |
| [WorkRun](work-data-model.md) | One concrete execution of a WorkTask. |
| Dispatch lease | Evidence that a queued run was handed to a runtime-capable member. |
| Process Trace | Execution evidence for what happened during a run. |

## Capabilities

| Capability | Meaning |
| --- | --- |
| Task operations workspace | Scan Tasks by state, owner, next action, and update time without turning child schedules or executions into peer objects. |
| Current / Scheduled / History views | Keep active work, future scheduled work, and inactive history separate. A scheduled Task may also appear in Current because the views answer different operator questions. |
| Needs attention group | Pin active Tasks whose latest execution is blocked or failed, or requires participant input, at the top of Current. This is a visual priority group, not a filter, module, or lifecycle state. Remaining active Tasks appear under `Up next`. |
| Detail inspector | Inspect objective, source, responsible member, result, evidence, usage, and timeline. |
| Run controls | Retry failed dispatch, retry a failed WorkRun, or cancel a queued/running/blocked WorkRun when allowed by backend actions. Cancellation also aborts the exact runtime Session, closes recovery, cancels dispatch ownership, and suppresses late results. |
| Conversational Task creation | The operator describes work in Chat, confirms the proposed title/owner/acceptance criteria/timing, and AI creates immediate, one-shot, or recurring Work. |
| Task lifecycle | Cancel active Tasks, archive completed or canceled Tasks from the default list, and restore archived Tasks into their prior inactive state. |
| Schedule controls | AI can pause, resume, or permanently cancel a schedule after operator confirmation. Permanent schedule cancellation closes the parent Task and active runs. |
| Evidence links | Inspect related WorkRun, Session, and Process Trace evidence through TinyOffice-owned references. |
| Module alert | The Tasks rail indicator appears for failed or dispatch-failed executions that require Task controls. Blocked recovery questions stay owned by their Chat conversation and are not duplicated as a Tasks rail alert. |

## Boundary

- Tasks is not a general project-management system.
- Tasks is not a Chat replacement.
- Future WorkSchedules should remain visible before they run, but must not appear as in-progress WorkRuns.
- Routine background progress should stay in WorkRun events and Process Trace; Chat should receive only user-relevant outcomes or blockers.
- Control actions must come from backend action contracts, not hard-coded frontend routes.
- Tasks is an observation and control surface; it must not expose manual creation or create a parallel frontend-only task store.
- WorkTask archive is a visibility action, not evidence deletion. It must not archive or delete WorkRuns, Sessions, Process Trace, or Chat source material. Active Work must be completed or canceled before archive; schedules may still be paused independently.

## Technical Implementation

See [Tasks Technical Implementation](../technical/tasks.md).

Current frontend code:

- `apps/tinyoffice-web-shadcn/src/tasks/TasksPage.tsx`
- `apps/tinyoffice-web-shadcn/src/api/tasksClient.ts`
- `src/api/contracts/tinyoffice-frontend-api-contracts.ts`

Related product pages:

- [Work System](work-system.md)
- [Tasks Visibility](tasks-and-visibility.md)
- [Operations Surface](console.md)
