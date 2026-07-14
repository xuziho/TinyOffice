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
npm start
```

## Product Runtime Preview

`scripts/runtime/run-tinyoffice.ts` starts the local TinyOffice Chat runtime API and standalone frontend against PostgreSQL-backed runtime data.

The runtime uses one shared PostgreSQL pool per database URL. Repository close returns clients to that pool; it must not create and retire a new pool on every three-second control-plane scan. During lifecycle smoke, verify that runtime connections remain bounded by the configured pool maximum instead of growing on every tick.

Expected local entry:

```text
http://localhost:5175/
```

URL and request identity parameters are not login inputs. Product implementation must not add behavior that depends on `companyId`, `memberId`, `viewerMemberId`, `employeeId`, or `viewerEmployeeId` as the current human identity. The Owner always comes from the verified backend session; tests use an internal injected provider.

## Local Issue Reports

If the user reports a local `127.0.0.1` / `localhost` page, verify the same local environment first. Do not use mini-host, Tailscale, or remote deployment evidence as a substitute for the page the user is looking at.

Record:

- exact URL
- branch/commit
- command used to start the runtime/frontend
- whether the evidence came from real PostgreSQL-backed runtime data or a deterministic smoke stub

## Current Source Of Truth

- Product frontend: `apps/tinyoffice-web-shadcn`
- Product APIs/runtime: `src/`, `scripts/runtime/run-tinyoffice.ts`
- Product facts: PostgreSQL-backed repositories and TinyOffice-owned DTOs
- Product docs: `docs/`

Do not restore Mattermost plugin package, deployment files, runtime adapter scripts, native frontend entrypoints, plugin proxy routes, or carrier Team/User/Channel/Post ids as product requirements.

Do not copy old plugin or adapter code back into this repository.
