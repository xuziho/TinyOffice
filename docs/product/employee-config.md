# Employee Config

Employee Config is the operator entry point for long-lived runtime-capable member configuration. In the shadcn frontend, the rail label is **Employees**, placed in the bottom configuration group below the Sessions evidence entry and above Company rather than among the daily Chat and Tasks destinations. The implementation may still use employee-named routes and fields while the product language treats each configured identity as a company employee with role, responsibility, runtime capability, filesystem resource defaults, and status.

Product framing: read Employee Config as Member Runtime Configuration. Visible copy and new docs should describe configured identities as runtime-capable members. See [Member Identity Model](member-identity-model.md).

The Workforce editor treats employee identity, responsibilities, presence, runtime model, and thinking level as one `General` configuration area. Runtime model selection is important configuration, but two controls do not justify an otherwise sparse standalone tab. Active state is communicated by the Active employee collection; only exceptional inactive state is repeated beside the selected employee. Creation belongs to the employee collection header, and successful saves stay visually quiet until another edit creates actionable state.

## Purpose

- Maintain member identity, display name, role, responsibilities, and presence for runtime-capable members.
- Configure the explicit runtime model and thinking level for each runtime-capable member.
- Show each member's Company-scoped home, workspace, and skill paths.
- Edit the fixed employee personal guidance file:
  `companies/<companyId>/employees/<employeeId>/AGENTS.md`.
- View and edit existing employee-private skills under
  `companies/<companyId>/employees/<employeeId>/skills/**/SKILL.md`.
- Save configuration changes so the selected employee runtime is automatically reloaded when runtime-affecting configuration or employee-private skill content changes.

## Entrypoints

| Type | Entrypoint | Purpose |
| --- | --- | --- |
| shadcn app | `Employees` rail module | Runtime-capable employee configuration in the standalone frontend. |
| Company API | `/api/companies/:companyId/member-runtime` | Load the company-scoped Member Runtime Configuration view model. |
| Company API | `/api/companies/:companyId/member-runtime/members/:memberId` | Save one runtime-capable member's configuration through the TinyOffice-owned company API. |

## Core Concepts

| Concept | Meaning |
| --- | --- |
| Employee | Current implementation name for a runtime-capable company member with identity, role, and runtime configuration. Do not use it as a product category opposite non-runtime members. |
| Member Runtime | Product-facing framing for a configured runtime-capable member, including runtime model, presence, filesystem resource defaults, workspace assets, and reload controls. |
| Company HR | The Company Blueprint seed whose employee id is derived from its display name with the same rule as later recruited employees, used as the first setup contact for creating durable runtime-capable members. |
| Runtime model | The provider and model used when the employee starts a PI session. Operators select it from the locally available PI model registry; the UI should not require hand-entered provider strings. |
| Personal guidance | Employee-specific long-term guidance stored in `companies/<companyId>/employees/<employeeId>/AGENTS.md`. |
| Employee-private skill | Employee-specific reusable workflow knowledge stored under `companies/<companyId>/employees/<employeeId>/skills/**/SKILL.md`. |
| Local assets | The Company-scoped employee home, workspace, employee skill path, and fixed employee `AGENTS.md`. |
| Reload | Runtime refresh after saved configuration changes. Manual reload controls are advanced troubleshooting actions, not the normal way to make saved changes take effect. |

## PI Model Readiness

TinyOffice reuses the local PI configuration through the PI SDK/AuthStorage/ModelRegistry. Employee Config does not implement a TinyOffice-native PI provider setup, login, or credential flow.

When PI exposes no available models, Employee Config shows setup guidance instead of an empty picker: configure PI using the normal PI flow, then refresh Employee Config so TinyOffice can read the local model registry.

The Company HR and other runtime-capable members can exist before a runtime model is selected. They are pending configuration and are not runnable until Employee Config saves both `runtime.modelProvider` and `runtime.modelId`.

Save, reload, and runtime start must not silently fall back to a PI default model. If an employee has no saved runtime model, runtime start/reload is blocked with `configure-runtime-model-first`. If the saved model is no longer available in the local PI registry, the runtime also fails with setup guidance so the operator can refresh PI and save an available model.

The Employees UI should treat reload as an automatic post-save effect for employee configuration and employee-private skill edits. The operator should not need to press a separate Reload button after ordinary edits. Manual runtime reload may exist as a secondary troubleshooting control, but it should not be a primary page action.

## Data Boundary

Company is the tenant boundary. Employee ids are current internal selectors for runtime-capable members and are unique within a Company, not globally. Employee Config must resolve an explicit `companyId` before reading or writing member runtime truth. The selector classification is documented in [Member Identity Model](member-identity-model.md).

New runtime-capable employee creation should derive `employeeId` from the display name when the operator does not provide an explicit id. The API and recruitment service must still enforce uniqueness within the Company and reject invalid ids when an override is supplied.

Structured Employee Config truth lives in PostgreSQL:

- `company_members`
- `member_runtime_profiles`

## Runtime lifecycle

Employee administration controls a member's AI runtime capability without deleting the member. The supported lifecycle is:

1. `active`: the employee can receive new Chat turns and Task runs.
2. `inactive`: new execution is rejected explicitly, while identity, configuration, conversations, Tasks, Sessions, traces, and audit history remain readable.
3. Reactivation returns the same runtime profile to `active`; it does not create a replacement employee.

Saving profile, model, prompt, or resource settings must not implicitly reactivate an inactive employee. Deactivate and reactivate are explicit operator actions.

The Employees workspace separates runtime-capable members into `Active` and `Inactive` views. Active is the default daily configuration list. Deactivation removes the employee from that list immediately; inactive employees appear only in the Inactive view, where they can be reactivated.

Deactivation also removes the runtime-capable member from active Chat discovery and new Channel-member selection. The backend Channel boundary rejects attempts to add an inactive runtime member even if a stale or forged client submits that member id. Existing history and stored Channel membership evidence are preserved rather than rewritten.

Deactivation is a cross-module runtime stop, not a list filter. TinyOffice cancels active Tasks and WorkRuns owned or assigned to that member, stops Company-scoped runtime sessions for that member, cancels the member's pending Access requests, and revokes unconsumed Access grants. New immediate Work, due schedules, and retry WorkRuns also revalidate the assignee at the Work domain boundary. Reactivation restores discovery and future execution, but it does not revive canceled work or old Access grants.

Employee Config can save and display runtime-capable members with `companyId` plus `employeeId` as the current implementation selector.

Employee workspace files, employee skills, and the fixed employee `AGENTS.md` remain file assets under the Company-scoped employee home. They are not structured company configuration rows.

Employee Config only reads and updates `companies/<companyId>/employees/<employeeId>/AGENTS.md`. This file is the employee's personal long-term guidance and is loaded into that employee's prompt. Its content is not copied into PostgreSQL employee config tables.

The Employees page may list, read, and edit existing employee-private `SKILL.md` files for the selected employee. It does not own the full skill creation workflow. New employee-private skills should initially be created through the company-level `skill-creator` skill or a guided Chat flow, then managed from Employees after the file exists.

Saving an employee-private `SKILL.md` uses the same runtime validation as Skill creation: YAML frontmatter is required, `name` must match the Skill directory id, and `description` must be non-empty. A file that merely exists is not considered runtime-loadable when this contract is invalid.

Structured identity fields such as display name, role, and short responsibility summary remain PostgreSQL truth. Employee-local `AGENTS.md` should contain detailed personal operating guidance, working style, and employee-specific boundaries rather than duplicating those structured identity fields.

The employee workspace path is `companies/<companyId>/employees/<employeeId>/workspace`.

When a Company is created from the default Company Blueprint, Employee Config starts with one Company HR record:

- `employeeId`: derived from the HR display name, with a company-local numeric suffix when needed
- default role: `hr`
- display name: provided by the Company create flow's `hrEmployeeDisplayName`, or fallback `Company HR`
- purpose: initial member setup, not the full HR Agent or natural-language member-draft workflow
- local assets: `companies/<companyId>/employees/<derivedHrEmployeeId>/AGENTS.md`, `skills/`, and `workspace/`
- default skill: `skills/recruit-employee/SKILL.md`, which guides HR through checking existing member names, selecting an available runtime model, confirming a draft, and calling the TinyOffice employee creation API

The Company HR uses the same Company-scoped Prompt Policy and Access boundaries as other runtime-capable members. Its default Access relationship is intentionally narrow: own workspace allowed, repository and other member workspaces require approval, and secrets are denied.

## Boundaries

- Employee Config does not show live runtime status.
- Employee Config does not replace [Employee Status](employee-status.md).
- Employee runtime startup must not silently fall back to a PI default model.
- Employee Config does not own PI provider authentication; it only reads available models from local PI configuration.
- Employee Config does not manage company-level Prompt Blocks; those belong in [Prompt Policy](prompt-policy.md).
- Employee Config does not manage one-turn runtime context; that is inspected through [Sessions](sessions.md).
- Employee Config does not manage sensitive resource access policy.
- Employee Config does not manage Company Skills under `companies/<companyId>/skills`; Company Skill creation and updates remain confirmed Chat capability flows.
- Employee Config does not replace the skill creation workflow; it can manage existing employee-private skills but should not provide a generic skill builder in v1.
- Employee Config does not turn Company HR into an unrestricted administrator.

## Technical Docs

Technical implementation: [Employee Config technical implementation](../technical/employee-config.md).

Related product pages:

- [Employees and Sessions](employees-and-sessions.md)
- [Company Config](company-config.md)
- [Company Storage Boundary](../company-storage-boundary.md)
