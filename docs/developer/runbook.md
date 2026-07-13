# Developer Runbook

This runbook records the current TinyOffice mainline verification path after the retired carrier adapter was hard-deleted from the repository.

## Default Checks

Run these before claiming a code or product-doc change is ready:

```powershell
npm run check
npm test
npm run docs:build
```

For focused frontend/runtime smoke:

```powershell
npm run smoke:no-carrier-chat
npm run smoke:standalone-frontend-browser
node --import tsx scripts/runtime/run-real-chat-preview.ts
```

## Product Runtime Preview

`scripts/runtime/run-real-chat-preview.ts` starts the local TinyOffice Chat runtime API and standalone frontend against PostgreSQL-backed runtime data.

The runtime uses one shared PostgreSQL pool per database URL. Repository close returns clients to that pool; it must not create and retire a new pool on every three-second control-plane scan. During lifecycle smoke, verify that runtime connections remain bounded by the configured pool maximum instead of growing on every tick.

Expected local entry:

```text
http://127.0.0.1:5175/?companyId=tinyoffice&memberId=xuziho&memberDisplayName=Xu%20Ziho&memberRole=boss
```

The URL identity parameters are development-preview and smoke-test inputs only. Product implementation must not add new behavior that depends on `companyId`, `memberId`, `viewerMemberId`, `employeeId`, or `viewerEmployeeId` URL parameters as login identity. Production identity must come from TinyOffice backend login/session state.

## Local Issue Reports

If the user reports a local `127.0.0.1` / `localhost` page, verify the same local environment first. Do not use mini-host, Tailscale, or remote deployment evidence as a substitute for the page the user is looking at.

Record:

- exact URL
- branch/commit
- command used to start the runtime/frontend
- whether the evidence came from real PostgreSQL-backed runtime data or a deterministic smoke stub

## Current Source Of Truth

- Product frontend: `apps/tinyoffice-web-shadcn`
- Product APIs/runtime: `src/`, `scripts/runtime/run-real-chat-preview.ts`
- Product facts: PostgreSQL-backed repositories and TinyOffice-owned DTOs
- Product docs: `docs/`

Do not restore Mattermost plugin package, deployment files, runtime adapter scripts, native frontend entrypoints, plugin proxy routes, or carrier Team/User/Channel/Post ids as product requirements.

Do not copy old plugin or adapter code back into this repository.
