# Skills / Runbooks

Skills and runbooks are loadable sources of employee capability and workflow knowledge.

## Purpose

- Let employees load stable capability instructions when a conversation starts.
- Preserve company-level and employee-level workflows as reusable materials.
- Let session evidence record loaded skills, paths, and related tool evidence for later review in Sessions.

## Entrypoints

| Type | Path or entry | Purpose |
| --- | --- | --- |
| Company skills | `companies/<companyId>/skills/**/SKILL.md` | Workflow knowledge shared by runtime-capable employees in exactly one Company. |
| Employee skills | `companies/<companyId>/employees/<employeeId>/skills/**/SKILL.md` | Capabilities private to one employee in one Company. |
| Evidence review | [Sessions](sessions.md) | View session metadata, loaded skills, tool evidence, and AI input packages. |

## Core Concepts

| Concept | Meaning |
| --- | --- |
| Employee Skill | A PI skill loaded when an employee session starts. |
| Runbook | Stable workflow guidance for a recurring kind of work. |
| Capability evidence | Loaded or observed capability evidence recorded in session data. |

## Capabilities

| Capability | Meaning |
| --- | --- |
| Company Skill | Stored under the current Company home and loaded only for that Company's employees. |
| Employee-level capability | Stored under the Company-scoped employee home. |
| Runtime evidence | Sessions show session metadata, skill paths, loaded skills, and related tool records. |

TinyOffice system operations such as Channel creation, Work creation, and Skill creation are system capabilities in the capability registry. They are not user-managed system Skills and are not copied into each Company. User-managed Skills exist only at Company and Employee scope.

## Boundaries

- Skills / Runbooks do not replace Employee Config.
- Employee Config / Employees may manage existing employee-private `SKILL.md` files for one runtime-capable employee.
- Manage / Company Skills lists and edits existing Company Skills, then reloads affected active employee runtimes. New Company Skills still begin in Chat and require confirmation.
- New Skill creation is Chat-guided and finalized through `skill.create`; updates inspect the existing package and use `skill.update` after confirmation.
- Operators describe reusable work in normal business language; they are not expected to name a Capability, scope field, package path, or tool. Requests for a method that should remain available in future executions or to other employees must be treated as Skill-lifecycle intent before ordinary workspace documents are written. A Markdown file in one employee workspace is not company-wide runtime knowledge.
- TinyOffice has no user-managed system Skill scope. Company Skills cannot cross Company boundaries, and Employee Skills affect only their target member.
- Skills / Runbooks do not provide an employee-level checkbox configuration UI.
- Observed tool calls are not the same thing as complete loaded tool policy.

## Technical Docs

Related runtime evidence and session data are documented in [Sessions technical implementation](../technical/sessions.md).
