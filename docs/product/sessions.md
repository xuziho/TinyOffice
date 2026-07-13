# Sessions

Sessions is the operator evidence console for employee conversation records. It is a backstage inspection surface, not a foreground collaboration surface like Chat. It answers: in one collaboration surface, around one runtime session, what triggered the employee turn, what input package was sent toward AI, what work happened, what output was posted, and what usage was consumed.

The default session list speaks in product outcomes: an external input was processed, a background Task was created, a Task completed, or a Task needs input. Internal ids and runtime object names remain available in detail/debug evidence, but do not lead the human-facing preview text.

## Purpose

- Inspect an employee session by status, trigger, prompt input, context input, runtime activity, output, usage, and model/runtime metadata.
- Read multi-turn sessions by runtime turn instead of treating the whole session as one input/output pair.
- Keep everyday reading separate from low-level debug evidence. Raw event counts must not become a main-page KPI.
- Favor high information density, compact tables, inline evidence blocks, and folded diagnostic details over Chat-like spacing or conversational presentation.

## Entry Points

| Type | Entry | Purpose |
| --- | --- | --- |
| shadcn app | `/sessions` | Backstage evidence console for runtime sessions. |
| Sessions API | `/api/companies/:companyId/sessions/view-model` | Read the company-scoped Sessions view model. |
| Data | `session_records` / `session_events` / trace tables | Store session records, visible events, prompt input packages, trace, and collaboration actions. |

## Page Layout

The Sessions page is a two-column evidence console:

1. `Session Index`: employee filter, search, and compact runtime session list.
2. `Session Detail`: selected runtime session evidence.

The session list is a triage surface, not a raw database table. It should show the smallest set of fields needed to choose the next session:

- The page header names the current list scope, such as `Runtime sessions` or `Alex sessions`; list rows do not repeat invariant scope facts.
- When an employee filter is active, rows do not repeat the same employee name or role. The employee column appears only in mixed `All sessions` lists where it differentiates rows.
- The scene column appears only when the visible rows contain more than one scene type.
- Runtime ids, model call ids, hashes, token usage, and other diagnostic fields do not appear in the default list rows. They belong in the selected session detail or folded debug evidence.
- Row preview should focus on the latest employee output preview plus last activity time. If no output has been recorded yet, it may fall back to the trigger preview.

The detail view includes an explicit `Back to session list` action. Chat-origin runtime sessions also expose an `Open in Chat` action that returns to the related DM or channel topic. The detail body owns the important runtime metadata and evidence counts; there is no persistent right-side inspector for these facts.

The detail body starts with compact summary blocks: `Runtime identity`, `Runtime metadata`, and `Evidence counts`. It then has one primary evidence section: `Runtime turns`. Each turn should read like an operations console, with compact metadata and evidence blocks rather than a Chat-style message room:

1. `Trigger message`: the Chat/runtime event that woke this employee turn. In a channel handoff, this can be another employee's prior message. It must not be labeled `User Message` unless the source is explicitly human-authored.
2. `Prompt input`: the prompt-facing parts of the `promptInputPackage` recorded by TinyOffice for the model call, displayed as a source-by-source prompt assembly view.
3. `Context input`: runtime-created scene/requester/participant context plus context blocks such as recent Chat history.
4. `Tools and skills`: callable tools and loaded skills sent toward the model for that turn.
5. `Activity`: high-signal runtime activity projected from trace evidence for that runtime turn. It collapses repeated provider deltas into one readable activity row, can show the concrete recorded thinking summary, and omits low-value stream fragments. Final replies belong in `Output message`, not duplicated inside Activity.
6. `Output message`: the employee-visible reply posted back into TinyOffice.

`Latest Outcome`, `Turn Timeline`, `Conversation Turns`, `Work Done`, `Prompt Inputs`, `Prompt Assembly`, `Runtime Context`, `Runtime Details`, and `Raw Evidence` are not current product section names. The latest reply belongs to its runtime turn; model input belongs in the turn's `Prompt input` / `Context input`; raw evidence remains in underlying storage and developer debugging paths, not in the main page.

## Boundaries

- Header `Tokens` is the total session `in / out / cache`, not the latest reply usage.
- Per-turn token usage belongs inside `Runtime turns` to avoid repeating the same facts and exposing model call ids in the default reading path.
- `Tools` counts logical tool calls, not `tool_execution_start`, `tool_execution_end`, `message_start`, `message_end`, or other wrappers.
- `Prompt input` / `Context input` read `session_events.kind = "prompt_input_package"`. TinyOffice writes this event per employee reply, scoped by turn/model call.
- `promptInputPackage` is TinyOffice's first-party record of the input package handed to PI transport. It is not a raw provider JSON payload and does not depend on PI `prompt-snapshot.json`.
- The readable package is grouped by meaning, not by raw parameter shape:
  1. `System Prompt`
  2. `Runtime Prompt`
  3. `Prompt Blocks`
  4. `Employee Instructions`
  5. `Runtime Context`
  6. `Context Blocks`
  7. `Tools`
  8. `Skills`
  9. folded `Diagnostics`
- The trigger message belongs to the runtime turn header/body. It is not duplicated inside the prompt input facts, because in channel handoff it may be another employee's message rather than a human-authored user message.
- Recent Chat history belongs in `Context Blocks`. The product UI must expose those blocks directly when present and must not duplicate them as separate user-authored conversation turns.
- Scene Prompt Blocks are the visible source for scene collaboration and completion instructions. Required state actions are validated by runtime code and shown through tools, action ledger, and trace evidence rather than a separate prompt source.
- `Runtime Context` is the runtime-created scene/requester/participant context. `Context Blocks` are separate scene, work, intake, or conversation context blocks supplied to the turn.
- `Employee Instructions` shows captured first-party employee instruction file snapshots such as employee-home or workspace `AGENTS.md` / `CLAUDE.md` when recorded. Older sessions that predate this capture show an explicit not-recorded boundary.
- Prompt hashes, stable prefix length, and model call ids are debug evidence. They remain available behind folded debug details, not in the default reading path.
- `Raw Events` and raw evidence are developer debugging data. The main Sessions page does not show a `Raw Evidence` section or raw event counts.
- Session evidence links prefer TinyOffice-owned ids: `sessionId`, `workRunId`, and `processTraceId`.
- Realtime events trigger snapshot refresh; HTTP view-model/snapshot data remains authoritative.
- Session rows remain readable after an employee runtime is deactivated. Their display name and role are projected from the current `company_members` identity joined through the preserved runtime profile; lifecycle status governs future execution, not historical evidence visibility.

## Session Evidence Contract

The Sessions product surface shows runtime sessions, not every low-level record that mentions a session.

- `runtime-session-*` records are product-visible employee runtime sessions. They are the primary records for the Sessions list and detail page.
- `tinyoffice-chat-session:*` records are Chat dispatch intent evidence. They prove that Chat decided to wake an employee for a message, but they are not product-visible Session rows.
- `sessionKey` identifies scene continuity across a DM, channel topic, intake event, or work run. It is not the user-facing Session id.
- `chatReturnTarget` is the product-visible Chat return target for Chat-origin runtime sessions. Runtime projection derives it from `sessionKey` and exposes `{ surface, conversationId }` to the frontend. The frontend must use this explicit field rather than parsing `sessionKey`.
- `processTraceId` identifies execution trace evidence. It can be linked from a Session detail page, but it is not the Session itself.
- Chat Session entry points prefer the persisted runtime evidence `sessionRecordId`. If runtime evidence is not available yet, Chat shows the run/trace state instead of inventing a normal Session detail page from dispatch evidence.
- The Sessions API must project product-visible sessions before the frontend renders them. The frontend should not hide dispatch intent records with local UI filtering.
- Dispatch intent records and raw runtime events remain available to developer diagnostics and evidence-query paths, but they do not appear in the default Sessions list.

## Implementation Map

- `src/runtime/pi/session-explorer-loader.ts` loads database-backed index/detail/view-model data.
- `src/runtime/pi/session-explorer-projection.ts` projects runtime facts into overview, runtime turns, prompt/context input facts, Activity, output messages, usage facts, and developer-only raw evidence facts.
- `src/runtime/pi/session-explorer-projection-summary.ts` projects list/detail summary facts, including `chatReturnTarget` for Chat-origin runtime sessions.
- `src/runtime/pi/session-explorer-view-model.ts` owns the frontend section contract.
- `apps/tinyoffice-web-shadcn/src/sessions/SessionsPage.tsx` consumes the company-scoped session view-model API and presents the shadcn Sessions evidence console.
- `src/runtime/realtime/pi-natural-language-responder.ts` persists runtime sessions, token totals, and per-turn prompt input package events.

## Verification

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test --test-concurrency=1 tests/runtime/session-explorer.test.ts
node --import tsx --test apps/tinyoffice-web-shadcn/src/sessions/sessionExplorerModel.test.ts
npm run check:tinyoffice-web-shadcn
```

Related product page: [Employees and Sessions](employees-and-sessions.md).
