# Employee Runtime Summary Technical Implementation

This page records the implementation boundary for the Chat-scoped Employee Runtime Summary. Product behavior is documented in [Employee Runtime Summary](../product/employee-status.md) and identity boundaries are documented in [Member Identity Model](../product/member-identity-model.md).

## Module Boundary

| Module | Responsibility |
| --- | --- |
| `src/runtime/employee-status/employee-status-loader.ts` | Aggregates internal runtime/work status evidence. |
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

The summary is a read model. It does not persist new facts itself.

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
