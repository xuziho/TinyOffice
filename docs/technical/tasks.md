# Tasks Technical Implementation

This page records the current Tasks implementation boundary. Product behavior lives in [Tasks](../product/tasks.md).

## Module Boundary

| Module | Responsibility |
| --- | --- |
| `src/work/tasks-view-model.ts` | Stable `TasksViewModel` contract and list/detail projection. |
| `src/work/tasks-loader.ts` | Aggregates WorkTask, dispatch lease, Process Trace, usage, and source information. |
| `src/work/work-repository.ts` | WorkTask / WorkSchedule / WorkRun repository interfaces using `workTaskId` as the single WorkRun parent id. |
| `src/work/work-dispatch-lease.ts` | Dispatch lease repository and lease state. |
| shadcn Tasks surface | Current Task-facing operations surface under `apps/tinyoffice-web-shadcn/src/tasks/TasksPage.tsx`; consumes `/api/companies/:companyId/tasks/view-model`. |

## Request Flow

1. The shadcn Tasks surface reads `/api/companies/:companyId/tasks/view-model`.
4. `tasks-loader.ts` aggregates runtime data.
5. `tasks-view-model.ts` projects a Task aggregate contract with schedule and execution child data.
6. The frontend renders list/detail/empty/error/action feedback from the view model. It does not expose Task creation; confirmed Chat and Intake own creation.

The foreground UI uses Task language even though the backend storage model remains WorkTask / WorkSchedule / WorkRun. The current shadcn page projects the returned Task aggregates into three client-side operator views: `Current` (`status === active`), `Scheduled` (active with an enabled schedule), and `History` (completed, canceled, or archived). These views may overlap by design and do not change the backend contract. Current additionally partitions visible rows into `Needs attention` and `Up next`. Selecting a row fetches the selected Task detail and replaces the list with a full-width detail view plus a back action. The list columns are `Task`, `State`, `Owner`, `Next action`, and `Updated`; source, complete schedule data, executions, and evidence stay in Task detail.

The Tasks view-model contract is `version: 3` with `productBoundary: "task-aggregate"`. It exposes Tasks as the only top-level product collection. Schedule and execution records may appear only nested under their parent Task detail or Task list item summaries. Each projected execution carries backend-authorized `retry-dispatch`, `retry-run`, and `cancel-run` actions with enabled state and reason. The frontend must not present schedules or executions as peer top-level tabs, a permanent side panel, or raw operator-facing terms such as `Work` or `trigger rules`.

Task detail exposes the current objective revision, immutable revision history, and the Task revision used by every execution. This is evidence only: objective changes are confirmed in Chat through `work.revise`, not edited manually from Tasks.

The retired native console HTML entrypoint is not a current preview or product route.

## Data Sources

| Data | Source |
| --- | --- |
| WorkTask / WorkSchedule / WorkRun | Work repository |
| Dispatch lease | Work dispatch lease repository |
| Process Trace | Process trace store |
| Source link | WorkTask source fields and runtime source route |
| Employee assignment metadata | WorkRun assignee and WorkTask owner ids. Tasks does not expose native Employee Status hrefs. |

## Runtime Events

Tasks uses `REST snapshot + Socket.IO realtime invalidation`.

| Event | Handling |
| --- | --- |
| `work_run.created` | Silent snapshot reload |
| `work_run.updated` | Silent snapshot reload |
| `work_run.stale` | Silent snapshot reload |
| `work_task.updated` / `work_schedule.updated` | Silent snapshot reload. These are the current product event names for task/schedule changes. |
| `process_trace.appended` | Update related detail and timeline |

REST snapshot is used for initial load, manual refresh, reconnect recovery, and authority reconciliation. WebSocket command acknowledgement means the command was accepted, rejected, or failed; it does not replace final state.

## Verification

```powershell
node --import tsx --test tests\work\tasks-view-model.test.ts tests\work\tasks-loader.test.ts
npm run docs:build
```

## Owned Runtime Evidence Links

Task detail is the only selected product object in the Tasks view-model. Runtime evidence remains keyed by its native evidence id, but Tasks navigation uses the parent `workTaskId` only.

- `work-run` evidence links may carry `workRunId` as metadata, but their Tasks href uses `workTaskId`
- `session` links keyed by `sessionId`
- `process-trace` links keyed by `processTraceId`

The React product surface renders those links from the JSON contract as Tasks-owned evidence metadata. Until a matching React destination handler exists, `href` values stay visible as references only; the frontend must not construct carrier thread, post, channel, root-post, or native console navigation.

WorkRun assignee and WorkTask owner facts stay as employee id metadata in Tasks list and detail models. Tasks must not emit `/console/employee-status` as a product evidence destination; runtime session evidence should use the Sessions product reference when a session is present.

Process Trace and WorkRun records use `workTaskId` for Task navigation. Current Tasks navigation must route through `workTaskId`, not retired plan-view URLs, `workRunId`, or `workScheduleId`.
