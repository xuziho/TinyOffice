# Employees and Sessions

A member is the product-facing TinyOffice company subject. Some members are runtime-capable because they have a complete runtime profile; they are persistent TinyOffice identities, not one-off bot replies. A session is the runtime record for one runtime-capable member working in one collaboration surface.

Company is the tenant boundary for members and sessions. Runtime lookups and Operations Surface pages must resolve `companyId` before resolving a member/runtime id.

For the full selector classification and database direction, see [Member Identity Model](member-identity-model.md).

## Product Facts

- Runtime-capable members have stable TinyOffice identity, role, runtime configuration, workspace, and available capabilities.
- Users may belong to multiple Companies; user roles, runtime-member visibility, and resource-policy visibility are scoped to the active Company.
- The same runtime-capable member may work in `channel_thread`, `dm_thread`, `intake_event`, and `work_run_execution`; these surfaces must keep separate context.
- Sessions are continuous conversations and may contain multiple turns. UI and data models must not assume one session has only one input/output pair.
- Structured runtime-capable member configuration lives in PostgreSQL, not Employee Home JSON files.

## Runtime Daemon Boundary

Runtime-capable members are executed through employee runtime daemon ownership. This is an architecture ownership boundary, not a guarantee that the current local runtime uses one OS process per member. The final product architecture treats each runtime-capable member as an isolated worker/daemon responsibility, even when a local development process hosts several daemon objects for convenience.

The Company Control Plane may wake, dispatch, stop, restart, and observe employee daemons. API handlers and frontend requests are entry points into the control plane; they are not the employee runtime identity.

An employee daemon owns:

- the employee identity and runtime configuration
- session continuity for DM, Channel Topic, Intake, and WorkRun scenes
- loaded prompt blocks, tools, skills, and workspace guidance
- execution of runtime state/finalization protocols such as Chat `handoff_topic_turn`, Intake `finish_intake_turn`, and Work `finish_work_turn`
- runtime evidence links to Session and Process Trace

This boundary is a product architecture decision. New runtime work should strengthen daemon ownership and observability rather than replacing it with stateless request-handler execution.

## Employee Capability Sources

| Layer | Source | Meaning |
| --- | --- | --- |
| Base tools | System runtime | General read/write, web fetch/search, and collaboration actions. |
| Company tools | Company/runtime config | Company-level actions such as finding participants, DM, handoff, operating events, and Work actions. |
| Role tools | Runtime-capable member profile/config | Role-specific or project-specific capabilities. |
| Skills / runbooks | Company or employee skill files | Loaded workflow knowledge. Skill source files remain file assets. |
| Workspace resources | Member workspace | Member-local notes, scripts, materials, drafts, and generated files. |

`AI Calls` must display tools and skills separately: tools are callable capabilities; skills/runbooks are loaded knowledge or procedures.

## Employee Home

`companies/<companyId>/employees/<employeeId>/` is for local employee assets inside the active Company:

- `workspace/`
- `skills/`
- workspace-local `AGENTS.md` / `CLAUDE.md`
- PI workspace settings
- employee-generated drafts, reports, and temporary analysis files

Current runtime-capable member config truth lives in PostgreSQL `company_members` plus `member_runtime_profiles`. Employee-local guidance and workspace assets remain file assets under the Company-scoped employee home while filesystem path names still use `employees/<employeeId>`.

Employee Home file assets are preserved as capability/workspace assets. They are not a substitute for Company-scoped runtime truth, and missing Company-scoped rows must not be filled from a global, default, or old root `employees/<employeeId>` directory.

## Session Explorer

Session Explorer lets operators read a session from trigger to output while keeping product-level reading separate from developer debugging evidence.

The detail page uses four main sections:

- `Session Overview`: employee, surface, thread/event/WorkRun, requester, timestamps, model, CWD, turn count, user/employee message counts, model call count, logical tool count, and total session tokens.
- `Conversation Turns`: each turn's user message, employee reply, and per-turn usage.
- `Work Done`: logical tool calls/results and user-relevant collaboration actions.
- `AI Calls`: TinyOffice first-party `promptInputPackage` for each model call, displayed in assembly order: system prompt, prompt blocks, user prompt, active tools, loaded skills, and folded debug evidence.

`Runtime Session Inspector`, `Prompt Snapshot`, `User Prompt History`, `Transcript Files`, `Prompt Assembly`, `Runtime Context`, `Latest Outcome`, `Turn Timeline`, `Usage`, `Runtime Details`, and `Raw Evidence` are not independent main sections. Their useful product facts belong in overview, conversation turns, work done, or AI calls. Raw evidence remains available only as developer debugging data.

## Counting Rules

- `Messages` only counts user-visible `user_message` / `assistant_message`.
- `Tools` counts logical tool calls, not provider lifecycle wrappers.
- `Tokens` comes from `session_records.token_input_total`, `token_output_total`, and `token_cache_total`, and represents whole-session totals.
- Per-turn usage is shown on each conversation turn; model call ids and token attribution tables are debug evidence, not default reading content.
- `Raw Events` is not a main-page metric.

## Runtime Memory

Runtime Memory is generated after employee runtime activity. It is not the same as the product architecture manual's Product Memory.

## Evidence Query

Operators can inspect persisted runtime evidence with the repository-backed Evidence Query CLI. Use it when diagnosing current member runtime state, WorkRun progress, session context, Process Trace, collaboration actions, approvals, grants, intake handling, operating events, or runtime memory.

Evidence queries must be Company-scoped. A query that cannot resolve the active Company should fail explicitly rather than returning data from a hidden singleton Company.

The CLI entry point is:

```bash
node --import tsx src/cli/agentco.ts query member-state <memberId>
```

JSON is the default output. The CLI does not expose raw SQL. Product behavior is documented in [Evidence Query CLI](evidence-query-cli.md).

## Related

- [Employee Config](employee-config.md)
- [Sessions](sessions.md)
- [Company Storage Boundary](../company-storage-boundary.md)
