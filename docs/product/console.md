# Operations Surface

TinyOffice Operations Surface is the product area for operations and configuration modules in the standalone React app under `apps/tinyoffice-web-shadcn`. Chat, Organization, Employee Runtime, Prompt Policy, Access, Sessions, Tasks, Settings, Doctor, and Backup & Restore use shadcn surfaces. Lower-frequency Company, AI/runtime, and system destinations live in grouped Workforce and Admin menus so daily collaboration navigation remains small without hiding the product map behind implementation-oriented labels.

Native HTML Console pages and `/console/...` routes are retired from current product/admin behavior. `/api/console/...` aliases are also retired. New product work must use company-scoped TinyOffice APIs directly.

## Current Product Facts

Stable responsibilities:

- create and administer Companies before tenant data is shown
- inspect WorkTask, WorkSchedule, and WorkRun queues, status, results, blockers, and timelines
- inspect runtime-capable member state, related Work, held Topics, and recent sessions
- edit runtime-capable member configuration and Prompt Policy through standalone React modules
- edit Access policy through the developer-mode Access module when advanced runtime guard tuning is needed
- inspect member runtime sessions, conversation turns, work evidence, usage, and model input packages
- run read-only Doctor diagnostics for current Company setup, employee runtime configuration, PI model availability, and Access policy loading
- create and download verified full-instance backups while keeping scheduled transfer and retention in the operator CLI boundary
- manage the current account profile, runtime prerequisites, and controlled product update status through Settings

Company is the user-visible tenant boundary. Current product routes and APIs require explicit Company context.

The global rail separates daily work from workforce and administration. Only `Chat` and `Tasks` stay in the upper primary group. `Workforce` owns Employees and Company Skills. `Admin` groups Organization and Integrations under Company; System AI, Prompt, Access, and read-only Capabilities under AI & Runtime; and Sessions, Health, and Backup & Restore under System. Health opens the existing read-only Doctor route. Settings remains the account destination and owns the current account profile, local preferences, security, and the Update Center.

## Feature Map

| Feature | Current product entry | Source of truth |
| --- | --- | --- |
| Standalone Frontend | `apps/tinyoffice-web-shadcn` | TinyOffice APIs under `/api/companies/:companyId/...` |
| Chat | Current rebuilt shadcn surface | Chat Projection, Conversation, and Message APIs |
| Company Lifecycle | Admin > Company > Organization at `/company` | PostgreSQL `companies`, Prompt Policy defaults, Access defaults |
| Settings | Current bottom rail module at `/settings` | Account profile plus Update Center status from npm and the TinyOffice stable approval manifest |
| Tasks | Current `Tasks` rail module at `/tasks` | Work repositories and Tasks view model |
| Sessions | Admin > System > Sessions at `/sessions` | Runtime session repositories and Sessions view model |
| Status | Lightweight Chat employee context and rail status markers | Runtime status, WorkRun, Session, and dispatch evidence |
| Employee Runtime | Workforce > Employees at `/employees` | PostgreSQL runtime-capable member config plus member-local guidance assets |
| Prompt Policy | Admin > AI & Runtime > Prompt at `/prompt` | PostgreSQL Prompt Policy tables |
| Access | Admin > AI & Runtime > Access at `/access` | PostgreSQL `tool_safety_policies` |
| Members | Backend/API/tool capability; not a current rail page | `company_members` with explicit runtime binding |
| Doctor | Admin > System > Health at `/doctor` | `/api/companies/:companyId/doctor`, `agentco doctor` |

During local development, Vite proxies `/api` to the TinyOffice runtime. There is no Vite `/console` product proxy.

## Boundaries

- The standalone frontend is the current product UI.
- Native HTML renderers and Console shell code are not current product paths.
- Shared runtime configuration and runtime records belong in PostgreSQL.
- Missing PostgreSQL configuration should fail fast.
- Mattermost identity, root-post identity, and carrier-thread identity are not current product evidence.
- Doctor is read-only. It reports system and configuration checks plus next steps for repairable setup issues. It does not judge individual business task outcomes, mutate Company data, run automatic repairs, or replace the specific Chat, Tasks, Sessions, Employee Runtime, Prompt, or Access surfaces.
- Update Center and Doctor share the same update diagnostics truth. A bundled fallback manifest may explain the locally approved baseline when the remote stable source is unavailable, but it cannot produce an `Up to date` result or authorize installation. Doctor reports remote approval-source failure and Node runtime incompatibility from that same status.

## Verification

```powershell
npm run check
npm run build:tinyoffice-web-shadcn
npm run docs:build
```
