# Collaboration Tools And Runtime State Guidance

TinyOffice employees communicate in natural language. Chat visible replies come from normal assistant messages; scene tools are used only when Runtime needs structured state that cannot be inferred safely from text.

## Model-Visible Tools

| Tool | Scene |
| --- | --- |
| `handoff_topic_turn` | Channel Topic state action that selects the next owner by `toId`. |
| `finish_intake_turn` | Formal result for intake-event handling. |
| `finish_work_turn` | Formal result for WorkRun execution. |
| `recall_memory` | Read-only memory recall; does not change routing or Work state. |

Chat DM has no final-output tool. Chat Channel/Topic messages are assistant replies plus, when the turn is in a Channel Topic, `handoff_topic_turn.toId` for the next owner. Work creation, Operating Log entries, and WorkRun progress are handled through scene tools, governance services, and process trace. They are not exposed as scattered one-off model tools.

When a confirmed DM/Channel discussion should become background Work, employees use the registered `work.create` TinyOffice capability through `tinyoffice_capability_call`. This creates `WorkTask`, and when appropriate `WorkSchedule` or a queued `WorkRun`, but it does not replace the WorkRun execution result contract.

## Access Boundary

Access requests are not a normal final-result outcome for business work.

If an employee touches a sensitive file, credential, runtime config, or high-risk command, the tool/access layer may create an Access request card. If approved, the original employee/session retries the original tool path and then finishes the scene normally.

Retired final-output approval fields are rejected. Runtime does not create broad business approvals from scene results.

## WorkRun State

WorkRun state is advanced only through `finish_work_turn`.

When a WorkRun is blocked, Runtime records the blocker. Sensitive-resource requests belong to Access, not the WorkRun final-result contract.
