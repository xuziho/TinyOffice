# First-user Onboarding Acceptance

Use this runbook to verify a clean TinyOffice installation without deleting or reusing an existing local Company. The acceptance runs on the local machine, but it uses a dedicated PostgreSQL container, database, runtime ports, and synthetic preview identity.

## Isolation boundary

The example values below are deliberately separate from the normal preview:

| Resource | Normal preview | Onboarding acceptance |
| --- | --- | --- |
| PostgreSQL container | `tinyoffice-postgres` | `tinyoffice-onboarding-postgres` |
| PostgreSQL port | `55432` | `55434` |
| Runtime API | `8095` | `8097` |
| Web app | `5175` | `5177` |
| User id | operator-specific | `onboarding-user-001` |

Do not reset, delete, or repoint the normal preview database for this acceptance.

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

Initialize the schema and start the preview:

```powershell
$env:TINYOFFICE_DATABASE_URL = "postgresql://tinyoffice_onboarding:tinyoffice_onboarding_dev@127.0.0.1:55434/tinyoffice_onboarding?sslmode=disable"
npm run runtime:postgres:init-schema

$env:TINYOFFICE_PREVIEW_USER_ID = "onboarding-user-001"
$env:TINYOFFICE_PREVIEW_USER_DISPLAY_NAME = "First User"
Remove-Item Env:TINYOFFICE_PREVIEW_COMPANY_ID -ErrorAction SilentlyContinue
$env:TINYOFFICE_RUNTIME_PREVIEW_PORT = "8097"
$env:TINYOFFICE_WEB_PREVIEW_PORT = "5177"
node --import tsx scripts/runtime/run-real-chat-preview.ts
```

Open `http://127.0.0.1:5177/`.

## Acceptance sequence

1. Confirm the app enters the Organization initialization surface and does not show seeded Companies, Channels, Topics, or DMs.
2. Create a Company with a Company name and HR name. Runtime models may remain `Set later`.
3. Confirm the Company becomes current and normal navigation unlocks.
4. Confirm `/api/tinyoffice/session/current` reports the synthetic user as the Company `boss` with `needsInitialization: false`.
5. Confirm Chat shows the named HR as a direct-message participant.
6. Stop and restart the preview with the same environment variables, without setting `TINYOFFICE_PREVIEW_COMPANY_ID`.
7. Confirm the same Company remains current after reload. This must come from `user_profiles.current_company_id`; session resolution must not guess the first Company membership.

## Identity boundary

The current local preview does not provide account registration or password login. `TINYOFFICE_PREVIEW_USER_ID` supplies the development-only user identity before startup. Company creation uses that current session identity to create the owner member and persists the created Company as the user's current Company. Settings may later change the display name and avatar, but not the stable user id.

Production identity must come from a deliberate backend authentication and session design. Do not turn preview environment variables or URL parameters into production login behavior.

## Cleanup

Stop the preview process, then remove only the isolated acceptance container when the evidence is no longer needed:

```powershell
docker rm -f tinyoffice-onboarding-postgres
```

Never substitute `tinyoffice-postgres` in the cleanup command.
