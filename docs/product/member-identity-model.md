# Member Identity Model

Member is the product-facing company subject in TinyOffice. Bosses, operators, reviewers, editors, and runtime-capable workers are all members. TinyOffice should not present human and AI as separate product identity classes.

## Product Model

| Concept | Product meaning | Current implementation boundary |
| --- | --- | --- |
| Member | A company-scoped identity visible inside one Company. | `company_members` is the identity source of truth. |
| Runtime profile | Complete runtime capability attached to a member. | `member_runtime_profiles`, keyed by `company_id + member_id`. |
| Role / title | The member's company role, such as boss, HR, growth, automation, or quality editor. | Stored once in `company_members.role`. |
| Runtime configuration | Presence, model, thinking level, and filesystem resource defaults for a runtime-capable member. | Stored in `member_runtime_profiles`; model provider and model id are required. |
| Session / work ownership | Which member/runtime owns a session, WorkTask, WorkRun, trace, or message state. | Owned TinyOffice ids such as `memberId`, runtime/session ids, Work ids, and Process Trace ids. |

A company member identity and its runtime capability have separate lifecycles. A runtime-capable member can be `active` or `inactive`; deactivation preserves the member identity, runtime configuration, Chat history, Task ownership, Sessions, and audit evidence, while preventing new AI execution. Reactivation restores execution without rebuilding that history. Permanent member deletion is not part of the normal Employee lifecycle.

A member becomes runtime-capable only by having a complete `member_runtime_profiles` row. That profile has an explicit `active` or `inactive` lifecycle status. Missing runtime profile, missing model configuration, and an inactive profile are distinct conditions and must fail explicitly; none may silently fall back to another employee or runtime.

Mattermost Team/User/profile bindings, `mattermost_login_id`, `mattermostAccount`, and Mattermost account mapping tables are retired from current identity storage and product contracts.

## Directory API Boundary

`GET /api/companies/:companyId/directory` returns a member-first directory. Each item uses `memberId` as the product subject. Runtime capability is derived from whether that member has a complete runtime profile.

`GET /api/companies/:companyId/member-directory` is the AI-callable people-selection directory for recruiting, Channel setup, and collaboration workflows. It also returns member-only entries: runtime-capable members stay `participantKind: "company_member"`, carry `memberId`, and expose runtime capability through `hasRuntimeProfile`; it must not expose `employeeId` as a selector.

Implementation routes and some DTOs may still carry employee naming while the runtime surfaces are being renamed, but product truth is member-first and must not introduce a human-vs-AI discriminator.

## Chat Identity Boundary

Chat, Channel, Message, Chat realtime, and Chat image attachments are member-only product identity surfaces.

Accepted Chat request fields are `actorMemberId`, `viewerMemberId`, `memberId`, Channel member `memberId`, `mentionedMemberIds`, and attachment `ownerMemberId`. Old Chat selector fields such as `actorEmployeeId`, `viewerEmployeeId`, `participantEmployeeIds`, `mentionedEmployeeIds`, and `ownerEmployeeId` must fail explicitly instead of being accepted as aliases.

Runtime execution can still load existing employee-home filesystem paths and broader Session/Work storage can still contain employee-named columns. Those are implementation/storage follow-ups, not Chat product identity. Chat runtime dispatch, active run status, reply streaming, and process trace append events address targets as `targetMemberId`.

## Runtime Action Boundary

AI employee runtime turns carry two different identity axes:

- `actorEmployeeId` identifies the runtime-capable employee process currently executing a PI tool turn. It is runtime evidence and tool execution context.
- `actorMemberId` identifies the TinyOffice company member who owns the product action being written, such as a Channel participant creating or managing a Channel, Work creator/requester, or Operating Log actor.

These values may be the same when the runtime-capable employee is acting on its own behalf. They must not be treated as aliases. A member-owned write must use `actorMemberId` and fail explicitly if the current runtime context cannot supply it. Read-only API requests may omit `actorMemberId`; the concrete write API decides whether member ownership is required.

`targetMemberId` identifies the runtime-capable member being dispatched in a Chat turn. In a Channel handoff, the previous responding employee can become the `actorMemberId` for the next dispatched employee, while the next employee is the `targetMemberId`.

Work execution follows the same member-first boundary. `WorkTask.createdByMemberId`, `WorkTask.ownerMemberId`, `WorkRun.assigneeMemberId`, and Work event `actorMemberId` are member fields. When a runtime-capable member executes an assigned WorkRun, its current runtime selector may still appear in implementation variables named `employee.employeeId`, but the value represents the same runtime-capable member and is written to Work as `actorMemberId`.

Evidence Query CLI uses member-facing filters and commands: `member`, `members`, `member-state`, and `--member`. Session, Process Trace, collaboration action, and memory repositories may still store or accept `employeeId` internally when the field describes the executing runtime-capable member as runtime evidence. That internal runtime evidence name must not leak into the CLI query contract as a member selector.

External Intake follows the same member-first routing boundary. Intake events must use `routing.targetMemberId`; `routing.targetEmployeeId` is retired and must not be reintroduced as an accepted product input.

## Member Storage Boundary

`company_members` remains the identity source of truth, but TinyOffice no longer exposes direct public CRUD routes under `/api/companies/:companyId/members...`.

Current product paths use narrower surfaces:

- `GET /api/companies/:companyId/directory` for frontend member selection.
- `GET /api/companies/:companyId/member-directory` for AI-callable people selection.
- `POST /api/companies/:companyId/employees` for creating a runtime-capable employee/member with runtime assets.
- `/api/companies/:companyId/member-runtime...` for runtime-capable member configuration.

Direct member-only CRUD needs a separate accepted product decision before it returns. Do not keep broad member CRUD only as future potential.

There is no soft-deactivation lifecycle for the underlying member identity. A member exists or is deleted. The attached runtime profile has a separate active/inactive lifecycle through Member Runtime configuration.

An inactive runtime profile is excluded from active Chat discovery, new DM targets, AI-callable member selection, and new Channel membership. Existing persisted Chat messages, Channel membership records, Tasks, Sessions, traces, and audit evidence remain stored; deactivation must not rewrite or delete history. Reactivation restores the same member to active discovery and selection.

Historical product projections must keep identity and execution eligibility separate. Channel participant rows, Task owners, and Session summaries resolve the current display name, avatar, and role from `company_members`, even when the attached runtime profile is inactive. Whether the member may be selected, mentioned, added to a Channel, retried, assigned new Work, or dispatched is derived independently from an active complete `member_runtime_profiles` row. Frontends must not join historical rows back through the active-only directory, because doing so turns stable member ids into visible fallback names and avatars after deactivation.

## Employee Runtime And Chat Summary

Current API route names still include `employee` in several places:

- `/api/companies/:companyId/member-runtime`
- `/api/companies/:companyId/member-runtime/members/:memberId`
- `/api/companies/:companyId/employees/runtime-summary`

Read these as runtime-capable member configuration or Chat runtime summary until the routes are renamed. They must resolve back to `company_members.member_id` plus `member_runtime_profiles`.

The old public Status and self-status routes are retired. The current shadcn Chat surface consumes only the narrow Employee Runtime Summary; employee configuration remains in Employee Config, and session/work inspection remains in Sessions and Tasks. When future runtime pages are rebuilt, do not preserve retired route/parameter shapes as product destinations. Rename visible API/client surfaces to member-first terms such as member runtime, member status, `memberId`, and `memberIdFilter`, unless a separate accepted architecture decision explicitly keeps an employee-only runtime surface.

## Verification

```powershell
node --import tsx --test tests/runtime/postgres-schema.test.ts tests/runtime/company-member-directory.test.ts tests/runtime/company-config-employees.test.ts
node --import tsx --test tests/collaboration/company-directory-api-routes.test.ts apps/tinyoffice-web-shadcn/src/chat/chatViewModel.test.ts
npm run check
npm run docs:build
```
