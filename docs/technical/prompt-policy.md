# Prompt Policy Technical Implementation

This page records the implementation boundary for Prompt Policy. Product behavior is documented in [Prompt Policy](../product/prompt-policy.md).

## Modules

| Module | Responsibility |
| --- | --- |
| `src/runtime/company-config/prompt-blocks-admin.ts` | Prompt Policy view model, full-width template editor HTML, template/block save and reset, and read-only loaded-by metadata. |
| `src/runtime/provider/natural-language-responder.ts` | Applies scene prompt instructions to runtime provider calls. |
| `src/runtime/prompting/prompt-compiler.ts` | Renders the configurable Runtime Prompt Template slots. |
| `src/runtime/pi` | Assembles runtime session input and records prompt evidence. |

## Assembly Order

Runtime model input is assembled in this order:

1. Base System Prompt: employee identity, TinyOffice work boundary, core behavior, and Access boundary.
2. Employee context from PI resource paths, such as employee-local `AGENTS.md` / `CLAUDE.md`.
3. Prompt Policy block for the current runtime scene.
4. Runtime Prompt Template slots: scene type, Prompt Policy blocks, Runtime Context blocks, and Current Message.

Scene Prompt Blocks contain the editable collaboration and completion instructions for their scene. Runtime code still controls tool availability and validates required state actions. Prompt Policy blocks are rendered into each runtime prompt before context and the current message, even if a custom Runtime Prompt Template omits `{promptBlocks}`. The current message is placed last to reduce prompt-cache churn.

## Runtime Binding

Prompt Policy template editing is separate from scene binding. The ordinary Prompt Policy page does not POST arbitrary `always` or `scenes` bindings. Runtime uses the internal default scene mapping when a scene has no configured binding:

| Scene | Default block |
| --- | --- |
| `dm_thread` | `dm-scene` |
| `channel_thread` | `channel-scene` |
| `intake_event` | `intake-event` |
| `work_run_execution` | `workrun-scene` |

Model visible output expresses only the user-facing result of the current turn. Required state actions are handled by scene-specific tools and validated by runtime code.

- Channel: model writes the visible assistant reply as normal assistant text and calls `handoff_topic_turn` exactly once during the same turn with `toId`. Runtime uses the persisted reply and current turn-bound Topic to record Handoff.
- WorkRun: model calls `finish_work_turn` with `status`, `summary`, `evidence`, `blockerMessage`, and related result fields. Runtime uses the session-bound WorkRun id.
- Intake: model calls `finish_intake_turn` with the intake outcome.
- DM: model writes visible assistant text directly. Sensitive-resource requests come from the Access layer, not broad final-output approvals.

## Storage And Reset

Foundation templates live in `prompt_policy_templates`:

- `base-system-prompt`
- `runtime-prompt-template`

Scene blocks continue to live in `prompt_policy_blocks`:

- `channel-scene`
- `dm-scene`
- `intake-event`
- `workrun-scene`

`prompt_policy_blocks` may also contain operator-created reusable blocks. The view model keeps those rows available for validation, mounting, and prompt evidence, while the ordinary Prompt Policy UI filters its editor surface to the four runtime scene blocks above.

Reset writes the current built-in default text back to the relevant row. It does not clear content and does not change scene bindings.

## Verification

```powershell
npm run check
node --import tsx --import ./tests/setup-runtime-test-env.ts --test --test-concurrency=1 tests/runtime/company-config-prompt-blocks.test.ts tests/runtime/prompt-compiler.test.ts tests/runtime/persistent-pi-employee-agent.test.ts tests/runtime/postgres-schema.test.ts
```
