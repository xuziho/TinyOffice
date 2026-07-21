# Process Trace

Process Trace is runtime evidence for how a member session or WorkRun was handled. It records important execution steps, tool calls, errors, and completion signals so a person can inspect what happened without turning the main Chat message stream into a debug log.

## Purpose

- Show key runtime processing steps.
- Keep tool calls, errors, and completion evidence available for review.
- Let Chat, Sessions, and Tasks link to the relevant evidence without pretending trace events are normal chat replies.

## Product Placement

| Surface | Role |
| --- | --- |
| Chat message stream | Shows human and employee message bodies only. Runtime trace events do not create standalone Chat messages and message headers do not own trace navigation. |
| Chat Context | Keeps a stable Activity dock in the right panel. Activity is a backend projection of high-signal Process Trace evidence. Each row can expand raw trace events when inspection is needed. |
| Sessions | Shows per-turn Activity, prompt/context input, output message, and raw evidence details. |
| Tasks | Shows WorkRun-related trace timeline and evidence links. |
| Runtime API | Allows tools and maintenance views to query trace events. |

## Core Concepts

| Concept | Meaning |
| --- | --- |
| Process Trace | Runtime execution evidence for a session, turn, or WorkRun. |
| Trace event | One processing step, such as received, tool call, blocked, failed, or completed. |
| Session trace | Evidence linked to a member runtime session. |
| WorkRun trace | Evidence linked to a WorkRun execution. |

## Pi Runtime Projection

TinyOffice uses Pi Agent as the runtime foundation. Process Trace remains the raw evidence store. Product surfaces show Activity: a small, generic projection of high-signal trace evidence plus expandable raw events.

- Pi `thinking_start`, `thinking_delta`, and `thinking_end` style provider details are grouped into a logical Activity row when persisted evidence carries useful content.
- High-frequency deltas are not displayed as raw rows. Activity keeps high-signal rows such as run start, thinking, tool call, tool result, run completion, and failure.
- Tool call lifecycle events are projected as tool call and tool result Activity rows.
- Final chat replies remain normal Chat messages. Process Trace explains how the reply was produced; it is not the reply body.
- If a provider does not expose real thinking text, the trace shows truthful lifecycle/tool activity only. TinyOffice must not fake reasoning text.

## Chat Experience

Chat keeps runtime trace out of the message stream:

- After the user sends a message and a runtime employee starts working, Chat publishes the backend-owned Activity projection immediately while Process Trace evidence is written in bounded background batches.
- Chat Context keeps the Activity area stable so room details and participants do not jump when trace events start.
- Trace events and Activity rows do not occupy the message stream.
- When the employee reply body starts streaming, the message stream shows the reply text directly.
- Activity remains in the Context rail and can be expanded to inspect evidence for the selected run or reply. A selected source-message query must keep the full lifecycle for that run, including completion or failure, and must not mix in other runs from the same room.
- Reopening a concrete Chat room selects the latest employee reply with Activity evidence by default. Manual Activity selection on a message switches the Context rail to that specific run.
- Raw provider delta spam must be grouped before it reaches the product surface.
- Process Trace persistence is not a prerequisite for provider invocation, text streaming, or live Activity. The durable snapshot remains the history and reconnect authority.

## Boundary

- Process Trace is not the employee's final chat reply.
- Process Trace is not a replacement for the Sessions page.
- Chat should expose compact room Activity in Context; detailed trace reading can also belong in Sessions, Tasks, or a dedicated runtime evidence view.
- User-visible Chat messages should contain normal conversation replies, not raw runtime lifecycle events.
- User Messages, final employee Messages, terminal Run/Session state, permissions, and real tool side effects are durable business facts. They are never downgraded to best-effort Process Trace evidence.

## Technical Implementation

See [Approval / Process Trace Technical Implementation](../technical/approval-trace.md) and [Runtime event durability](../technical/runtime-event-durability.md).

Related product pages:

- [Sessions](sessions.md)
- [Tasks](tasks.md)
