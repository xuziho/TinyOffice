# Owner Authentication

TinyOffice is a one-person-company workspace. Its authentication model therefore has one human account, **Owner**, rather than public registration, teams of human users, or a development-only identity selector.

## Product decision

- TinyOffice supports exactly one authenticated human Owner.
- The primary credential is a WebAuthn passkey. TinyOffice does not store an Owner password.
- Better Auth owns credential verification, signed server sessions, session expiry, cookie security, and request throttling.
- PostgreSQL is the source of truth for the Owner account, passkeys, and sessions.
- Company membership and Company role remain separate product records. Authentication proves the human Owner account; the active Company session resolves that account to its current Company member.
- Local use and deployed use follow the same authentication path. Environment variables, request headers, URL parameters, and request bodies cannot select the current human identity.

This is a durable single-Owner foundation, not an enterprise identity system. A future external OIDC provider may authenticate the same Owner account, but must enter through the same verified server-session boundary.

## First-owner bootstrap

When no passkey exists, runtime startup creates an in-memory one-time bootstrap token and prints a localhost setup URL. The token is never returned by a public status API and is invalidated after the first passkey is verified.

1. Start TinyOffice with `npm start`.
2. Open the one-time URL printed in the terminal.
3. Confirm the operating-system passkey prompt.
4. TinyOffice creates the single Owner account, stores the passkey, and asks the new Owner to unlock the office.
5. After sign-in, the normal Company initialization flow begins when no Company exists.

The runtime secret used to sign sessions is generated under ignored local runtime storage at `.runtime/auth/owner-session-secret`. A deployment may instead supply `TINYOFFICE_AUTH_SECRET`. Backup and restore procedures must treat the database and this secret as one authentication state.

## Request boundary

`/api/auth/*` is the Better Auth protocol surface. `GET /api/tinyoffice/auth/status` exposes only whether the browser is authenticated and whether first-owner bootstrap is required. All other `/api/*` product routes require a verified session before their route handler runs.

Tests do not activate a product authentication mode. Focused API tests inject an internal `TestAuthProvider`; this provider is not reachable from the runtime launcher or production configuration.

## Deployment boundary

- Plain HTTP is permitted only on `localhost`, because WebAuthn requires a secure context.
- Non-local deployments must use HTTPS and set `TINYOFFICE_PUBLIC_ORIGIN` to the exact public origin.
- The PostgreSQL connection and `.runtime/auth/owner-session-secret` are private deployment state.
- TinyOffice must not be exposed with a guessed default secret, identity header, URL identity selector, or reverse-proxy identity fallback.

Authentication protects application access. Host patching, TLS certificate operations, firewall policy, database backup encryption, and operating-system isolation are separate deployment-hardening responsibilities.

## Recovery boundary

The Owner should register more than one passkey before relying on TinyOffice as durable infrastructure. If every passkey is lost, stop TinyOffice and run `npm run auth:reset-owner -- --confirm RESET-OWNER-AUTH` against the intended database. The command deletes passkeys and sessions but preserves the Owner profile and Company data. Restarting TinyOffice then prints a new one-time bootstrap URL. Recovery is deliberately local and is never exposed as an unauthenticated browser endpoint.

## Implementation map

| Responsibility | Source |
| --- | --- |
| Better Auth and passkey provider | `src/auth/better-auth-owner.ts` |
| Request-scoped authenticated session | `src/auth/tinyoffice-session.ts` |
| Authentication route and middleware composition | `src/api/tinyoffice-api.ts`, `src/api/tinyoffice-api/authentication-routes.ts` |
| PostgreSQL schema | `src/runtime/company-config/postgres-schema.ts` |
| Browser authentication gate | `apps/tinyoffice-web-shadcn/src/auth/OwnerAuthGate.tsx` |
| Formal local runtime launcher | `scripts/runtime/run-tinyoffice.ts` |

## Verification

- An unauthenticated product API returns `401`.
- Arbitrary identity headers and URL identity parameters do not change the Owner.
- A valid passkey creates a database-backed session cookie and unlocks the app.
- Restarting TinyOffice preserves the configured Owner and requires normal passkey sign-in when the session is absent or expired.
- A clean database presents Owner bootstrap before Company onboarding.
