# First-user Onboarding Acceptance

Use this runbook to verify a clean TinyOffice installation without deleting or reusing the normal local database. The acceptance environment has its own PostgreSQL container, ports, authentication secret, and Owner passkey.

## Isolation boundary

| Resource | Normal runtime | Onboarding acceptance |
| --- | --- | --- |
| PostgreSQL container | `tinyoffice-postgres` | `tinyoffice-onboarding-postgres` |
| PostgreSQL port | `55432` | `55434` |
| Runtime API | `8095` | `8097` |
| Web app | `5175` | `5177` |
| Runtime directory | repository `.runtime/` | a fresh clone or isolated checkout |

Do not reset, delete, or repoint the normal database for this acceptance.

## Start a clean environment

Create the isolated database once:

```powershell
docker run --name tinyoffice-onboarding-postgres `
  -e POSTGRES_USER=tinyoffice_onboarding `
  -e POSTGRES_PASSWORD=tinyoffice_onboarding_dev `
  -e POSTGRES_DB=tinyoffice_onboarding `
  -p 127.0.0.1:55434:5432 `
  -d postgres:18-alpine
```

From a fresh clone or isolated checkout, initialize and start TinyOffice:

```powershell
$env:TINYOFFICE_DATABASE_URL = "postgresql://tinyoffice_onboarding:tinyoffice_onboarding_dev@127.0.0.1:55434/tinyoffice_onboarding?sslmode=disable"
$env:TINYOFFICE_RUNTIME_PORT = "8097"
$env:TINYOFFICE_WEB_PORT = "5177"
$env:TINYOFFICE_PUBLIC_ORIGIN = "http://localhost:5177"
npm run runtime:postgres:init-schema
npm start
```

Startup prints a one-time local Owner access URL. Open that exact URL. Local acceptance does not require an operating-system passkey prompt; the URL is exchanged once for the standard database-backed Owner session.

## Acceptance sequence

1. Confirm opening the root URL without the private launcher ticket presents the local Owner access gate, not the Company UI.
2. Open the launcher URL and confirm TinyOffice enters the authenticated Owner session without a visible token field or Windows Hello prompt.
3. Confirm the app enters Owner profile setup and does not show seeded Companies, Channels, Topics, or DMs.
4. Set the Owner display name and avatar, then confirm `session/current` reports `needsProfileInitialization: false` and `needsCompanyInitialization: true`.
5. Create a Company with a Company name and HR name. Runtime models may remain `Set later`.
6. Confirm the Company becomes current and normal navigation unlocks.
7. Confirm `/api/tinyoffice/session/current` reports the authenticated Owner as the Company `boss`, with both initialization flags `false`.
8. Confirm Chat shows the named HR as a direct-message participant and ordinary UI does not use account, Company, member, or employee ids as display labels.
9. Rename the Company in Organization. Confirm the new display name appears while the API still returns the original immutable `companyId`.
10. Stop and restart with the same database, origin, ports, and `.runtime/auth/owner-session-secret`.
11. Confirm the same browser session remains authenticated, the Owner profile remains initialized, and the same Company remains current. This must come from the authenticated Owner plus `user_profiles.current_company_id`; session resolution must not guess the first Company membership.
12. Confirm a private/incognito browser cannot open product APIs or the app without a fresh local launcher ticket.

Run a separate remote-mode acceptance behind HTTPS before an Internet-facing release. That acceptance must confirm first-owner Passkey bootstrap, normal Passkey sign-in, exact-origin enforcement, and rejection of the local-ticket endpoint.

## Identity boundary

The Owner id comes from the authenticated account. Environment variables, URL parameters, request headers, and browser request bodies must not select it. Company creation uses this account to create the first boss member. Settings may change the display name and avatar, while Company roles remain Company-governed.

## Cleanup

Stop TinyOffice, then remove only the isolated acceptance container when its evidence is no longer needed:

```powershell
docker rm -f tinyoffice-onboarding-postgres
```

Never substitute `tinyoffice-postgres` in the cleanup command.
