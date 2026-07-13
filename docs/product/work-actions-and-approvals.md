# Work Actions And Access Boundaries

This page defines the boundary between normal employee work, WorkRun state, and Access-controlled resources.

## Current Rule

TinyOffice should not try to hard-code every possible AI business action.

Normal employee work is guided by role, prompt, scene context, and available tools. Access only controls low-level sensitive resources and high-risk operations.

## WorkRun Results

`finish_work_turn` remains the structured way for an employee to report WorkRun progress.

| Field | Meaning |
| --- | --- |
| `status` | `in_progress`, `complete`, `blocked`, `failed`, or `canceled`. A need to change assignee is a blocker until WorkRun reassignment exists. |
| `summary` | Short user/audit-facing summary. |
| `evidence` | Required when complete. |
| `blockerMessage` | Required when blocked. |

`finish_work_turn` does not expose approval fields and does not require the employee to classify a blocker. Sensitive-resource Access requests are created by the tool/access layer instead.

## Foreground Collaboration Turns

TinyOffice Chat DM, Channel/Topic, and intake turns use formal final-output tools to hand off, record events, or reply.

Sensitive Access comes from the tool layer when a concrete resource or command is touched; the WorkRun result contract cannot create an approval.

## Access Layer

Access decisions are intentionally narrow:

```text
tool operation + resource + context -> allow / ask / deny
```

Examples:

- `file.read` on `.env` -> ask or deny
- `file.write` on runtime config -> ask or deny
- `shell.exec` with destructive command -> deny
- ordinary Channel/Topic collaboration setup -> allow by default unless it touches a protected resource

Approved Access requests create scoped grants. Foreground cards should generally use one-time grants so the employee can retry the blocked access once through the original tool path.

## Not In Scope

TinyOffice does not currently maintain a giant permission matrix for all business actions.

Do not treat Access as:

- an employee-level tool marketplace
- a static list of every possible AI intent
- a hard gate for normal role responsibilities
- a replacement for the employee's final scene reply
- a Runtime-side business continuation executor

## Verification

Use targeted tests for the affected layer:

```powershell
node --import tsx --test tests/architecture/access-boundary-hard-cut.test.ts tests/work/work-execution-service.test.ts
```
