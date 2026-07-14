# Prompt Policy

Prompt Policy is the shared prompt template editor for company-level AI call text. It lets an operator edit stable prompt text that TinyOffice uses when assembling model calls.

Scene loading is a runtime contract, not a normal operator workflow. Runtime maps the core scenes to their expected blocks internally: DM loads `dm-scene`, Channel loads `channel-scene`, Intake loads `intake-event`, and WorkRun loads `workrun-scene`.

## Use

- Edit and save the Base System Prompt and Runtime Prompt Template.
- Edit and save the four runtime scene Prompt Blocks: Channel, DM, Intake, and WorkRun.
- Reset any editable template or scene block to the current built-in default text.
- See read-only `Loaded by` metadata when a scene block is part of the runtime scene contract.
- Provide Sessions with block id, content, and hash evidence for the actual runtime prompt.

Runtime values are represented as slots such as `{employeeId}`, `{displayName}`, `{role}`, `{sceneType}`, `{contextBlocks}`, and `{userMessage}`. Prompt Policy does not manage employee-specific `AGENTS.md`, one-turn runtime context values, Access rules for sensitive resources, tool availability, or loaded skills. Existing saved templates that still contain `{promptBlocks}` render that retired user-prompt slot as empty; scene blocks are loaded once through the system-prompt path.

## Current Structure

| Layer | Content |
| --- | --- |
| System Prompt | Member runtime identity, TinyOffice work boundary, core behavior, and the instruction to follow confirmation decisions reported by capabilities and Access. It does not ask the model to invent approval requirements. |
| Employee context | Employee-local `AGENTS.md`, `CLAUDE.md`, and related context loaded by PI resource paths. |
| Runtime Prompt Template | Slot-based wrapper for scene, context blocks, and the scene-appropriate current input. |
| Scene Prompt | Runtime-selected Prompt Blocks for DM, Channel, Intake, or WorkRun. Scene prompts contain the editable collaboration and completion instructions and are loaded once through the system-prompt path. |
| Runtime Context | Explicit runtime-provided context blocks. Topic turns include handoff candidates, Topic summary, and bounded recent raw messages. WorkRun turns include the WorkRun package. DM turns do not inject requester, shell paths, raw room history, or reachable participants as prompt context. |
| Current Message | DM, Intake, and WorkRun place the current message late. Channel/Topic marks the trigger inside its Topic message window, removes any empty standalone-message template label, and does not repeat the same body through either a standalone message slot or a provisional Topic title. |

TinyOffice-owned Chat writes visible replies from normal assistant messages. Prompt Policy may edit scene-level collaboration instructions, but runtime still owns tool availability and code validation. Every Channel/Topic turn must call `handoff_topic_turn` exactly once. Returning the ball to the user is an explicit Handoff to that user's participant id. Intake turns must use `finish_intake_turn`, and WorkRun turns must use `finish_work_turn`; these tools are state actions, not visible message sources. Topic Runtime Context must give the model a `Handoff candidates` list that excludes the current turn holder and includes enough role/responsibility context to choose the next holder without presenting human-vs-AI product categories as collaboration rules. DM Runtime Context must stay empty unless an explicit future product contract adds a named context block.

If a Channel employee produces its visible reply but omits the required Handoff call, runtime performs one same-session state-action repair with only `handoff_topic_turn` available. The repair does not create another visible reply, does not choose a target on the model's behalf, and is not a limit on how many employee-to-employee transfers a Topic may make.

Prompt Policy is where shared company-level prompt template text belongs. Employee-specific responsibilities and personal guidance belong in Employee Config through employee-local instruction files. Access policy is where sensitive resource and dangerous command decisions belong.

System AI title and Topic-summary generation are separate stateless calls. Each call starts an in-memory PI session, disables employee context-file loading, supplies only its capability-specific system instruction plus the current request, and does not inherit Chat, employee, or earlier System AI history.

When an employee session reaches its provider context boundary, TinyOffice compacts it into an employee-continuity summary. The summary preserves goals, decisions, open work, blockers, artifacts, and evidence without assuming that the employee is doing software-development work.

The shadcn Prompt Policy surface is available from the developer-mode `Developer tools` menu at `/prompt`. It exposes full-width editors for Foundation Prompts and Scene Prompt Blocks. Display names are system labels, so operators edit only prompt content. It does not expose a manual scene binding matrix, editable always/scenes workflow, mounted-block outcome panel, resource picker, Title field, or Advanced JSON binding editor. Other `AI Calls` sources such as `Employee Instructions`, live `Runtime Context`, `Tools`, and `Skills` are maintained by their own runtime surfaces or evidence views.

## Data Entries

| Type | Entry | Purpose |
| --- | --- | --- |
| shadcn app | Developer tools menu destination at `/prompt` | Current company-scoped Prompt Policy editor for foundation prompts and runtime scene blocks. |
| Standalone API | `/api/companies/:companyId/prompt-policy` | Read the company-scoped Prompt Policy view model for the standalone frontend. |
| Standalone API | `/api/companies/:companyId/prompt-policy/templates/:templateId` | Save Base System Prompt or Runtime Prompt Template content through the TinyOffice-owned company API. |
| Standalone API | `/api/companies/:companyId/prompt-policy/templates/:templateId/reset` | Reset a foundation template through the TinyOffice-owned company API. |
| Standalone API | `/api/companies/:companyId/prompt-policy/blocks/:blockPath` | Edit a scene Prompt Block through the TinyOffice-owned company API. |
| Standalone API | `/api/companies/:companyId/prompt-policy/blocks/:blockPath/reset` | Reset a scene Prompt Block through the TinyOffice-owned company API. |

## Storage

Current Prompt Policy truth lives in PostgreSQL `prompt_policy_templates` and `prompt_policy_blocks`. The table can contain additional company reusable Prompt Blocks, but the ordinary Prompt Policy UI edits only the Foundation Prompts and the four runtime scene Prompt Blocks. Ordinary Prompt Policy UI does not expose arbitrary scene binding writes. Prompt source files are not runtime truth.
