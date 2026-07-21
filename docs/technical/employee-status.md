# Employee Runtime Summary Technical Implementation

This page records the implementation boundary for the Chat-scoped Employee Runtime Summary. Product behavior is documented in [Employee Runtime Summary](../product/employee-status.md) and identity boundaries are documented in [Member Identity Model](../product/member-identity-model.md).

## Module Boundary

| Module | Responsibility |
| --- | --- |
| `src/runtime/employee-status/employee-status-loader.ts` | Aggregates internal runtime/work status evidence. |
| `src/runtime/employee-status/postgres-employee-status-reader.ts` | Reads the exact Work, Session, Topic, and dispatch-lease rows needed by the summary through one bounded PostgreSQL connection. It must not open full mutable repositories or load historical evidence collections. |
| `src/runtime/employee-status/employee-status-view-model.ts` | Builds the internal page-shaped status read model used as a source projection. This is not a public API contract. |
| `src/runtime/employee-status/employee-runtime-summary.ts` | Projects the internal read model into the narrow Chat runtime summary contract. |
| `src/api/tinyoffice-api/employee-runtime-summary-routes.ts` | Exposes the Chat-scoped summary API route. |
| `apps/tinyoffice-web-shadcn/src/api/employeeRuntimeSummaryClient.ts` | Loads the summary for the shadcn Chat app. |
| `apps/tinyoffice-web-shadcn/src/chat/ContextPanel.tsx` | Shows selected direct-message directory issue/current-work summary before a concrete DM topic is open. Concrete DM topics reserve the rail for Activity and evidence. |
| `apps/tinyoffice-web-shadcn/src/chat/WorkspaceSidebar.tsx` | Shows compact non-idle employee status when no unread or mention badge is present. |

## Data Sources

| Data | Source |
| --- | --- |
| Runtime-capable member identity | Company directory / member runtime profile, currently selected through the existing employee/member runtime identifier. |
| Work load | WorkTask / WorkSchedule / WorkRun repository. |
| Session summary | `session_records`. |
| Topic ownership | ChannelTopic owner. |
| Dispatch lease evidence | `work_dispatch_leases`, joined by the most relevant WorkRun. |

The summary is a read model. It does not persist new facts itself. Concurrent requests for the same company, employee filter, sort, and route shape share one in-flight load. Its PostgreSQL reader executes a narrow snapshot over `work_tasks`, `work_schedules`, `work_runs`, `work_dispatch_leases`, `session_records`, and `channel_topics`; it intentionally does not load Work revisions/events, Session events, Process Trace, collaboration actions, memory summaries, retention state, or Topic handoff history.

Employee directory/config loading completes before the status snapshot acquires its PostgreSQL client. The snapshot owns one connection and releases it in one `finally` boundary; it must not hold one repository client while waiting for another repository or pool. Shared runtime pools use finite connection-acquisition and query timeouts so saturation fails explicitly instead of leaving product APIs pending indefinitely.

## Runtime Summary API

```text
GET /api/companies/:companyId/employees/runtime-summary
```

Optional query:

```text
employeeId=<runtime-capable-member-id>
```

The route returns `EmployeeRuntimeSummaryViewModel`:

- `contract.name = "employee-runtime-summary"`
- `contract.productBoundary = "chat-employee-context-runtime-summary"`
- `employees[]` with display name, role, status, small counts, current items, and up to three concrete actionable `issues[]`.

`issues[]` is the Chat-safe bridge from internal status evidence to user-actionable context. It is filtered before leaving the runtime summary module. Today the only public issue is a blocked WorkRun with a related WorkTask target, because Tasks is the surface where the user can resolve, resume, cancel, or archive the work. Failed or interrupted Sessions and failed WorkRuns remain source evidence and may still affect internal counts such as `recentFailureCount`, but they must not become Chat attention items or context-panel cards by themselves. The frontend uses this only in the direct-message directory context panel, limits it to one compact blocker, and links to Tasks when an actionable related task exists.

The public contract intentionally excludes page-shaped fields such as filters, sort options, detail sections, model provider, model id, thinking level, raw evidence payloads, and native console links.

## Retired Public Routes

The old public routes are hard-retired and must return 404:

```text
GET /api/companies/:companyId/employees/status
GET /api/companies/:companyId/employees/:employeeId/self-status
```

Do not reintroduce them as compatibility aliases. If a future status page is accepted, define a new product workflow and contract instead of reviving the old page-shaped API.

## Tests

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests\runtime\employee-status-view-model.test.ts
node --import tsx --test tests\api\tinyoffice-api.test.ts
node --import tsx --test tests\frontend\shadcn-frontend-foundation.test.ts
npm run check --prefix apps\tinyoffice-web-shadcn
```
