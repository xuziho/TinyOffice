# Company Capability Registry

TinyOffice keeps a structured system-level capability registry at
`src/runtime/capabilities/capability-registry.ts`.

Despite this document's historical file name, the registry is not per-company
runtime data. It documents TinyOffice system capabilities that AI employee
skills may discover, describe, and call. Company blueprints do not copy it into
each company instance.

AI employees use three runtime tools:

- `tinyoffice_capability_list` to discover capability ids.
- `tinyoffice_capability_describe` to inspect one capability's input schema,
  output schema, scenes, effect, and confirmation policy.
- `tinyoffice_capability_call` to execute a registered capability with
  `capabilityId`, `input`, and optional `confirmation`.

## Maintenance Rules

- Add every AI-callable TinyOffice capability to
  `capabilityRegistry.capabilities` before a skill depends on it.
- Keep one source of truth: do not duplicate the full capability registry in Markdown.
- Each entry must include an id, product category, title, description, operation effect,
  confirmation policy, allowed runtime scenes, use case, input schema, output
  schema, and notes.
- Use stable dot-separated ids such as `employee.recruit`,
  `company.member.directory.list`, or `chat.channel.create`.
- Concrete employee skills should copy the specific capability ids and input
  shape they need, rather than asking employees to look up the registry during
  normal task execution.
- Concrete employee skills should name `tinyoffice_capability_call` directly
  when instructing an employee to execute a TinyOffice capability.
- Chat-guided Skill creation uses the registry's `skill.list`, `skill.describe`,
  `skill.create`, and `skill.update` contracts. System operations are not copied
  into user-managed system Skills.
- AI-callable Channel creation takes participant selectors only
  (`members[].memberId`). Display names, business roles, runtime capability, and actor
  ownership are system-derived from runtime context and Company directory data.

## Product Categories

Capability categories are product-level groupings for discovery and future
expansion:

- `member`: company members and runtime-capable employee setup.
- `chat`: channels, topics, and collaboration surfaces.
- `work`: formal Tasks, Work, schedules, and run orchestration.
- `runtime`: runtime models and execution environment discovery.
- `governance`: access, approval, and policy-facing capabilities.
- `system`: system diagnostics and platform maintenance capabilities.

## Current Scope

The registry currently covers these categories and capabilities:

- `member`: `company.member.directory.list`, `member.profile.describe`, `employee.recruit`
- `chat`: `chat.channel.create`
- `work`: `work.create`, `work.list`, `work.describe`, `work.cancel`, `work.retry`, `work.archive`, `work.restore`, `schedule.pause`, `schedule.resume`, `schedule.cancel`
- `runtime`: `runtime.models.list`

`member.profile.describe` is a read-only collaboration profile lookup. It is
for task assignment, channel planning, and deciding whether a member can receive
runtime work. It does not expose employee resource policy or raw runtime model
configuration; those remain on the employee configuration surface.

`work.create` is the AI-callable capability for turning confirmed DM/Channel
discussion into formal Work. DM/Channel use requires operator confirmation
before the capability call. Intake-created Work remains governed by the intake
scene contract and explicit employee guidance.

`work.list` and `work.describe` are read-only AI-facing Work inspection
capabilities. `work.list` defaults to `scope: "mine"` so an employee sees Work
they own, are assigned to, or that belongs to the current conversation context.
Use `scope: "company"` only when the operator asks for company-wide Work.
`work.describe` expands one `workTaskId` into schedules, runs, attention state,
and optional latest run events.

The Work lifecycle capabilities require explicit operator confirmation. They let
AI employees close the conversational loop instead of sending the operator to a
manual creation or recovery form: retry a failed run, cancel active Work,
archive or restore inactive Work, and pause, resume, or permanently cancel a
schedule.

Future capability additions should extend the same TypeScript registry and add
focused tests for the new entries.
