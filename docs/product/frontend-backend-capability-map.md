# Frontend / Backend Capability Map

This page maps backend capability to the current shadcn frontend rebuild and records whether each API family is part of the current product, a runtime/tool contract, an internal foundation, or still under observation.

The documented frontend target is `apps/tinyoffice-web-shadcn`. Product manual pages must not point new frontend work at retired local primitive UI, deleted plugin UI, carrier ids, or old app structure.

Configuration and operations surfaces are top-level product rail modules, not Chat Context side-panel content.

## Capability Categories

| Category | Meaning |
| --- | --- |
| keep: product surface | The capability has a current user-facing product path in the shadcn frontend. |
| keep: chat embedded | The capability is visible inside Chat rather than as a standalone page. |
| keep: developer surface | The capability is intentionally hidden behind developer mode. |
| keep: runtime/tool contract | The capability is used by runtime, AI-callable tools, or capability registry workflows. It does not need a normal frontend page. |
| keep: internal foundation | The capability supports current product behavior as a lower-level service or contract. Public HTTP exposure should still be justified separately. |
| observe | Current consumer or product boundary is not proven enough from this map. Each item in this group must be audited and then moved to a keep or delete decision. |
| delete candidate | No current product path, runtime/tool consumer, or internal foundation role has been proven. Do not keep only because it may be useful later. |

## Current Product Truth

```text
apps/tinyoffice-web-shadcn
  -> app-local API clients
  -> TinyOffice API
  -> Chat / Message / Runtime / Work services
  -> PostgreSQL
```

## Current Backend Capability Classification

| API family | Current category | Current consumer / product path | Decision note |
| --- | --- | --- | --- |
| Owner auth: `/api/auth/*`, `GET /api/tinyoffice/auth/status`; current Company: `GET /api/tinyoffice/session/current`, `PUT /api/tinyoffice/session/current-company` | keep: product surface | Passkey gate, app startup, and Company switcher. | One verified Owner session; no browser-selectable identity path. |
| Company lifecycle and branding: `GET/POST /api/companies`, `DELETE /api/companies/:companyId`, `/branding` | keep: product surface | Manage / Organization and Company switcher. | Organization owns creation, selection, identity, logo, and deletion. Ongoing subsystem settings do not live here. |
| System AI: `PATCH /api/companies/:companyId/system-ai` | keep: developer configuration | AI & Runtime > System AI. | Company-scoped model selection for Chat titles and Topic summaries. |
| External Intake: `POST /api/companies/:companyId/intake/events`; capability `intake.integration.describe` | keep: product surface | Human-facing `/integrations` discovery module; AI-facing capability contract. | Users describe the automation to AI. AI discovers and implements the technical contract. No Intake queue, source registry, or automation control plane. |
| Chat projection, Channel, room, title, archive, restore, activity, and run-cancel APIs under `/api/companies/:companyId/chat` | keep: product surface | `/chat` shell, Channel/DM navigation, room message view, context rail, composer, title editor, Channel settings, runtime activity. | Chat is the main collaboration surface and should keep using the Chat facade rather than exposing storage internals. |
| Chat image attachments: `/api/companies/:companyId/chat/attachments` and `/content` | keep: product surface | Chat room composer and message stream. | Current supported attachment scope is image upload/rendering. Broader file parsing remains outside current product scope. |
| Company directory: `GET /api/companies/:companyId/directory` | keep: product surface | Chat DM contacts and Channel add-member picker. | Frontend-facing directory. Task ownership is confirmed conversationally and resolved by AI through the AI-callable member directory. |
| Employee runtime summary: `GET /api/companies/:companyId/employees/runtime-summary` | keep: chat embedded | Chat left-rail member status markers and direct-message context panel. | Not an independent Status page. It is a compact Chat context projection. |
| Employee runtime config and private skills: `/api/companies/:companyId/member-runtime...` | keep: product surface | Manage / Employees. | Runtime-capable member configuration, AGENTS.md guidance, model selection, reload, and existing private skill editing live here. |
| Skill lifecycle capabilities and Company Skill editor: `skill.list`, `skill.describe`, `skill.create`, `skill.update`, `/api/companies/:companyId/skills...` | keep: runtime/tool contract + product editor | Confirmed Chat creation plus Manage / Company Skills and Employees private Skill editing. | User-managed Skills have Company and Employee scopes only. Paths, validation, isolation, and reload are system-owned. |
| Capability registry: `/api/companies/:companyId/capabilities` | keep: developer inspection | AI & Runtime > Capabilities. | Read-only visibility into system-owned descriptions, schemas, scenes, confirmation policy, and guardrails. |
| Current account profile: `/api/tinyoffice/profile` | keep: product surface | Settings / My Profile. | Account display name is separate from Company role; role remains governance-owned. |
| Employee creation: `POST /api/companies/:companyId/employees` | keep: product surface | `/employees` new employee flow. | This is the current user-facing way to create a runtime-capable employee. |
| Runtime models: `GET /api/runtime/models` | keep: product surface | Company setup/System AI selection and Employees runtime model selection. | Shared model discovery endpoint for configuration surfaces. |
| Prompt Policy: `/api/companies/:companyId/prompt-policy...` | keep: product surface | `/prompt` rail module. | Company-scoped prompt text and reset/save operations. |
| Tasks view and run actions: `/api/companies/:companyId/tasks/view-model`, `/tasks/runs/:workRunId/actions/:actionId` | keep: product surface | `/tasks` rail module. | Tasks is the foreground operations surface for WorkTask/WorkRun state. |
| Work lifecycle: `/api/companies/:companyId/work/:workTaskId/...` | keep: product surface | `/tasks` cancel, archive, and restore flows. | Direct `POST /work` creation is retired. Confirmed Chat uses `work.create`; Intake uses its scene result. Backend keeps WorkTask/WorkRun naming while frontend presents Task language. |
| Sessions view model: `GET /api/companies/:companyId/sessions/view-model` | keep: product surface | `/sessions` rail module and Chat return links. | Runtime evidence console; raw debug evidence stays scoped. |
| Access policy, preview, request list, request resolution, and tool-call bridge under `/api/companies/:companyId/access` | keep: developer surface + runtime/tool contract | AI & Runtime > Access, Chat foreground Access cards, PI tool guard bridge. | Access request approval belongs in Chat foreground cards; the Access page is for advanced policy tuning. |
| Doctor: `GET /api/companies/:companyId/doctor` | keep: developer surface | Operations > Health. | Read-only system/config diagnostics only; not business task failure review. |
| Full-instance backup engine and internal UI routes | keep: developer surface + operator CLI | Operations > Backup & Restore; `agentco backup`. | TinyOffice owns verified package and restore semantics. External automation owns schedule, remote storage, retention, and notifications. |
| Member directory capability: `company.member.directory.list` | keep: runtime/tool contract | `tinyoffice_capability_call` and capability registry workflows. | AI-callable people-selection directory. It should not become a normal rail page by default. |
| Conversation/Message storage contract | keep: internal foundation | MessageService, message repositories, Chat room APIs, runtime dispatch, and realtime publication. | Public `/api/companies/:companyId/conversations...` routes are retired. Product and frontend code use the `/chat` facade. |
| Company member storage | keep: internal foundation | `company_members` table, Company Directory, Member Directory, and employee recruitment. | Public `/api/companies/:companyId/members...` CRUD routes are retired. Runtime-capable employee creation uses `/employees`; member selection uses `/directory` or `/member-directory`. |

## Deferred Product Scope

The following items are observation candidates, not accepted roadmap scope. Revisit them only after real usage provides evidence that the missing surface causes recurring work:

- an operator-facing Intake queue;
- broader file-management surfaces beyond current attachments and configured assets;

The current lifecycle pass explicitly does not add a global Attention inbox, global search, Topic completion states, complex Channel roles, manual Task creation, or Session/Trace lifecycle controls.

These items are not accepted future work by default. They remain absent until a concrete product workflow proves they are needed.

| Item | Why it is under observation | Audit question |
| --- | --- | --- |
| Broader non-image file attachment product scope | The message contract can carry attachment metadata, but the current product only supports image upload/rendering. | Should non-image upload/parsing/OCR/PDF be accepted into the product roadmap, or should contracts stay narrow until a concrete workflow exists? |
| Full message search | There is no accepted backend search API. | Is search important enough for Chat/Sessions/Tasks now, or should it remain absent rather than represented as a placeholder capability? |

## Current Frontend Files

| File | Role |
| --- | --- |
| `apps/tinyoffice-web-shadcn/src/app/App.tsx` | Current Chat shell orchestration and composed UI surface. |
| `apps/tinyoffice-web-shadcn/src/api/chatClient.ts` | Chat Projection, room messages, read state, and create-entry API client. |
| `apps/tinyoffice-web-shadcn/src/api/currentSessionClient.ts` | Current session API client. |
| `apps/tinyoffice-web-shadcn/src/api/directoryClient.ts` | Company Directory API client. |
| `apps/tinyoffice-web-shadcn/src/chat/chatShellModel.ts` | DTO-to-UI model assembly for Chat surfaces. |
| `apps/tinyoffice-web-shadcn/src/components/ui/*` | shadcn-installed primitives and approved registry primitives. |

## Guardrails

- Frontend work must consume backend truth through app-local API clients.
- Do not import backend implementation modules into the frontend.
- Do not install the repository root as a frontend package dependency.
- Do not invent participants, evidence, channels, room ids, or titles locally.
- Do not use retired carrier ids, plugin routes, deleted UI entrypoints, or old local primitive systems as frontend sources.
