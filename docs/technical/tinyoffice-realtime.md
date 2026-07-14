# TinyOffice Realtime Contract

TinyOffice-owned realtime is a product contract before it is a transport. The current 5175 frontend implementation serves the contract through socket.io at `/api/realtime/socket.io`. The public event model must stay TinyOffice-owned and must not inherit carrier-native events, temporary frontend state, or legacy compatibility aliases.

## Boundary

The TinyOffice realtime gateway is product-owned infrastructure:

- source contract: `src/collaboration/contracts/tinyoffice-realtime-contract.ts`
- current socket.io gateway: `src/runtime/realtime/tinyoffice-realtime-gateway.ts`
- current runtime path: `/api/realtime/socket.io`
- socket.io handshake query: `companyId` plus `memberId`
- first product publisher: Chat mutation routes in `src/collaboration/api/chat-projection-api-routes.ts`
- first product consumer: `apps/tinyoffice-web-shadcn`

Public realtime events must use TinyOffice company, container, entry, room, message, run, and member ids. Public Chat run events use `runId`; legacy public `eventKey` is rejected. Runtime employee ids may still exist inside runtime/session/process-trace evidence when they describe the AI worker identity, but they are not Chat delivery, viewer, read-state, mention, or attachment ownership ids.

## Event Envelope

Every event has a stable envelope:

```ts
type TinyOfficeRealtimeEvent = {
  schema: "tinyoffice-realtime-event";
  version: 1;
  eventId: string;
  occurredAt: string;
  sequence: number;
} & TinyOfficeRealtimeEventPayload;
```

The current Chat payload family is:

```ts
type TinyOfficeRealtimeEventPayload =
  | { type: "chat.entry.created"; companyId: string; containerId: string; entryId: string; roomId: string }
  | { type: "chat.message.created"; companyId: string; conversationId: string; roomId: string; messageId: string }
  | { type: "chat.read_state.updated"; companyId: string; roomId: string; memberId: string }
  | { type: "chat.projection.changed"; companyId: string; viewerMemberId: string }
  | { type: "chat.runtime_status.changed"; companyId: string; conversationId: string; roomId: string; runId: string; chainId?: string; sourceMessageId: string; targetMemberId: string; status: ChatRuntimeStatus; sessionKey?: string; sessionRecordId?: string; runtimeProviderId?: string; replyMessageId?: string; errorMessage?: string }
  | { type: "chat.process_trace.appended"; companyId: string; conversationId: string; roomId: string; runId: string; sourceMessageId: string; targetMemberId: string; sessionKey?: string; replyMessageId?: string; processTraceEvent: ProcessTraceEvent }
  | { type: "chat.reply.delta"; companyId: string; conversationId: string; roomId: string; runId: string; sourceMessageId: string; targetMemberId: string; sessionKey?: string; delta: string; sequenceInRun: number }
  | { type: "chat.reply.snapshot"; companyId: string; conversationId: string; roomId: string; runId: string; sourceMessageId: string; targetMemberId: string; sessionKey?: string; content: string; sequenceInRun: number };
```

The contract is intentionally broader than the first Chat slice so later TinyOffice product areas can add event families without replacing the transport.

`ChatRuntimeStatus` currently includes:

```ts
type ChatRuntimeStatus =
  | "queued"
  | "received"
  | "thinking"
  | "tool_calling"
  | "streaming"
  | "replying"
  | "completed"
  | "cancel_requested"
  | "canceled"
  | "failed";
```

## Current Chat Semantics

Chat realtime is notification-first. REST remains authoritative for projection, message, and context state.

- `POST /api/companies/:companyId/chat/entries` publishes `chat.entry.created`, the first `chat.message.created`, and a projection refresh event for the actor.
- `POST /api/companies/:companyId/chat/rooms/:roomId/messages` publishes `chat.message.created` and projection refresh events for known conversation participants.
- `POST /api/companies/:companyId/chat/rooms/:roomId/read` publishes `chat.read_state.updated` and a projection refresh event for the reader.
- Runtime dispatch publishes `chat.runtime_status.changed` while a runtime-capable member reply is running. These events identify the AI turn with `runId`.
- Runtime dispatch publishes `chat.process_trace.appended` when new process-trace evidence is attached to a chat turn.
- Pi thinking streams are projected before publication. `thinking_start`, `thinking_delta`, and `thinking_end` share one logical thinking key, and high-frequency delta chunks must be collapsed into a small number of readable activity events rather than emitted as raw provider spam.
- Frontend Activity rendering belongs to the stable Chat Context dock, not the Chat message stream. A room can contain multiple completed or running activities at the same time, especially during Channel handoff. The frontend reads the backend Activity projection for the selected active run or selected employee reply, using explicit `sourceMessageId` metadata rather than room-wide trace mixing. Employee message headers may own the navigation action that selects their turn, but the Activity content still renders in Context. The frontend must not rebuild a parallel process-activity model from realtime events.
- Runtime streaming can publish `chat.reply.delta` and `chat.reply.snapshot`. These events are ephemeral draft output for the `runId`; they are not final persisted Messages and must not be treated as database truth. They update the run-state draft layer only. They must not invalidate authoritative message queries by themselves.
- `chat.process_trace.appended` invalidates the room Activity query only. It must not invalidate authoritative message queries by itself.
- For a Chat runtime turn, the first real `chat.process_trace.appended` event for a `runId` must arrive before the first visible reply event (`chat.reply.delta` or `chat.reply.snapshot`) for that same `runId`. This is the contract that lets the Chat Context Activity dock show work evidence before the message body begins streaming.
- `npm run smoke:chat-realtime-order` verifies that ordering against a running local preview (`8095` by default) through the real Socket.IO channel. It creates a live smoke DM topic in the current preview company, so run it only against local preview data.
- `POST /api/companies/:companyId/chat/runs/:runId/cancel` requests cancellation for an active run. The backend runtime layer owns the actual abort; the frontend must not treat local spinner removal as cancellation.
- `GET /api/companies/:companyId/chat` remains the Chat Projection source of truth.

The standalone shadcn web app subscribes to the current socket.io route and imports the shared `tinyoffice/realtime-contracts` type. Persisted-data events invalidate TanStack Query keys; HTTP clients then refetch authoritative data. Streaming draft events stay in the run-state layer. Process trace append events refresh Activity queries under the selected room/source-message scope. Final persisted Messages still reconcile through `chat.message.created` and the normal Message/Projection APIs.

## Run Lifecycle And Cancel Boundary

An AI reply run is the realtime-visible unit of work for send-button pending state, stop/cancel controls, streaming drafts, Session evidence, and process-trace linkage.

- `runId` is required for runtime status, process trace, and reply streaming events. Channel Topic runs also carry their shared `chainId`.
- `sourceMessageId` is the user or employee message that triggered the run.
- `targetMemberId` is the runtime-capable company member doing the Chat work.
- `sessionKey` and `sessionRecordId` link the run to runtime/session evidence when present.
- A Channel Topic handoff chain has one durable `chainId` and exactly one current `runId`. Each recipient still gets a separate AI reply run for Session, Process Trace, and streaming evidence, while Stop resolves any run in the chain to the actual current holder. The child run is registered and published as queued before the parent becomes terminal so the selected Topic Stop control remains continuous.
- The cancel control calls `POST /api/companies/:companyId/chat/runs/:runId/cancel`; realtime broadcasts `cancel_requested` and then `canceled` when the runtime abort succeeds. The UI must not synthesize cancellation by only hiding a spinner.
- If the runtime provider does not acknowledge abort immediately, the run can remain `cancel_requested` until the provider returns or the backend resolves the run through a later terminal path. The UI may show cancellation as pending, but it must not promote the run to `canceled` without the backend terminal event.
- Cancellation is a hard write-back boundary. If a provider returns text or tool actions after the TinyOffice run has been canceled, the runtime must not publish reply draft snapshots, must not persist a Conversation reply, and must not dispatch the next Channel handoff. The owned Chat execution session is marked `canceled`, and a `canceled` Process Trace event records that no visible reply was persisted. If the active client had already received streamed draft text before cancellation, it may keep that text visible as a stopped draft, clearly marked as not sent; it is not a persisted Conversation message.

## Non-Goals

This realtime slice does not make Tasks, Sessions, WorkRun detail pages, or governance realtime UX part of the current shadcn frontend surface. It also does not make Mattermost Team/User/Channel/DM discovery part of the product surface. It does not preserve public `eventKey` compatibility.

## Verification

Run:

```powershell
node --import tsx --test tests/collaboration/tinyoffice-realtime-contract.test.ts
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/runtime/tinyoffice-realtime-contract.test.ts
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/collaboration/chat-projection-api-routes.test.ts
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/runtime/conversation-api-runtime.test.ts
node --import tsx --test apps\tinyoffice-web-shadcn\src\chat\chatRunState.test.ts
```
