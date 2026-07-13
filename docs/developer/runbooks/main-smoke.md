# Main Smoke

Default TinyOffice product smoke uses the TinyOffice-owned no-carrier Chat path and standalone frontend browser path:

```powershell
npm run smoke:no-carrier-chat
npm run smoke:standalone-frontend-browser
```

## Boundary

Run real smoke from updated `main`, not from a branch preview, unless the user explicitly requests a branch smoke exception.

```powershell
git status --short --branch
git pull --ff-only
```

If the user reports a local `127.0.0.1`, `localhost`, or `8095` issue, verify the same local environment first. Do not use mini-host results as a substitute.

## No-Carrier Chat Smoke

Use this command as the first-class TinyOffice-owned Chat smoke:

```powershell
npm run smoke:no-carrier-chat
```

The smoke is in-process and verifies the current owned path through TinyOffice ids:

- Chat create-entry API with `companyId`, `containerId`, `entryId`, `roomId`, `messageId`, and structured `mentionedEmployeeIds`
- Runtime Dispatch decision for the mentioned employee
- owned employee session intent evidence with `sessionRecordId` / `sessionEventId`
- fake local employee execution result and owned Conversation/Message reply persistence
- `chat.message.created` and `chat.projection.changed` realtime events for the reply
- standalone frontend refresh planning for the active Chat room

This smoke is the branch/worktree proof for TinyOffice-owned Chat correctness. It complements the standalone frontend browser smoke below.

## Standalone Frontend Browser Smoke

Use this command for the branch/worktree browser proof that `apps/tinyoffice-web-shadcn` can act as the TinyOffice-owned product entry:

```powershell
npm run smoke:standalone-frontend-browser
```

The command starts a temporary TinyOffice-owned runtime stub, starts the `apps/tinyoffice-web-shadcn` Vite server with `/api` and `/api/realtime/socket.io` pointed at that stub, then opens the standalone frontend in a real local Edge or Chrome browser through the Chrome DevTools Protocol.

The smoke verifies:

- the standalone frontend opens as the product route
- Chat Projection renders the entry list with unread/mention attention state
- a topic/thread room can be entered from the Chat entry list
- the room composer sends through TinyOffice-owned Chat room message APIs
- read-state calls are issued through the owned Chat room read endpoint
- a `chat.message.created` / `chat.projection.changed` realtime update over `/api/realtime/socket.io` refreshes the active room visibly

Prerequisite: Microsoft Edge or Google Chrome must be installed on the machine running the command. The smoke creates a temporary browser profile and closes it when finished.

If main smoke fails, prefer reverting the merge or opening a new `codex/...` repair branch. Do not keep expanding fixes directly on `main`.

For Tasks, WorkRun, Intake, Sessions, Process Trace, and Company deletion checks after Company isolation, use the [Company-Scoped Smoke Matrix](company-scoped-smoke-matrix.md).
