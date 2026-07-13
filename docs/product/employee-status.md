# Employee Runtime Summary

Employee Runtime Summary is the narrow Chat context model for runtime-capable members. It is not a separate Status rail page and it is not an employee configuration surface.

The summary exists so the Chat UI can answer small situational questions when a user selects an employee DM: is this employee currently working, blocked, or idle; and what current work item is worth seeing in the right context panel.

## Purpose

- Show lightweight current-work state inside Chat, near the employee being viewed.
- Add a small left-sidebar signal only when an employee has a non-idle runtime state and no unread/mention badge is already taking that space.
- Keep operational details, sessions, and configuration in their own surfaces instead of repeating them in Chat.

## Entrypoints

| Type | Entrypoint | Purpose |
| --- | --- | --- |
| Product UI | Chat direct-message directory context panel | Show the selected employee summary and a compact issue/current-work summary before a concrete DM topic is opened. |
| Product UI | Chat direct-message list badge | Show a compact non-idle status when it does not conflict with unread or mention badges. |
| Product API | `GET /api/companies/:companyId/employees/runtime-summary` | Return the Chat-scoped employee runtime summary. Optional `employeeId` filters to one runtime-capable employee. |

Retired public entrypoints:

- `GET /api/companies/:companyId/employees/status`
- `GET /api/companies/:companyId/employees/:employeeId/self-status`

Those routes were removed because the old Status page and self-status endpoint duplicated Chat, Sessions, Tasks, and Employees responsibilities without a clear user workflow.

## Core Concepts

| Concept | Meaning |
| --- | --- |
| Runtime summary | A small projection derived from runtime/work evidence for Chat context only. |
| Status | One of `needs_approval`, `blocked`, `working`, or `idle`. |
| Current work | A short list of current WorkRun, WorkTask, Session, or Topic items when they are useful in Chat. |
| Issue | A concrete actionable condition that explains a non-idle status and gives the user a next step. Today this is a blocked WorkRun that links to its Task. |
| Counts | Minimal counts that explain why the status exists, not a full diagnostics dashboard. |

## Lifecycle Rules

| Scenario | Chat status | Context panel | User action | Disappears when |
| --- | --- | --- | --- | --- |
| Idle employee with no current work | `idle` | Nothing beyond profile/summary. | None. | Already absent. |
| Running Session or in-progress/queued WorkRun | `working` | `Current work` with compact current item plus any separate blocked-work count. | Usually none in Chat; inspect Sessions or Tasks if needed. | Runtime/WorkRun leaves the active state. |
| Active Task owned by the employee | `working` | `Current work` with the Task. | Open Tasks when task management is needed. | Task is completed, canceled, archived, or no longer active. |
| Blocked WorkRun | `blocked` | `Blocked work` with one concise blocker and `Open task`. | Open the Task and resolve, resume, cancel, or archive through Tasks. | WorkRun is no longer `blocked` or the owning Task is no longer active. |
| Pending foreground Access request | Not projected through Employee Runtime Summary. | The approval card appears in the Chat room that raised it. | Allow once, allow in this conversation, or reject. | Access request is resolved. |
| Failed or interrupted Session | Does not change Chat employee status. | Not shown as attention. | Inspect Sessions only when investigating evidence. | It does not need a Chat dismissal; retention cleanup may eventually remove old evidence. |
| Failed WorkRun without a current actionable blocker | Does not create attention. | Not shown as attention. | Inspect Tasks or Sessions when investigating evidence. | It does not need a Chat dismissal; Task/Work history remains evidence. |

## Boundaries

- Employee Runtime Summary is read-only.
- It does not edit employee configuration, model settings, prompts, skills, presence, or resource defaults.
- It does not show model provider, model id, thinking level, raw event payloads, full transcripts, old console links, or page-shaped filters.
- It does not display long-lived online time such as `Active 42m`; employees can be long-running/resident, so that timer is usually noise.
- A blocked state must not be shown as a generic dead-end label. The direct-message directory context panel should name one concrete blocker and provide its recovery DM or Task entrypoint.
- Current execution takes precedence over old attention: an employee running another Session or WorkRun remains `working` with a blocked-work count instead of being globally pinned to `blocked`.
- Terminal failures are evidence, not Chat attention. Failed or interrupted Sessions and failed WorkRuns must not occupy the employee context panel unless a separate current actionable blocker exists.
- Once a concrete DM topic is open, this summary must not take space from Activity or message-level runtime evidence.
- Missing or incomplete configuration belongs in [Employee Config](employee-config.md), where the user can fix it.
- Session inspection belongs in [Sessions](sessions.md).
- Work queue and WorkRun operation belong in [Tasks](tasks.md).
- Access policy and approval behavior belong in [Access](tool-safety.md) and Chat approval cards, not in this summary.

## Company HR

Company HR can appear as an ordinary runtime-capable member if it has runtime evidence. The summary must not turn HR into a dossier or administrator page. Configuration for the seed belongs in [Employee Config](employee-config.md); creation boundary belongs in [Company Config](company-config.md).

## Technical Docs

Technical implementation: [Employee Runtime Summary technical implementation](../technical/employee-status.md).

Related product pages:

- [Chat](chat.md)
- [Employee Config](employee-config.md)
- [Sessions](sessions.md)
- [Tasks](tasks.md)
