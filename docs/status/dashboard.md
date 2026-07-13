# Current Dashboard

This page is the high-level development status dashboard for TinyOffice.

## Product Snapshot

| Item | Current value |
| --- | --- |
| Main product repository | Current repository root |
| Product manual | Development product architecture memory and code-action index |
| Stack | TypeScript, Node.js, PostgreSQL, TinyOffice-owned Chat/Message, React standalone frontend |
| Main collaboration surface | TinyOffice-owned Chat/Message and standalone frontend |
| Local operations surface | Operations Surface |
| Runtime data boundary | PostgreSQL `tinyoffice`, `.data/` migration/backup material, `.logs/`, `.scratch/` |
| Docs source | `docs/` |
| Navigation config | `mkdocs.yml` |

## Current Product Spine

TinyOffice is a local-first AI company collaboration runtime, not a generic agent platform or vertical SaaS bundle.

The current spine:

1. Persistent employee identities with runtime config and session continuity.
2. TinyOffice-owned Chat/Message through standalone frontend and runtime APIs.
3. Background WorkTask / WorkSchedule / WorkRun queue, dispatch, execution, blocker, recovery, and completion.
4. Operations Surface targets Tasks, Sessions, Employee Runtime, Status, Company, Prompt Policy, and Access.
5. PostgreSQL-backed company truth.

## Current Capabilities

| Capability | Current fact | Main entry |
| --- | --- | --- |
| Chat / Message | TinyOffice-owned Conversation, Message, Chat Projection, and create-entry services. | `src/collaboration`, `apps/tinyoffice-web-shadcn` |
| Realtime | TinyOffice-owned Chat/Message events, projection updates, and runtime dispatch visibility. | `src/runtime/realtime`, `src/collaboration/realtime` |
| Employee runtime | Employee identity, Company-scoped Employee Home, PI agent, session explorer, and runtime session repository. | `src/runtime`, `companies/<companyId>/employees/<employeeId>/` |
| Work system | WorkTask creation, optional WorkSchedule trigger, WorkRun queue, dispatch lease, execution, blocker recovery, and admin view. Repository storage is split; service/API/UI naming cleanup remains. | `src/work` |
| Access / governance | Access requests, temporary grants, sensitive resource decisions, and product-side Access records. | `src/governance` |
| PostgreSQL data foundation | Company config, runtime state, Work, logs, Access requests, and sessions. | `TINYOFFICE_DATABASE_URL`, `src/runtime/company-config` |
| Operations Surface | Tasks, Sessions, Employees, Company, Prompt Policy, Settings, Doctor, and developer-gated Access are shadcn surfaces. Employee runtime status is exposed as lightweight Chat context rather than a standalone daily Status page. Operating Log is underlying evidence, not a standalone product page. | `apps/tinyoffice-web-shadcn`, `src/runtime/company-config` |

## Verification Signals

| Command | Purpose |
| --- | --- |
| `npm run check` | TypeScript check. |
| `npm test` | Main repository tests. |
| `npm run docs:sync-obsidian` | Sync Obsidian reading copy. |
| `npm run docs:build` | Strict MkDocs build. |
| `npm run smoke:no-carrier-chat` | Default TinyOffice-owned Chat product smoke. |
| `npm run smoke:standalone-frontend-browser` | Product frontend browser smoke for `apps/tinyoffice-web-shadcn`. |
