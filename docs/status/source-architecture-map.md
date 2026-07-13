# Source Architecture Map

This page is a compact source map for current TinyOffice development.

## Frontend

| Area | Source | Notes |
| --- | --- | --- |
| Shadcn frontend app | `apps/tinyoffice-web-shadcn` | Current documented frontend target. |
| App shell / route loading | `apps/tinyoffice-web-shadcn/src/app/App.tsx` | Persistent rail, session truth, navigation, and lazy route boundaries. |
| Chat workbench route | `apps/tinyoffice-web-shadcn/src/chat/ChatWorkspaceRoute.tsx` | Mounts Chat queries and realtime only while the Chat route is active. |
| Frontend API clients | `apps/tinyoffice-web-shadcn/src/api` | App-local HTTP boundary. |
| Chat model assembly | `apps/tinyoffice-web-shadcn/src/chat/chatShellModel.ts` | Converts DTOs into Chat UI model. |
| UI primitives | `apps/tinyoffice-web-shadcn/src/components/ui` | shadcn/approved registry primitives. |

## Backend

| Area | Source | Notes |
| --- | --- | --- |
| API routes | `src/api`, `src/collaboration/api` | Product HTTP and Chat route boundaries. |
| Chat / Message | `src/collaboration` | Conversation, Message, Chat Projection, create-entry, room read/send/read-state. |
| Realtime | `src/runtime/realtime`, `src/collaboration/realtime` | TinyOffice-owned realtime events. |
| Runtime | `src/runtime` | Employee runtime, provider boundary, sessions, dispatch. |
| Work | `src/work` | WorkTask, WorkSchedule, WorkRun, view models, dispatch. |
| Governance / Access | `src/governance`, `src/runtime/company-config` | Tool safety policy, access requests, configuration APIs. |
| Contracts | `src/api/contracts`, `src/collaboration/contracts` | Frontend-safe DTOs and backend contracts. |

## Current Frontend Coverage

The shadcn application now owns Chat, Tasks, Sessions, Employees, Company, Skills, Integrations, System AI, Prompt Policy, Access, Capabilities, Doctor, Settings, and Backup/Restore. Tasks and Sessions use the company-scoped product view-model APIs. Employee configuration is member-first and runtime capability is a property of a Company member rather than a parallel identity system.

Native HTML Console renderers and the retired local primitive frontend are not current product destinations.

The main remaining frontend foundation work is incremental accessibility, responsive behavior, and reducing composition size inside frequently changed pages. Route-level delivery and Chat lifecycle isolation are already enforced by the production bundle gate. It is not a second migration.

## Guardrails

- Do not point new frontend work to retired local primitive UI.
- Do not describe unbuilt shadcn modules as current UI.
- Do not derive frontend product state from backend internals or retired carrier fields.
- Keep route and module coverage in this page synchronized with the implemented shadcn application.
- Keep product facts in `docs/product`, implementation boundaries in `docs/technical`, and current-state inventories in `docs/status`.
