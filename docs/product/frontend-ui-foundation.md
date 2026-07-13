# Frontend UI Foundation

TinyOffice has explicitly chosen `shadcn/ui` as the frontend UI foundation for the standalone frontend.

This is a hard direction change. Product manual pages and new frontend work must treat `apps/tinyoffice-web-shadcn` as the documented implementation target.

## Decision

- New frontend work uses `shadcn/ui` as the official base UI system.
- The frontend app is `apps/tinyoffice-web-shadcn`.
- Retired local primitive UI is not part of the current frontend foundation.

## Product Shape

TinyOffice is a Slack/Discord-like collaboration workspace with operations/admin surfaces.

The primary product structure is:

- left workspace/channel/DM navigation;
- center room, message stream, and composer surface;
- right context/evidence panel;
- top-level operations destinations for Tasks, Sessions, Status, Company, Runtime, Prompt, and Access.

TinyOffice is not a marketing website, decorative dashboard, or single-thread ChatGPT clone. Do not use hero sections, pricing blocks, testimonial blocks, decorative gradients, oversized marketing typography, or SaaS landing-page composition for product surfaces.

## shadcn Usage Rules

Base UI primitives must come from `shadcn/ui` through the official `shadcn` CLI or an approved registry. Use shadcn MCP or registry lookup before adding or designing UI.

Base primitives include:

- `button`
- `input`
- `textarea`
- `select`
- `dialog`
- `dropdown-menu`
- `context-menu`
- `tooltip`
- `sheet`
- `tabs`
- `sidebar`
- `scroll-area`
- `resizable`
- `avatar`
- `badge`
- `table`
- `skeleton`
- `message-scroller`
- `message`
- `bubble`
- `attachment`
- `marker`

Do not hand-roll replacement primitives such as custom buttons, dialogs, dropdowns, inputs, tables, scroll areas, sidebars, message rows, message bubbles, attachment cards, or tooltips.

Allowed custom components are TinyOffice product composition components only. Examples:

- `WorkspaceShell`
- `ChatSidebar`
- `RoomView`
- `Composer`
- `ContextPanel`
- `TaskPanel`
- `SessionEvidencePanel`
- `ConfigSection`

These product components must compose shadcn primitives and TinyOffice data models. They must not recreate base UI behavior.

For the Chat workspace left rail, `ChatSidebar` / workspace navigation must compose the shadcn `sidebar` primitives (`SidebarProvider`, `Sidebar`, `SidebarContent`, `SidebarMenu`, `SidebarMenuButton`, and related menu primitives). It must not recreate sidebar structure with raw `aside`/`nav` plus custom button state when the official primitive already exists.

## Frontend Code Boundaries

New frontend work must keep the application shell, data control, UI model, product composition, base primitives, and HTTP clients separate:

- `src/app/App.tsx` mounts providers and top-level panels only.
- `src/main.tsx` mounts app-level providers, including `QueryClientProvider`.
- `src/chat/useChatWorkspace.ts` owns Chat query composition, selection, read-state updates, create-entry actions, and room reply actions.
- `src/chat/useChatRealtime.ts` owns Chat socket.io subscription and Query invalidation.
- `src/chat/chatQueryKeys.ts` owns stable Query keys.
- `src/chat/chatShellModel.ts` converts API DTOs into render-ready product state.
- `src/chat/*.tsx` components render TinyOffice product surfaces by composing shadcn primitives.
- `src/components/ui/*` contains installed shadcn primitives.
- `src/api/*.ts` contains frontend HTTP clients.

Do not prototype new Chat feature logic in `App.tsx` and split it later. Put it in the narrowest correct boundary from the start.

## Server State And Realtime

TanStack Query is the standard server-state foundation for the shadcn frontend.

- API reads use Query hooks.
- API writes use mutations.
- Mutations invalidate or update the affected Query keys.
- Socket.io realtime events from `/api/realtime/socket.io` invalidate or update Query data.
- UI component state is only for local interaction state such as selected surfaces, text drafts, open panels, dialogs, and hover state.

Do not introduce a second custom server-state framework with React `useState`, ad-hoc caches, or component-owned fetch state. WebSocket payloads are event notifications; the authoritative data remains the HTTP API plus TanStack Query cache.

## Navigation Semantics

TinyOffice is a browser-hosted product surface, so product-resource navigation must preserve normal browser behavior.

- Top-level modules use stable paths such as `/chat`, `/company`, `/sessions`, and `/tasks`.
- Concrete product resources use stable query routes where the current frontend has no router layer yet, such as `/chat?roomId=...&surface=...`, `/sessions?employeeId=...&sessionId=...`, and `/tasks?taskId=...`.
- Any UI element whose primary job is to open a concrete product resource should expose a real `href`. Normal left-click may intercept into the SPA, but Ctrl/Meta click, middle click, copied links, and the browser context menu must remain available.
- Buttons remain correct for commands that mutate state, open dialogs, change local filters, archive, cancel, create, or submit. Do not turn command buttons into links just to make them look navigational.
- URL state is product state for the currently open resource. List/detail transitions for Sessions and Tasks must keep the address bar aligned with the visible object.
- Directory selectors that only change local scope, such as a Channel directory or DM directory before a concrete entry is selected, should remain controls until the product has a stable route for that scope. Do not invent fake links or fallback routes.

## Retired Frontend Boundary

New frontend work must not import or reuse retired local frontend assets:

- `ui-*` CSS classes
- `AdminShell`
- `Panel`
- `StateBlock`
- old page-specific styling

The shadcn app must consume current TinyOffice product APIs through HTTP API clients under `apps/tinyoffice-web-shadcn/src/api/` and the frontend-safe contract entry `tinyoffice/frontend-api-contracts`. It must not install the repository root with `file:../..`, import old frontend modules, or import backend implementation modules such as runtime, storage, work, or company-config code.

## Rebuild Staging

The shadcn frontend app lives at `apps/tinyoffice-web-shadcn`.

The rebuild order should be:

1. shadcn project foundation, `components.json`, Tailwind, app entry, routing, and verification scripts. The initial foundation is present in `apps/tinyoffice-web-shadcn`.
2. Frontend-safe API/contract boundary using `tinyoffice/frontend-api-contracts` and app-local HTTP clients for current session, Chat Projection, Company Directory, and room messages.
3. Slack/Discord-like Chat shell: left navigation, room surface, composer, and right context panel.
4. Chat message primitives using `message-scroller`, `message`, `bubble`, `attachment`, and `marker` where applicable.
5. Tasks, Sessions, Status, Company, Runtime, Prompt, and Access surfaces.
6. Runtime preview and browser smoke validation.

## Visual Rules

Use Tailwind CSS and shadcn CSS variables. Keep spacing on an 8px system. Use theme tokens and semantic state colors only.

Avoid random colors, decorative gradients, large marketing cards, hero sections, and one-off visual systems. Dense, clear, restrained, state-first workspace UI remains the TinyOffice product direction.
