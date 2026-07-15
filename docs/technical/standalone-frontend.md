# Standalone Frontend

`apps/tinyoffice-web-shadcn` is the documented standalone frontend target for TinyOffice.

It is a React/Vite/Tailwind/shadcn app that consumes TinyOffice-owned APIs and renders product surfaces for Chat and future top-level operations modules.

## Product Boundary

- Chat data comes from Chat Projection, Company Directory, Conversation, Message, read-state, and create-entry APIs.
- Runtime execution, employee replies, context lookup, permissions, Sessions, Process Trace, and realtime events stay behind backend services.
- The frontend must not call employee runtime internals directly.
- The frontend must not synthesize participants, evidence, channels, or titles when backend data is missing.

## UI Boundary

New frontend UI work must use `shadcn/ui` primitives and app composition components in `apps/tinyoffice-web-shadcn`.

Do not use retired local primitive systems, old page-specific CSS systems, plugin shells, carrier-native ids, or deleted UI entrypoints as implementation sources.

## Navigation Boundary

The shadcn app uses canonical navigation targets instead of page-pair return logic.

- `apps/tinyoffice-web-shadcn/src/app/navigationRoutes.ts` owns top-level app routes, Chat room routes, Session routes, Task routes, and the shared `NavigationTarget` type.
- Cross-surface opens should call the app-level target opener with a canonical target such as Chat room, Session, Task, or App view.
- Source return context lives in `history.state` as TinyOffice navigation state. It must not be encoded into the canonical URL.
- Direct URL opens stay canonical and shareable. They should not invent a fake return button.
- Object links and source links are separate concepts. A detail page may offer a local list return and a source return, but should not create bespoke pairwise navigation code such as Session-to-Chat-only return handlers.

## Module-Owned Alerts

- TinyOffice has no standalone Attention surface or `/attention` aggregation API.
- Chat owns unread messages, mentions, human handoffs, blocked-recovery conversations, and foreground Access cards. Its rail indicator is derived from the existing viewer-scoped Chat projection and foreground Access request query.
- Tasks owns failed and dispatch-failed execution controls. Its rail indicator is derived from the existing Tasks view model.
- A blocked recovery message remains visible as Work evidence in Tasks, but its navigation alert belongs to Chat so the same condition does not create two global indicators.
- Rail indicators are lightweight existence signals, not a second inbox. Opening Chat or Tasks reveals the authoritative rows and actions.

## Unsaved Configuration Navigation

- `UnsavedChangesProvider` owns the application-level dirty-scope registry, discard dialog, and browser unload protection.
- Configuration editors register a stable Company-scoped dirty key and compare their draft to the last authoritative response.
- Top-level route opens, Company switches, local object switches, canonical cross-surface navigation, and browser history navigation pass through the shared transition guard.
- The guard protects drafts only. It does not add storage, revision history, automatic merging, or a compatibility fallback.

## Verification

Use shadcn frontend checks:

```powershell
node --import tsx --test apps\tinyoffice-web-shadcn\src\api\chatClient.test.ts apps\tinyoffice-web-shadcn\src\chat\chatShellModel.test.ts tests\frontend\shadcn-frontend-foundation.test.ts
npm run check --prefix apps/tinyoffice-web-shadcn
npm run build --prefix apps/tinyoffice-web-shadcn
npm run lint --prefix apps/tinyoffice-web-shadcn
npm run check:ui-boundaries --prefix apps/tinyoffice-web-shadcn
npm run analyze:bundle --prefix apps/tinyoffice-web-shadcn
```
