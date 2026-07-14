# Owner Authentication

TinyOffice is a one-person-company workspace. Its authentication model therefore has one human account, **Owner**, rather than public registration, teams of human users, or a development-only identity selector.

## Product decision

- TinyOffice supports exactly one authenticated human Owner.
- Remote access uses a WebAuthn passkey as the primary credential. TinyOffice does not store an Owner password.
- Better Auth owns credential verification, signed server sessions, session expiry, cookie security, and request throttling.
- PostgreSQL is the source of truth for the Owner account, passkeys, and sessions.
- Company membership and Company role remain separate product records. Authentication proves the human Owner account; the active Company session resolves that account to its current Company member.
- Local loopback use and remote deployed use create the same Better Auth Owner account and PostgreSQL-backed session. They differ only at the proof-of-access step: the local launcher issues a one-time loopback access ticket, while a remote deployment requires a passkey.
- Environment variables, request headers, arbitrary URL parameters, and request bodies cannot select the current human identity.

This is a durable single-Owner foundation, not an enterprise identity system. A future external OIDC provider may authenticate the same Owner account, but must enter through the same verified server-session boundary.

## Access modes

TinyOffice derives its access mode from the exact `TINYOFFICE_PUBLIC_ORIGIN`:

- `http://localhost:<port>` is **local mode**. Runtime startup creates an in-memory, one-time local access ticket and prints a private launcher URL. Opening that URL exchanges the ticket for the normal Better Auth Owner session cookie. The browser does not show a setup-token field or require Windows Hello. The ticket is accepted only by a local-mode runtime, is never returned by a public status API, and is invalidated after one successful exchange.
- `https://<host>` is **remote mode**. Passkey bootstrap and passkey sign-in are required. Plain HTTP remote origins are rejected.

Both modes resolve the same single Owner identity and use the same `auth_users` and `auth_sessions` tables. Local mode is not an identity bypass, an HTTP-header fallback, or a second account system.

## Local first use

1. Start TinyOffice with `npm start`.
2. Open the private local URL printed in the terminal.
3. TinyOffice creates or resolves the single Owner account, exchanges the one-time local ticket, and establishes the normal 30-day sliding session.
4. TinyOffice initializes the Owner profile first, then begins first-Company setup when no Company exists.

If the local browser cookie is cleared while the runtime is still running and the one-time URL has already been consumed, restart TinyOffice to generate a fresh local launcher URL.

## Remote first-owner bootstrap

When remote mode has no passkey, runtime startup creates an in-memory one-time bootstrap token and prints a setup URL. The browser receives the token only through that private URL; it does not ask the user to copy a raw token. The token is never returned by a public status API and is invalidated after the first passkey is verified.

1. Start TinyOffice with `npm start`.
2. Open the one-time URL printed in the terminal.
3. Confirm the operating-system passkey prompt.
4. TinyOffice creates the single Owner account, stores the passkey, and asks the new Owner to unlock the office.
5. After sign-in, TinyOffice initializes the Owner profile first, then begins first-Company setup when no Company exists.

The runtime secret used to sign sessions is generated under ignored local runtime storage at `.runtime/auth/owner-session-secret`. A deployment may instead supply `TINYOFFICE_AUTH_SECRET`. Backup and restore procedures must treat the database and this secret as one authentication state. Sessions expire after 30 days of inactivity and slide forward while the Owner continues using TinyOffice.

## Request boundary

`/api/auth/*` is the Better Auth protocol surface. `GET /api/tinyoffice/auth/status` exposes the access mode, authentication state, and whether remote first-owner bootstrap is required; it never exposes a bootstrap token or local ticket. All other `/api/*` product routes require a verified session before their route handler runs.

Tests do not activate a product authentication mode. Focused API tests inject an internal `TestAuthProvider`; this provider is not reachable from the runtime launcher or production configuration.

## Deployment boundary

- Plain HTTP is permitted only when the parsed hostname is exactly `localhost`. Lookalike hosts such as `localhost.example.com` are rejected.
- Non-local deployments must use HTTPS and set `TINYOFFICE_PUBLIC_ORIGIN` to the exact public origin.
- The PostgreSQL connection and `.runtime/auth/owner-session-secret` are private deployment state.
- TinyOffice must not be exposed with a guessed default secret, identity header, URL identity selector, or reverse-proxy identity fallback.

Authentication protects application access. Host patching, TLS certificate operations, firewall policy, database backup encryption, and operating-system isolation are separate deployment-hardening responsibilities.

## Recovery boundary

For remote use, the Owner should register more than one passkey before relying on TinyOffice as durable infrastructure. If every passkey is lost, stop TinyOffice and run `npm run auth:reset-owner -- --confirm RESET-OWNER-AUTH` against the intended database. The command deletes passkeys and sessions but preserves the Owner profile and Company data. Restarting a remote deployment then prints a new one-time bootstrap URL. Recovery is deliberately local and is never exposed as an unauthenticated browser endpoint.

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
- A local launcher ticket can be consumed once, creates a database-backed Owner session, and cannot be used against a remote-mode runtime.
- A valid remote passkey creates a database-backed session cookie and unlocks the app.
- Invalid or expired bootstrap material returns a stable client error rather than a generic server failure.
- Restarting TinyOffice preserves the configured Owner. Local mode prints a fresh private launcher URL; remote mode requires normal passkey sign-in when the session is absent or expired.
- A clean database authenticates the Owner before Company onboarding.
