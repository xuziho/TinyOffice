# Production Releases

TinyOffice supports a real-use Alpha boundary: local development may continue on branches and `main`, while a mini-host runs an explicit immutable Release. Pushing or merging source code does not authorize a deployment.

## Ownership model

- TinyOffice owns version metadata, append-only database migrations, verified backup and restore semantics, readiness diagnostics, and the allowed update contract.
- An external supervisor executes installation, service replacement, restart, and code rollback because the running web process cannot safely replace itself.
- An AI operator may invoke these deterministic entries, inspect evidence, and diagnose exceptional failures. It must not invent a different deployment layout, reset production data, or install an unapproved branch.

## Release artifact

Run `npm run build:production-release` in a clean supported build checkout. It refuses uncommitted tracked changes, builds the standalone frontend, and creates `.release/tinyoffice-<version>-<commit>.tgz` plus a matching `.sha256`. The artifact contains runtime source, the production entry, PI tool packages, the stable update manifest, lockfiles, notices, and static web assets. It deliberately excludes both development `node_modules` trees, tests, local Companies, runtime data, logs, and credentials.

The target host extracts a Release under an immutable `releases/<release-id>` directory and runs `npm ci --omit=dev`. The production entry is `npm run start:production`; it serves the built frontend from `public/` and never starts Vite. Production requires explicit `TINYOFFICE_DEPLOYMENT_MODE=production`, `TINYOFFICE_DATABASE_URL`, `TINYOFFICE_PUBLIC_ORIGIN`, and `TINYOFFICE_AUTH_SECRET` configuration.

The repository includes `scripts/release/install-production-release.sh` as the first guarded Linux executor. It requires the expected SHA-256, a host-level `shared/tinyoffice.env`, a supported application root, and `TINYOFFICE_DEPLOYMENT_MODE=production`. It creates a verified pre-update backup when a current Release exists, installs production dependencies, applies pending migrations, switches the active Release, restarts the user service, and checks `/ready`. If readiness fails before a migration was needed, it switches code back. Once a migration has been applied, it deliberately refuses automatic code rollback because the old code may not understand the new schema; recovery uses the retained previous Release and verified backup. It never performs `git pull` or resets PostgreSQL.

## Persistent instance boundary

Program files are replaceable. These roots are persistent and must survive Release replacement:

- PostgreSQL database and its Docker volume;
- `companies/` Company, employee, Skill, instruction, workspace, and branding files;
- `.data/companies/` Chat attachment bytes;
- `.runtime/` local runtime identity material when not supplied through deployment secrets;
- verified backups, preferably under a host-level backup root with an off-machine copy;
- deployment environment and secrets, stored outside every Release.

The initial executor may expose these persistent roots inside each Release with controlled links because current runtime repositories resolve Company assets from `repoRoot`. It must never copy old data into a new version and then allow both copies to diverge.

## Update sequence

1. Resolve an exact approved target Release and verify its checksum.
2. Verify Node.js, PostgreSQL, disk space, persistent-root permissions, current schema, and service ownership.
3. Extract the target into a new immutable Release directory and install production dependencies only while the current service remains available.
4. Stop TinyOffice writes, then create and verify a full-instance backup associated with the source and target versions.
5. Apply pending append-only migrations and atomically switch the active Release. A backup or migration failure restarts the unchanged prior Release.
6. Restart the service, check liveness and readiness, then run focused authentication, Chat, realtime, and employee-runtime smoke checks.
7. Record success or preserve structured failure evidence. Code rollback switches to the prior Release only when no migration was applied; otherwise recovery uses the verified pre-update backup instead of pretending that code rollback is safe.

`runtime:postgres:reset` is a local test/development command and refuses to run when `TINYOFFICE_DEPLOYMENT_MODE=production`.

## Operations surfaces

- `/health` remains a cheap process-liveness signal.
- readiness must prove database/schema/static-assets/persistent-root availability before a Release is accepted.
- Operations > Health provides deeper read-only operator diagnostics.
- Operations > Backup & Restore owns verified instance snapshots, not scheduling or remote-storage credentials.
- Operations > Updates displays approved Release state and submits work to an external executor. The current PI-only executor boundary is an intermediate implementation, not the final whole-product update contract.
