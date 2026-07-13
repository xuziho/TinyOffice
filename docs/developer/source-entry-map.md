# Source entry map

This page is the contributor-oriented path from a product question to its implementation owner.

| Change area | Start here | Continue into |
| --- | --- | --- |
| Frontend route or shell | `apps/tinyoffice-web-shadcn/src/app/App.tsx` | the feature directory under `apps/tinyoffice-web-shadcn/src/` |
| Frontend HTTP behavior | `apps/tinyoffice-web-shadcn/src/api/` | `src/api/tinyoffice-api/` and frontend contracts |
| Chat projection and entry | `src/collaboration/chat/` | `src/collaboration/api/`, message and channel services |
| Messages and attachments | `src/collaboration/message/`, `src/collaboration/attachments/` | PostgreSQL repositories and API routes |
| Employee runtime | `src/runtime/provider/`, `src/runtime/pi/` | runtime session storage and process trace |
| Tasks and background work | `src/work/` | task view model, execution service, control plane |
| Access and governance | `src/governance/`, `src/runtime/company-config/` | Access routes and frontend Access module |
| Company and member configuration | `src/runtime/company-config/`, `src/runtime/members/` | Company API routes and Employees/Company pages |
| System AI | `src/system-ai/` | company System AI configuration and audit repository |
| Realtime | `src/runtime/realtime/`, `src/collaboration/realtime/` | websocket contract and frontend realtime hooks |
| Schema and storage | `src/runtime/company-config/postgres-schema.ts` | domain PostgreSQL repositories |

TinyOffice is a modular monolith. These are ownership boundaries inside one product, not independent deployment units.

## Large-file rule

Line count is a review signal, not an automatic refactor requirement. Split a file when it combines independently changing responsibilities, blocks focused tests, or forces unrelated modules to import one another. Do not split stable orchestration merely to satisfy a size target.

Current concentrated areas are tracked in the public-release readiness report. New code should avoid expanding the preview server, frontend contract barrel, or large page components with responsibilities that already have a domain owner.
