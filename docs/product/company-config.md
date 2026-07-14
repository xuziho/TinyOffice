# Company Config

Company Config is the stable runtime configuration surface for TinyOffice. It is shared company truth, not temporary UI state.

Company is the TinyOffice tenant boundary. Every shared runtime or Operations Surface configuration request resolves an explicit `companyId` before reading or writing company truth.

## Current Decision

Company is the user-visible product object and PostgreSQL Company identity is product truth.

First deployment and later Company creation use the same Company creation flow. Schema initialization and local preview startup do not create a default Company, default members, Chat Channels, Topics, or DM conversations. When no Company exists, the Company page is the initialization surface. The shadcn frontend exposes Company as a top-level rail module beside Chat; if the current session needs initialization, the UI locks to the Company page until a Company is created. The initialization form asks for the Company name, the Company HR name, and optionally a runtime model for that HR when local PI exposes available models. TinyOffice derives `companyId` from the Company name as a lowercase slug and rejects names that cannot produce a valid id. Creating a Company seeds company-scoped defaults, creates the current user as a boss member using the current session user id and display name, creates the Company HR PostgreSQL rows and employee-local assets, and moves the UI into that Company context. The create flow does not expose a per-Company owner display name override; account naming remains session/account truth until full login and profile editing are designed. Deleting a Company requires typing the delete confirmation and then accepting a destructive confirmation dialog. Before deletion, the runtime deletion guard aborts sessions by explicit `companyId`; employee ids alone are not a safe selector because the same id may exist in more than one Company. Deletion removes the Company row and company-scoped PostgreSQL data by cascade and removes file assets under `companies/<companyId>/`. The current user's selected Company is stored in `user_profiles.current_company_id`, survives local preview restarts, and is cleared by the Company foreign key when that Company is deleted. Session resolution always revalidates the preferred Company against current membership instead of returning stale Company state. When no remaining member row exists, `session/current` resolves no active Company and the frontend returns to initialization state. Deleting the last Company returns the product to first-create state.

The active Company is session truth, not local frontend state. The shadcn app exposes the active Company switcher as the top rail control with a Company avatar and dropdown list of Companies available to the current user. Switching calls `PUT /api/tinyoffice/session/current-company`, validates membership server-side, returns the updated `TinyOfficeCurrentSession`, and causes Chat, Company, directory, realtime, and other Company-scoped queries to reload under the same active Company. Frontend-only persistence such as `localStorage` must not become the source of active Company truth.

Company Blueprint is an internal template for seeding a Company. It is not a hidden Company, not a row in `companies`, and not runtime or business history. The default internal blueprint seeds company-scoped Prompt Policy, Access, one Company HR runtime-capable member, that member's runtime profile and filesystem resource defaults, and member-local implementation assets under `companies/<companyId>/employees/<employeeId>/`.

The Company HR seed derives its internal member id from `hrEmployeeDisplayName` with the same lowercase slug and company-local numeric-suffix rule used for later recruited employees. For example, `Mira HR` becomes `mira-hr`; if that id is already reserved by the Owner, the HR becomes `mira-hr-2`. The seed has default role `hr`, resident presence, and default `thinkingLevel` `medium`. If the HR name is omitted, the seed uses `Company HR`, which derives `company-hr`. If PI exposes available runtime models during initialization, the operator may select one and TinyOffice stores that model on the HR's runtime profile. If no model is selected, the HR still exists as a runtime-capable member with incomplete runtime configuration; runtime startup must fail fast with the normal "configure runtime model first" error until the operator saves a model in Employee Config. Its responsibility is initial member setup: helping the operator configure durable runtime-capable members after Company creation. It is not granted unlimited admin authority. Its default filesystem resource policy allows its own workspace, requires approval for repository or other member workspace access, and denies secrets.

System AI is Company-scoped backend configuration, not part of the Company lifecycle itself and not an employee runtime. The Company create flow may seed a System AI model. Later changes live in the developer-gated `System AI` configuration page. Chat title generation and Topic summary refresh are configured independently through `system_ai_provider_configs`; setting either selector to `Set later` disables that capability until a model is saved. Missing or disabled System AI configuration must not block Company creation or Chat entry creation.

External input onboarding does not belong to the Company lifecycle surface. The separate company-scoped `Integrations` page explains what Intake can connect and asks the user to describe the desired automation to an AI employee. It does not ask the user to copy endpoints, compose JSON, or understand member ids. AI employees discover the machine-readable integration contract through `intake.integration.describe` and implement the connection. Integrations remains a discovery and integration-start surface, not an Intake queue or source-management product.

Employee Config, Prompt Policy, Access, and member mapping belong in PostgreSQL-backed runtime configuration scoped to a Company. Employee-local instruction and workspace files remain file assets; shared configuration does not.

## Editing Safety

System AI, Employees (including existing employee-private skills), Prompt Policy, and Access use one shared unsaved-change contract in the standalone frontend:

- Save is disabled until the draft differs from the authoritative loaded value.
- The surface shows `Saved`, `Unsaved changes`, or `Saving` state explicitly.
- A failed save preserves the draft and error so the operator can retry.
- Switching the edited local record, switching Company, changing top-level modules, using canonical cross-surface navigation, browser Back, or closing/reloading the tab asks before discarding a dirty draft.
- A successful save resets the draft baseline from the server response. Employee configuration and employee-private skill saves keep their automatic runtime reload behavior.

This is frontend draft protection, not revision history. PostgreSQL and employee-local files remain the authoritative saved sources.

## Configuration Areas

| Area | Product responsibility | Source of truth |
| --- | --- | --- |
| Employee Config | Runtime-capable member identity, runtime model, presence, and member-local guidance. The page keeps Employee naming while route/path names are being renamed. | `company_members`, `member_runtime_profiles`, `companies/<companyId>/employees/<employeeId>/AGENTS.md` |
| Employee Runtime Summary | Lightweight Chat context for non-idle runtime-capable members and their current work. It is not an independent configuration surface. | Aggregated read model from Work, sessions, ChannelTopics, dispatch leases, and employee config, projected through `/employees/runtime-summary` |
| Prompt Policy | Shared prompt templates and scene Prompt Blocks, with scene loading handled by runtime contract. | `prompt_policy_templates`, `prompt_policy_blocks` |
| Access | Sensitive resource and high-risk command access policy. | `tool_safety_policies` |
| System AI Settings | Company-level backend model selection for Chat title generation and Topic summaries. | `system_ai_provider_configs` |
| Members / Directory | Company members and their runtime-profile availability. | `company_members`, `/api/companies/:companyId/directory`, and `/api/companies/:companyId/member-directory`; direct `/members` CRUD is retired |

All configuration areas above are Company-scoped. Users may belong to multiple Companies; their roles, member profile, runtime-member visibility, and filesystem resource defaults are evaluated inside the active Company only.

Local development may create a Company named `tinyoffice`, but it is ordinary runtime data created through the product lifecycle, not a schema seed or hidden fallback. A boss user such as `xuziho` is a company member and should not be resolved through an internal employee shortcut. Runtime-capable members are ordinary members with records in `member_runtime_profiles`. Product UI should present one member directory instead of separate human-vs-AI buckets.

The formal product identity boundary is [Member Identity Model](member-identity-model.md). In short: `employeeId` remains a current runtime selector and storage field for runtime-capable members, while `memberId` / Member is the product-facing subject.

TinyOffice authenticates exactly one human Owner through a PostgreSQL-backed server session. Localhost exchanges a private one-time launcher ticket for that session; remote deployments require a Passkey. The session may resolve the Owner without a Company during first use, or the Owner plus the active Company member after Company creation. Request headers, arbitrary URL parameters, and request bodies are not authentication inputs and cannot impersonate another member. Company-scoped routes derive the actor from the verified Owner session, then enforce Company membership and role rules. The full decision and deployment boundary are recorded in [Owner Authentication](owner-authentication.md).

## Access

Access is the runtime guard policy entry for sensitive resources and high-risk commands. It is not a full business permission system, not a sandbox, and not an employee-level tool marketplace.

Product boundary:

- Operations Surface shows resource groups and the read/write/bash decisions that can affect runtime tool calls.
- Runtime enforcement reads the current Access policy from PostgreSQL.
- Business actions are not added here just because they are possible AI actions.
- Bash remains a flexible execution tool. Access guards known dangerous command patterns and sensitive path mentions, but it does not claim complete OS-level isolation.

Current Access policy truth lives in PostgreSQL `tool_safety_policies`.

## Prompt Policy

Prompt Policy manages stable company-level prompt text: Base System Prompt, Runtime Prompt Template, and the four scene Prompt Blocks for Channel, DM, Intake, and WorkRun. Runtime loads the expected core scene blocks through an internal contract rather than asking operators to maintain a manual scene binding matrix. Prompt Policy is where shared prompt template text belongs; Employee Config is where employee-specific responsibilities and personal guidance are edited through employee-local instruction files. Access is where sensitive resource and command limits belong.

Current Prompt Policy truth lives in PostgreSQL `prompt_policy_templates` and `prompt_policy_blocks`. Prompt Policy editing does not expose arbitrary scene binding writes.

## Employee Config

Employee Config is the current route for Member Runtime Configuration. It maintains runtime-capable member identity, runtime config, role/responsibility guidance, and member-local instruction files. For a newly created Company, Employee Config starts with the Company Blueprint's Company HR seed.

Employee ids for runtime-capable members are unique within a Company, not globally. Runtime and Operations Surface code qualify employee lookup, role display, and saved configuration by `companyId` plus employee id.

The employee runtime model is explicit configuration. New or saved employees must provide `runtime.modelProvider` and `runtime.modelId`; employee runtime startup must fail fast instead of letting the PI SDK implicitly choose a model. The selectable model catalog comes from the currently installed PI model registry plus locally configured provider credentials; TinyOffice does not maintain a handwritten model allowlist or fetch a separate live OpenAI model list. New provider models therefore become selectable through a verified PI dependency upgrade.

Employee workspace files remain workspace resources and are not migrated into the configuration database. Employee Config edits the one employee-owned long-term guidance file that PI loads for that employee: `companies/<companyId>/employees/<employeeId>/AGENTS.md`. Employee workspaces resolve under `companies/<companyId>/employees/<employeeId>/workspace`.

User-managed Skills have two scopes only. Company Skills live under `companies/<companyId>/skills` and are loaded by runtime-capable employees in that Company. Employee Skills live under `companies/<companyId>/employees/<employeeId>/skills` and are loaded only by that employee. TinyOffice system operations are capability-registry contracts, not a third user-managed Skill scope. Company Blueprint changes affect newly created Companies only; existing Companies do not inherit later blueprint changes.

Organization owns Company profile and lifecycle. Company logos are optional PNG, JPEG, or WebP assets under `companies/<companyId>/branding` and appear in the Company switcher; initials remain the fallback. Settings owns the current account display name. Account display names are stored independently from Company roles and propagated to the user's Company member records, while roles remain governance-owned and read-only in Settings.

The Company HR assets resolve under `companies/<companyId>/employees/<derivedHrEmployeeId>/`. Its `AGENTS.md` describes the initial member setup responsibility and points back to Company Prompt Policy and Access as the shared operating boundary. The Company Blueprint also seeds the HR-local `recruit-employee` skill so a newly created Company can propose and create runtime-capable employees through the TinyOffice API tool after operator confirmation.

## Boundaries

- Do not treat Operations Surface form state as long-lived truth.
- Do not keep file config and PostgreSQL config as permanent dual sources.
- Do not introduce a global or default Company fallback.
- Do not model Company Blueprint as a Company row, hidden tenant, or runtime history.
- Do not expose retired setup names or zero-indexed member concepts in first-use product copy.
- Do not treat Access as a full enterprise permission system.
- Do not turn employee role responsibilities into broad hard gates.

## Verification

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/runtime/company-database-config.test.ts tests/runtime/postgres-schema.test.ts
npm run docs:sync-obsidian
```
