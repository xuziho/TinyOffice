# UI Performance Smoke

Use this check when a TinyOffice-owned frontend page feels slow, jumpy, or visually unstable.

## Targets

- `apps/tinyoffice-web-shadcn`
- other TinyOffice-owned Operations Surface/frontend pages

Do not use deleted plugin proxy routes or carrier-native frontend pages as performance targets.

## Checks

- initial load completes without blank primary panels
- list selection does not reset scroll unexpectedly
- composer/footer remains anchored
- controls show immediate feedback
- text stays inside buttons/cards at desktop and mobile widths
- WebSocket refresh does not duplicate rows or jump the page
- manual refresh preserves the selected item unless backend data removed it

## Commands

```powershell
npm run smoke:standalone-frontend-browser
node --import tsx scripts/runtime/run-real-chat-preview.ts
```

For code-level changes, also run the relevant frontend or view-model tests.
