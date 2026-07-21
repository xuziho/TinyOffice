# TinyOffice Web Technical Implementation

`apps/tinyoffice-web-shadcn` is the current TinyOffice-owned frontend rebuild. It is the only documented frontend implementation target for new UI work.

The app uses React, Vite, Tailwind CSS, `shadcn/ui`, and TanStack Query. It talks to TinyOffice runtime APIs through app-local HTTP clients and the frontend-safe contract entry `tinyoffice/frontend-api-contracts`.

The visual and interaction baseline follows `product/ui-style-brief.md`.

## Local App

The shadcn app owns:

- `apps/tinyoffice-web-shadcn/components.json`
- `apps/tinyoffice-web-shadcn/src/components/ui`
- `apps/tinyoffice-web-shadcn/src/api`
- `apps/tinyoffice-web-shadcn/src/chat`
- `apps/tinyoffice-web-shadcn/src/app/App.tsx`

Primary commands:

```powershell
npm run dev:tinyoffice-web-shadcn
npm run check:tinyoffice-web-shadcn
npm run build:tinyoffice-web-shadcn
```

The local dev server uses port `5175` and proxies `/api` plus websocket traffic to the TinyOffice runtime origin, defaulting to `http://127.0.0.1:8095`.

## API Boundary

Frontend code must call TinyOffice APIs through app-local clients under `apps/tinyoffice-web-shadcn/src/api/`.

Current clients:

- `currentSessionClient.ts` for `/api/tinyoffice/session/current`
- `chatClient.ts` for Chat Projection, room messages, read state, and entry creation
- `directoryClient.ts` for Company Directory
- `tinyofficeRequest.ts`, `tinyofficePaths.ts`, and `viewerQuery.ts` for HTTP, path, and viewer helpers

The app must not import backend implementation modules, runtime modules, storage modules, or company-config implementation code.

## UI Foundation

Base UI primitives must come from `shadcn/ui` through the official CLI or an approved registry. Installed primitives live under `apps/tinyoffice-web-shadcn/src/components/ui`.

TinyOffice product components may compose those primitives, but must not reimplement base UI behavior.

Frontend code follows a feature boundary:

- `src/app/App.tsx` is the app shell: providers, top-level panel mount, and document-level effects only.
- `src/main.tsx` owns app-level providers, including `QueryClientProvider`.
- `src/app/App.tsx` owns the persistent rail, authoritative current-session query, company switching, and top-level navigation. Product pages are loaded with route-level `lazy()` boundaries instead of being bundled into the initial entry.
- `src/chat/ChatWorkspaceRoute.tsx` owns the mounted Chat workbench. It is the only app route that invokes `useChatWorkspace`, so Chat projection/message queries and the realtime connection are inactive on Tasks, Settings, and administration pages.
- `src/chat/useChatWorkspace.ts` owns Chat composition state, surface selection, Query hooks, mutations, read-state updates, create-entry actions, and room reply actions.
- `src/chat/useChatRealtime.ts` owns the current realtime subscription, imports `tinyoffice/realtime-contracts`, and invalidates TanStack Query data for persisted-data events.
- `src/chat/chatRunState.ts` owns ephemeral active-run UI state for backend runtime work. It is not a server-state cache and must only be derived from shared realtime events.
- `src/chat/chatQueryKeys.ts` owns stable Query keys for Chat server state.
- `src/chat/chatShellModel.ts` maps TinyOffice DTOs into UI model state.
- `src/chat/*.tsx` product components render Chat surfaces by composing shadcn primitives.
- `src/api/*.ts` owns HTTP calls and request/response parsing.

New Chat behavior must enter through the narrowest matching boundary. Do not add new feature logic to `App.tsx` first and split it later.

Production builds emit a Vite manifest and run `scripts/check-bundle-size.mjs`. The initial JavaScript entry must remain below 450 KiB and every async JavaScript chunk below 400 KiB. Raising these budgets requires an explicit architecture decision; a page import should normally remain behind its route boundary.

Route boundaries are prefetched when the operator points at or focuses a rail/section destination. This keeps code splitting intact while normally completing the async module fetch before the click. Topic rows similarly prefetch the selected room's authoritative Message query on pointer intent.

TanStack Query is the frontend server-state foundation. API reads are Query hooks, writes are mutations, and mutation/realtime updates must invalidate or update the relevant Query keys. Do not create parallel long-lived server-state stores with React `useState`, ad-hoc caches, or UI component state.

The Chat loading boundary covers only the current session, Chat Projection, and selected room Messages. Directory, employee runtime summary, Tasks, Activity, and Access requests load progressively and must not hold the whole workspace behind a generic loading screen. Stable Chat reads use short, explicit freshness windows so returning to a recently viewed surface does not immediately repeat the same HTTP work; persisted realtime events still invalidate affected authoritative queries.

Room sends use TanStack Query's mutation cache as a short-lived optimistic layer. The composer releases the submitted draft immediately, inserts one `deliveryState: pending` Message at the final timeline position, and then replaces that exact row with the durable `POST .../messages` response. A failed request removes the pending row and restores the submitted draft. The backend response remains authoritative; this pending row is neither persisted nor a second message model. Successful sends update only the affected room Message cache and Projection, not current session, Company Directory, or employee runtime summary.

The realtime client connects to the current socket.io path `/api/realtime/socket.io`. Realtime persisted-data events are notifications, not a second data model. The default pattern is to invalidate the relevant Query keys and let HTTP clients refetch authoritative data:

- `chat.message.created` invalidates the affected room messages and Chat Projection.
- `chat.entry.created` invalidates Chat Projection.
- `chat.projection.changed` invalidates Chat Projection.
- `chat.read_state.updated` invalidates Chat Projection.
- `company.directory.changed` invalidates the Company Directory.
- `access.request.changed` invalidates Access request data.
- `work_run.updated` invalidates employee runtime summary, Tasks, and Sessions query scopes.
- `work_task.updated` invalidates employee runtime summary and Tasks query scopes.
- `session.updated` invalidates employee runtime summary and Sessions query scopes.
- `process_trace.appended` invalidates Sessions only. Trace detail is evidence, not a change to the employee runtime summary.

Runtime and streaming events use the same shared realtime contract but are not all persisted-data notifications. `chat.runtime_status.changed`, `chat.reply.delta`, and `chat.reply.snapshot` update only the local `chatRunState` layer. `chat.activity.observed` applies backend-projected Activity upserts to a local overlay without invalidating REST queries. `chat.activity.persisted` advances the durable watermark; reconnect, sequence gaps, selection changes, and terminal status reconcile with the authoritative Activity endpoint. Runtime events must not invalidate room messages, Chat Projection, employee status, Sessions, or Activity on every observation, because doing so can remount the selected surface, flash back to list/empty states, or overload shared storage. The final persisted reply still arrives through the backend Message/Projection APIs and their realtime notifications. The composer can show Stop only when `chatRunState` has a non-terminal active run for the selected room, and Stop must call the backend cancel API.

Provider retry is an explicit ephemeral lifecycle state. When a retry starts, the backend publishes an empty `chat.reply.snapshot` before `chat.runtime_status.changed: retrying`; the frontend discards the failed attempt's draft, shows `Retrying...` on the active employee, and renders only text from the new attempt. A successful retry returns to `thinking` until new text arrives. Terminal `completed`, `failed`, or `canceled` events clear the active employee state consistently.

Employee status dots and the Chat right Context rail are not independent server-state caches. They are derived from the employee runtime summary API and refresh from WorkTask, WorkRun, and Session state changes. Raw Process Trace appends refresh evidence surfaces, not the employee summary. Tasks mutations should also locally invalidate the same runtime summary and Sessions scopes so the operator sees immediate feedback even before the socket.io round trip completes.

Chat frontend identity is member-only. API clients send `viewerMemberId`, `actorMemberId`, Channel member `memberId`, `mentionedMemberIds`, and image attachment owner member context. They must not send `viewerEmployeeId`, `actorEmployeeId`, `participantEmployeeIds`, `mentionedEmployeeIds`, or `ownerEmployeeId` to Chat routes. Active runtime UI state also uses `targetMemberId`.

Activity in the shadcn Chat surface belongs to the right Context dock, not inline message rows. Employee reply headers may expose a compact Activity action when the persisted message runtime link carries an explicit `sourceMessageId`; clicking it loads `GET /api/companies/:companyId/chat/rooms/:roomId/activity?sourceMessageId=...` for that one runtime turn. While a run is active, Chat may select the active run's `sourceMessageId` automatically. The default row shows generic activity such as run start, thinking, tool call, tool result, run completion, or failure. Each Activity row can expand raw trace events for inspection. `chatRunState` stores the backend-owned Activity overlay but does not interpret raw provider or Process Trace events into its own product model.

Use Tailwind CSS and shadcn CSS variables. Do not carry forward old local primitive class families or page-specific CSS systems.

## Chat Workbench

The shadcn Chat shell reads real TinyOffice data:

- current session: `GET /api/tinyoffice/session/current`
- Chat Projection: `GET /api/companies/:companyId/chat`
- Company Directory: `GET /api/companies/:companyId/directory`
- room messages: `GET /api/companies/:companyId/chat/rooms/:roomId/messages`
- room reply: `POST /api/companies/:companyId/chat/rooms/:roomId/messages`
- cancel active AI reply run: `POST /api/companies/:companyId/chat/runs/:runId/cancel`
- read state: `POST /api/companies/:companyId/chat/rooms/:roomId/read`
- manual room title edit: `PATCH /api/companies/:companyId/chat/rooms/:roomId/title`
- create Topic / DM chat entry: `POST /api/companies/:companyId/chat/entries`
- Channel create: `POST /api/companies/:companyId/chat/channels`
- Channel detail edit: `PATCH /api/companies/:companyId/chat/channels/:chatChannelId`
- Channel member add: `POST /api/companies/:companyId/chat/channels/:chatChannelId/members`
- Channel member removal: `DELETE /api/companies/:companyId/chat/channels/:chatChannelId/members`
- Channel dissolve: `DELETE /api/companies/:companyId/chat/channels/:chatChannelId` with body `confirmation: "delete"`

The visible shell is:

- left object navigation with Channels and Direct Messages
- center workspace that shows a selected Channel or DM contact's entry list until a concrete entry is opened
- center message stream and composer after opening a concrete Topic or DM chat entry
- right Context panel for selected-surface metadata and explicit evidence

The left navigation must not flatten Topic rows or DM chat entries into a global room list. The right Context panel must not become the message stream.

## Configuration Modules

Configuration stays out of Chat. Configuration and operations surfaces are top-level product rail destinations and top-level product rail modules, not Chat Context side-panel content.

Current and target modules include:

- Tasks
- Sessions
- Employee Runtime
- Members
- Prompt Policy
- Access

These modules should use the same `apps/tinyoffice-web-shadcn` foundation, app-local API clients, TanStack Query server state, and shadcn primitives as Chat. They should not be rebuilt as legacy pre-shadcn surfaces or hidden inside Chat metadata panels.

Without an initialized runtime Company context, Chat create-entry actions must stay behind an explicit setup gate. The frontend needs companyId, member identity, and runtime readiness before showing New topic or Start chat as live actions.

## Current Chat Rules

- Channels and Direct Messages are top-level objects.
- Topics and DM chat entries are concrete open targets inside the selected object.
- The frontend uses backend-projected `directoryMembers`; it must not reconstruct a directory from old DTO shapes.
- DM container matching must use deterministic TinyOffice container ids, not display-name, role, or title guesses.
- Context Participants must come from explicit container/room participant data; it must not fall back to the full Company Directory.
- Context participant badges for Channel and Topic surfaces should show Company Directory role/responsibility where available. Channel membership itself is only the visible participant list, not a separate owner/admin/member role layer.
- Channel settings may use Company Directory only for the explicit add-member picker. Existing participants must still come from the selected Channel container, and removing members must send the exact projected `memberId`.
- Channel creation uses the current actor as a persisted Channel participant. If the selected member list also contains the actor, the backend keeps a single participant row.
- Channel dissolve is a hard delete. The frontend must require the operator to type `delete`, and the backend must also reject requests whose confirmation body is not exactly `delete`.
- Chat image attachments now use TinyOffice-owned upload APIs, object storage, permissions, model file-input capability checks, and AI context ingestion. Broader file attachment work still needs a progressive-disclosure contract for parsing/OCR/PDF, System AI Topic summaries, and history lookup tools.
- Default Topic / DM chat title generation is backend-owned. The frontend sends the first message body and must not create synthetic default titles unless an explicit user title field exists.
- Manual Topic / DM chat title editing uses the backend room-title API through a TanStack Query mutation. The frontend must not strip prefixes, rewrite projected titles, or keep a local server-title cache.
- Empty evidence sections stay hidden.
- Process Trace remains evidence only and is not a Chat identity or message-stream control.

## Verification

Use the focused shadcn checks for frontend work:

```powershell
node --import tsx --test apps\tinyoffice-web-shadcn\src\api\chatClient.test.ts apps\tinyoffice-web-shadcn\src\chat\chatShellModel.test.ts tests\frontend\shadcn-frontend-foundation.test.ts
node --import tsx --test apps\tinyoffice-web-shadcn\src\chat\chatRunState.test.ts
node --import tsx --test tests\collaboration\tinyoffice-realtime-contract.test.ts tests\runtime\runtime-text-delta-emitter.test.ts tests\runtime\persistent-pi-employee-agent.test.ts
npm run check --prefix apps/tinyoffice-web-shadcn
npm run build --prefix apps/tinyoffice-web-shadcn
npm run lint --prefix apps/tinyoffice-web-shadcn
```

When validating against a full local runtime, also verify the runtime API on `8095`, PostgreSQL when required, `/health`, and `/api/tinyoffice/session/current`.
