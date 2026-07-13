# Tasks Visibility

This page defines how background work becomes visible without flooding Chat.

## Current Product Direction

Tasks is the durable operations view for background work truth. Chat is the collaboration surface for readable conversation and user-relevant outcomes.

| Surface | Shows |
| --- | --- |
| Tasks | Task list and Task detail, including source, schedule summary, execution count/history, status, action log, Process Trace, dispatch retry, run retry, and cancel controls where authorized. |
| Chat | Normal user/employee replies, important blockers, final outcomes, and links to relevant work evidence. |
| Sessions | Detailed runtime session and model-call evidence. |

## Tasks Contract

`TasksViewModel` is assembled by the backend and consumed by the React Tasks product through `/api/companies/:companyId/tasks/view-model`.

Stable contract areas:

- `contract`: `tasks`, version, and Task aggregate boundary.
- `routes`: page, JSON view model, source/evidence links.
- `summary`: running executions, blocked executions, dispatch failures, open tasks, scheduled tasks, participant input.
- `filters`: Task status filter, sort order, owner filter, selected Task id.
- `tasks`: Task list rows with nested schedule summary, execution count, and latest execution.
- `selected`: selected Task detail with schedule record and execution history nested inside.
- `actions`: backend-authorized control actions.

The frontend must read the JSON contract. It must not infer Tasks state from DOM classes, button text, or unrelated Chat UI.

## Visibility Rules

| Event | Chat visibility | Tasks visibility |
| --- | --- | --- |
| WorkTask created | Optional concise confirmation when user initiated it. | Visible as a Task. |
| WorkSchedule created | Usually no Chat message unless user explicitly scheduled it. | Visible as the Task's Schedule. |
| WorkRun starts | Usually no Chat message. | Visible in the Task's current state and execution history. |
| WorkRun blocks | Chat may show a user-relevant blocker or request. | Visible as blocked with reason/evidence. |
| Access requested | Show through the future Access foreground shape when defined. | Visible as related evidence. |
| WorkRun completes | Chat may show concise result if the source conversation needs it. | Visible as completed with evidence. |
| WorkRun fails | Chat may show failure summary when user action is needed. | Visible as failed with reason/timeline. |
| Routine recurring run succeeds | Usually no Chat message. | Visible in history/evidence. |

## Source Links

Every WorkTask should keep enough source evidence to explain why it exists:

- `sourceKind`
- `sourceId`
- `requesterId`
- related Chat/Session/Trace ids when available

Tasks detail should provide links back to TinyOffice-owned source surfaces when they exist. Old carrier source fields may remain only as historical evidence on old rows; they are not product navigation keys.

## Controls

| Control | Object | Meaning |
| --- | --- | --- |
| Dispatch next | WorkRun queue | Dispatch the next queued run. |
| Retry dispatch | WorkRun | Retry a failed dispatch lease. |
| Cancel run | WorkRun | Cancel this execution instance. |
| Pause schedule | WorkSchedule | AI stops future triggers after operator confirmation without canceling the parent Task. |
| Resume schedule | WorkSchedule | AI resumes future triggers after operator confirmation. |
| Cancel schedule | WorkSchedule | AI permanently cancels the schedule, parent Task, and non-terminal runs after operator confirmation. |

Command acknowledgement means a command was accepted, rejected, or failed. Final state is shown after runtime events or a fresh snapshot.

## Not In Scope

- Do not turn Tasks into a full manual project-management suite.
- Do not expose a manual Task creation form or direct creation endpoint; confirmed Chat and Intake are the creation paths.
- Do not stream every background trace event into Chat.
- Do not show future schedules as running work.
- Do not create a third work truth in frontend-local state.

## Verification Direction

- Tasks shows Task as the only top-level product object.
- Schedule and execution history remain visible inside the parent Task.
- Future schedules are visible before trigger time.
- WorkRun blockers, completion, failure, and Access-related evidence are visible without becoming raw Chat spam.
- Goal-style WorkRuns can auto-continue while intermediate steps stay in trace/events.
- Source links return to TinyOffice-owned source surfaces when available.

Product note: Tasks should describe Work ownership and execution as owner member, assigned member, or execution member. Work product fields are member-based (`ownerMemberId`, `assigneeMemberId`, and related member actor fields); visible copy should not classify work as human-vs-AI. Use role, responsibility, runtime capability, status, and evidence instead.
