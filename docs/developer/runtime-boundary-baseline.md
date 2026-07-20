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

## Provider Resource Isolation

Provider SDK configuration is not product configuration. The current PI adapter ignores host-global and project-level PI extensions, prompt templates, themes, and context files. Employee sessions load only the code-owned approved internal extension factories plus TinyOffice-selected Company and Employee Skills. System AI calls load none of those resources and use an in-memory independent session.

Do not add an extension by writing `.pi/settings.json` into an employee workspace. Update the approved runtime manifest only after checking the extension against TinyOffice identity, Company isolation, Access, Handoff, Work, Evidence, fixed-model, and web-runtime contracts.

MCP belongs behind a provider-neutral TinyOffice gateway. It must not become an implicit PI-global configuration dependency.

## Current Verification

```powershell
npm run check
npm test
npm run docs:build
npm run smoke:no-carrier-chat
npm run smoke:standalone-frontend-browser
```

Use `npm start` for a real local PostgreSQL-backed Chat preview.
