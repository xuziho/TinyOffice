# Agent Reference Repositories

This page records external agent/runtime repositories that TinyOffice can study when designing runtime behavior, tool UX, event streams, Sessions, Trace, and background work.

These repositories are references only. They are not TinyOffice product truth and must not be copied as hidden compatibility paths. TinyOffice product decisions still come from this manual, the current codebase, and explicit GitHub Issues.

Last refreshed: 2026-06-28.

## Reference Priority

Use references in this order:

1. Check the default reference set below.
2. If it does not cover the problem, inspect a mature project that matches the specific product question.
3. Read source code, not only README claims.
4. Translate the useful behavior into TinyOffice-owned product language before implementation.
5. Record why the reference does or does not fit when the decision affects foundation-level infrastructure.

Do not stitch several projects together just to appear comprehensive. Combine references only when one source cannot satisfy the core constraint.

## Default Reference Set

| Repository | Why it is useful | Main design questions |
| --- | --- | --- |
| [earendil-works/pi](https://github.com/earendil-works/pi) | TinyOffice currently runs through the Pi runtime/toolkit family. | Provider adapter, skills/packages, model registry, session continuity, and tool execution boundaries. |
| [liliMozi/openhanako](https://github.com/liliMozi/openhanako) | Pi-based project worth inspecting for practical package/runtime patterns. | How another Pi project organizes runtime extension, prompts, tools, and task-like flows. |
| Hermes Agent | Useful for scheduled jobs, tasks, task runs, claims, heartbeat, stale recovery, and run output files. | How to separate Schedule, Task, and Run without turning every task into ad hoc state. |
| OpenCode-style coding agents | Mature agent product patterns for sessions, tools, and multi-surface execution. | How to show tool progress, session state, and final results without exposing hidden reasoning. |
| Mature chat products | General interaction references only. | Chat layout, room list, message composer, room details, participants, and context panels. Do not copy old carrier ids or plugin entrypoints. |

## How To Use A Reference

When a design question appears, translate it into a TinyOffice product object first:

- Chat / Conversation / Message
- Runtime status / Session / Process Trace
- WorkTask / WorkSchedule / WorkRun
- Access policy / Access request
- Company / Member / runtime-capable member
- Realtime event / projection refresh

Then inspect the reference for behavior, not for names to copy. For example:

- If the reference has `job`, decide whether TinyOffice needs `WorkSchedule`, `WorkTask`, or `WorkRun`.
- If the reference has a thread id, decide whether TinyOffice should use `conversationId`, `chatEntryId`, `roomId`, `sessionId`, `workRunId`, or `processTraceId`.
- If the reference shows a tool card, decide whether TinyOffice should render it in Chat presence, Sessions, Process Trace, or Tasks.

## Current Design Questions

### Process Visibility

TinyOffice should expose structured runtime progress without exposing hidden chain-of-thought.

Useful event classes:

- `turn_received`
- `target_resolved`
- `context_loaded`
- `employee_reply_started`
- `model_text_delta`
- `tool_call_started`
- `tool_call_finished`
- `collaboration_action_emitted`
- `turn_failed`

Bind those events to TinyOffice-owned ids such as `sessionId`, `processTraceId`, `workRunId`, `conversationId`, `messageId`, `chatEntryId`, `roomId`, and `employeeId`. Do not use `rootPostId`, carrier channel ids, or Mattermost thread ids as current product identity.

### Streaming UX

Separate three streams:

1. Text deltas for preview or evidence.
2. Tool/action events for process cards or trace rows.
3. Final collaboration messages for user-readable Chat history.

TinyOffice's priority is a clear process/evidence stream. It should not turn every token into a Chat message.

### Tool Visibility

Tool events should be summarized for people:

- tool name
- safe input preview
- status: started, completed, failed, timed out
- short output or error preview
- redaction for secrets and long payloads

The goal is observability, not exposure of private reasoning or sensitive payloads.

### Task Scheduling

When comparing scheduled-job systems, map concepts carefully:

| Reference concept | TinyOffice concept |
| --- | --- |
| Job trigger / cron | WorkSchedule |
| Task definition / prompt / objective | WorkTask |
| Execution attempt / run | WorkRun |
| Claim / heartbeat / stale recovery | Work dispatch lease and Company Control Plane |
| Output file / summary | WorkRun result, Session evidence, Process Trace evidence |

Only add claim/heartbeat fields where TinyOffice's actual execution model can produce duplicate dispatch, stale running state, or recoverable worker loss.

## External Search Rule

External search can supplement this page, but it should not bypass the default references when the problem is clearly agent/runtime/chat/work related.

If a newer external project is better than a default reference, record why the default reference did not satisfy the current constraint.

## Boundary

Never copy these from reference projects into current TinyOffice product paths:

- carrier-native Team/User/Channel/Post ids
- old plugin routes or root component entrypoints
- hidden compatibility UI
- raw provider-specific session ids as product identity
- README-only architecture claims without source verification

TinyOffice should learn from mature projects, then rebuild the accepted behavior through TinyOffice-owned models, APIs, and PostgreSQL-backed truth.
