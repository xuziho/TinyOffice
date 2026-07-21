# Sessions Technical Implementation

This page records the implementation boundary for Session Explorer. Product intent is in [Sessions](../product/sessions.md).

## Modules

| Module | Responsibility |
| --- | --- |
| `src/runtime/pi/session-explorer-loader.ts` | Loads session list/detail/view-model data from runtime storage. |
| `src/runtime/pi/session-explorer-projection.ts` | Projects runtime records, events, process trace, and collaboration actions into page-level facts. |
| `src/runtime/pi/session-explorer-types.ts` | Shared index/detail contract types. |
| `src/runtime/pi/session-explorer-view-model.ts` | Owns the frontend JSON contract, routes, filters, selected session, and section metadata. |
| `apps/tinyoffice-web-shadcn/src/sessions/SessionsPage.tsx` | Current shadcn Sessions evidence console. Reads the company-scoped session view-model, lists runtime sessions in a compact table, opens detail evidence, and uses explicit Chat return targets for Chat-origin sessions. |
| `src/runtime/provider/natural-language-responder.ts` | Persists runtime session snapshots, authoritative final usage totals, and per-turn prompt input packages. |
| TinyOffice runtime WebSocket publisher | Broadcasts `session.updated` / `session.completed` runtime events after persistence. |

The retired native Session Explorer HTML renderer and client script are not current preview or product entrypoints.

## Data Sources

| Data | Source |
| --- | --- |
| Session record | `session_records` |
| Session events | `session_events` |
| Prompt input package | `session_events.kind = "prompt_input_package"` |
| Process trace | `process_trace_events` |
| Collaboration actions | `collaboration_action_events` |
| Runtime metadata | `session_records.metadata_json` |

## Detail Contract

Current section contract. The backend section ids name product-level evidence groups. The current shadcn UI renders the selected session as compact overview blocks followed by runtime turns.

| Section | Default | Purpose |
| --- | --- | --- |
| `session-overview` | open | High-signal session identity and totals. |
| `runtime-turns` | open | Trigger message, prompt/context input, Activity, output message, and per-turn usage grouped by runtime turn. |
| `evidence-package` | open | Lower-level evidence available to the detail projection: prompt input packages, process trace, collaboration actions, transcript files, and folded debug evidence. |

Deprecated section names such as `session-header`, `session-outcome`, `conversation-turns`, `work-done`, `ai-calls`, `turn-timeline`, `prompt-assembly`, `runtime-context`, `runtime-details`, and `raw-evidence` must not be reintroduced as current main-page UI contract names.

The current shadcn UI uses a two-column console layout: a session index column and a main list/detail column. It does not keep a persistent right inspector. Detail-only facts such as runtime metadata and evidence counts are rendered inside the detail body so the page behaves like a backstage evidence console rather than a Chat room clone.

Session detail can show these navigation actions:

- `Back to session list` clears the selected runtime session while keeping the employee filter.
- A source return action replaces `Back to session list` when the Session was opened from another TinyOffice surface through shared navigation state. Direct URL opens do not invent this button.
- `Open related chat` is shown only when the runtime projection supplies a `chatReturnTarget` and it is not the same Chat target as the source return action.

The session list presentation is derived in `apps/tinyoffice-web-shadcn/src/sessions/sessionExplorerModel.ts` rather than hard-coded in JSX. The list hides columns whose values are invariant for the current filter:

- `Employee` is hidden when an employee filter is active.
- `Scene` is hidden unless the visible rows include multiple scene labels.
- Usage totals and runtime ids are not list columns; they are detail evidence.

## Projection Rules

- If visible events carry `turnId` or `modelCallId`, runtime turns and message counts use those structured events and ignore unstructured legacy visible events in the same session.
- If no structured turn boundary exists, the projection can build a best-effort runtime turn from the persisted trigger and following employee reply. The product label is still `Trigger message`, not `User message`, because channel handoff can wake an employee from another employee's prior message.
- `Tools` counts logical tool calls from deduped process trace, not lifecycle wrappers.
- `Activity` is the product-facing projection for runtime turns. It is built from an allowlist of high-signal trace kinds, collapses repeated logical activity rows, shows the recorded reasoning summary when one exists, and does not expose raw text deltas as page content. Final reply traces are excluded because the reply is already shown as `Output message`.
- Raw evidence remains preserved in runtime storage and developer-only facts, but it is not a main-page section and raw event counts are not shown in the primary Sessions UI.
- `chatReturnTarget` is projected by the runtime summary layer from `sessionKey` for Chat-origin runtime sessions. Supported Chat scene keys map to `{ surface: "direct" | "channel", conversationId }`. The frontend consumes the explicit projected field and must not parse `sessionKey` locally.
- `Prompt input` / `Context input` read first-class `prompt_input_package` events. Each package is written by TinyOffice for the current turn/model call and includes the full readable TinyOffice-owned input package rather than a session-level assembly summary.
- The UI groups readable input by meaning: prompt-facing instructions, runtime/context blocks, tools and skills, and folded diagnostics. It does not expose raw parameter names as primary sections.
- The trigger message is shown in the runtime turn itself, not duplicated inside prompt input facts. In channel handoff, the trigger can be another employee message, so the product UI must not relabel it as a human `User message`.
- Recent Chat history is represented inside context blocks. It should be exposed there when recorded and should not be duplicated as a separate user-authored turn in the product UI.
- Callable tools and loaded skills are displayed from the prompt input package for the model call that used them. They are capabilities sent toward AI, not text prompt blocks.
- Hashes, stable prefix length, model call ids, and cache proof fields are debug evidence. They stay available behind folded debug details and are not part of the default reading path.
- `prompt-snapshot.json` is not a Sessions data source.

## Usage Persistence

Sessions treats `session_records.token_input_total`, `token_output_total`, and `token_cache_total` as authoritative for page totals. All runtime projections use the same model-call accounting rule: repeated lifecycle snapshots for one `modelCallId` are one call, the final `model_call_usage` snapshot replaces earlier snapshots for that call, and distinct model calls are added together. A Channel Handoff state-action repair is therefore counted once as a second model call inside the original visible runtime turn rather than appearing as a second conversation turn.

The main page shows usage in two places only:

- Session Overview shows the total for the whole persistent session.
- Runtime Turns show the sum of unique model calls attributed to each product turn.

The former standalone Usage section was retired because it repeated the same per-turn token facts and exposed model call ids in the primary reading path.

The UI displays usage as:

```text
in: 123 - out: 45 - cache: 67
```

Price and response count are not part of the main Sessions usage display.

## Realtime Refresh

Sessions uses React-driven HTTP snapshot refresh against `/api/companies/:companyId/sessions/view-model`. Runtime realtime events remain the backend invalidation signal for session persistence, but the retired native HTML client is no longer the current user-facing refresh path:

1. The shadcn app receives runtime notifications through the current socket.io realtime route; retired Mattermost plugin proxy pages are not a product path.
2. Runtime persistence broadcasts `session.updated` or `session.completed`.
3. The browser receives the event and coalesces dense invalidations before refetching the list/detail HTTP snapshot. Process Trace append events refresh Sessions evidence without also refreshing the employee runtime summary.
4. The HTTP snapshot remains authoritative; WebSocket payloads are lightweight invalidation notices, not streamed detail state.

## Tests

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test --test-concurrency=1 tests/runtime/session-explorer.test.ts
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/runtime/pi-natural-language-responder.test.ts
node --import tsx --test apps/tinyoffice-web-shadcn/src/api/sessionsClient.test.ts apps/tinyoffice-web-shadcn/src/sessions/sessionExplorerModel.test.ts
npm run check:tinyoffice-web-shadcn
```
