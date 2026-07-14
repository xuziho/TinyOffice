# Runtime Boundary Baseline

This page records the current runtime boundary after the old carrier adapter was removed from mainline.

## Current Direction

TinyOffice runtime work must move through owned boundaries:

```text
TinyOffice Chat / Intake / Work event
  -> explicit Company context
  -> member / participant / runtime-capable target resolution
  -> runtime provider adapter
  -> Session / Process Trace / Work / Message persistence
  -> TinyOffice realtime events
```

Runtime code must not require carrier-native Team/User/Channel/Post ids, plugin proxy routes, or carrier-native frontend events.

## Provider Boundary

Runtime provider implementations must remain behind adapter boundaries. Product code should depend on provider-neutral inputs and outputs:

- reply request
- stream/status events
- tool-call evidence
- usage
- session/process trace identifiers

Chat, Work, Sessions, and Access should not directly depend on a single provider implementation.

## Current Verification

```powershell
npm run check
npm test
npm run docs:build
npm run smoke:no-carrier-chat
npm run smoke:standalone-frontend-browser
```

Use `npm start` for a real local PostgreSQL-backed Chat preview.
