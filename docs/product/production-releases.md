# Production Releases

TinyOffice supports a real-use Alpha boundary: local development may continue on branches and `main`, while a mini-host runs an explicit immutable Release. Pushing or merging source code does not authorize a deployment.

## Ownership model

- TinyOffice owns version metadata, append-only database migrations, verified backup and restore semantics, readiness diagnostics, and the allowed update contract.
- An external supervisor executes installation, service replacement, restart, and code rollback because the running web process cannot safely replace itself.
- An AI operator may invoke these deterministic entries, inspect evidence, and diagnose exceptional failures. It must not invent a different deployment layout, reset production data, or install an unapproved branch.

## Release artifact

Run `npm run build:production-release` in a clean supported build checkout. It refuses uncommitted tracked changes, builds the standalone frontend, and creates `.release/tinyoffice-<version>-<commit>.tgz` plus a matching `.sha256`. The artifact contains runtime source, the production entry, PI tool packages, the stable update manifest, lockfiles, notices, and static web assets. It deliberately excludes both development `node_modules` trees, tests, local Companies, runtime data, logs, and credentials.

The target host extracts a Release under an immutable `releases/<release-id>` directory and runs `npm ci --omit=dev`. The production entry is `npm run start:production`; it serves the built frontend from `public/` and never starts Vite. Production requires explicit `TINYOFFICE_DEPLOYMENT_MODE=production`, `TINYOFFICE_DATABASE_URL`, `TINYOFFICE_PUBLIC_ORIGIN`, and `TINYOFFICE_AUTH_SECRET` configuration.

The repository includes `scripts/release/install-production-release.sh` as the first guarded Linux executor. It requires the expected SHA-256, a host-level `shared/tinyoffice.env`, a supported application root, and `TINYOFFICE_DEPLOYMENT_MODE=production`. It creates a verified pre-update backup when a current Release exists, installs production dependencies, applies pending migrations, switches the active Release, restarts the user service, and checks `/ready`. Only after readiness succeeds, it prunes `shared/.data/backups/pre-update` to the newest three complete backup-and-receipt pairs; manual and other backup roots are outside this policy. A retention failure is reported without marking an otherwise healthy Release as failed. If readiness fails before a migration was needed, it switches code back. Once a migration has been applied, it deliberately refuses automatic code rollback because the old code may not understand the new schema; recovery uses the retained previous Release and verified backup. It never performs `git pull` or resets PostgreSQL.

## PI model readiness

TinyOffice uses the PI model registry for employee and System AI models. A successful Codex login on the host does not configure PI: `~/.codex/auth.json` and PI's `auth.json` are separate credential stores, and TinyOffice does not copy or reuse Codex credentials.

Before first-Company onboarding, configure PI for the same operating-system account that runs `tinyoffice.service`. By default TinyOffice reads `$HOME/.pi/agent/auth.json` and `$HOME/.pi/agent/models.json`; an explicit `PI_CODING_AGENT_DIR` changes that root and must be present in the service environment. Provider API keys supplied through the service environment are also resolved by PI. Never place these credentials inside an immutable Release.

Do not treat the presence or non-zero size of `auth.json` as proof of readiness: an empty JSON object is a valid file but exposes no models. Run this check as the service account from the active Release:

```bash
cd "${TINYOFFICE_APP_ROOT:?set TINYOFFICE_APP_ROOT}/current"
node --import tsx --input-type=module <<'NODE'
import { loadPiModelState } from "./src/runtime/company-config/employees-admin.ts";

const { availableModels } = await loadPiModelState();
if (availableModels.length === 0) {
  console.error("PI model registry is empty for the TinyOffice service account.");
  process.exit(1);
}
console.log(availableModels.map(({ provider, id }) => `${provider}/${id}`).join("\n"));
NODE
```

Load the same host-level deployment environment used by the service before running the command. The command prints model identifiers, not credentials. An empty result means the deployment is not employee-runtime ready: Company onboarding will show only `Set later` for both the initial HR and System AI, and employees cannot run until PI authentication or a custom model definition is configured.

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
2. Verify Node.js, PostgreSQL, disk space, persistent-root permissions, current schema, service ownership, and a non-empty PI model registry for the service account.
3. Extract the target into a new immutable Release directory and install production dependencies only while the current service remains available.
4. Stop TinyOffice writes, then create and verify a full-instance backup associated with the source and target versions.
5. Apply pending append-only migrations and atomically switch the active Release. A backup or migration failure restarts the unchanged prior Release.
6. Restart the service, check liveness and readiness, re-run PI model enumeration, then run focused authentication, Chat, realtime, and employee-runtime smoke checks.
7. Record success or preserve structured failure evidence. Code rollback switches to the prior Release only when no migration was applied; otherwise recovery uses the verified pre-update backup instead of pretending that code rollback is safe.

## Stable-channel delivery

TinyOffice application Releases and PI dependency approval are separate contracts. `updates/stable.json` approves the PI package and model catalog. A published GitHub Release carries `tinyoffice-stable.json`, which approves one exact TinyOffice artifact, commit, checksum, and minimum Node.js version.

Pushing `main` never updates a production host. Publishing is deliberate:

1. Batch ordinary fixes on `main`; urgent production failures may use a focused hotfix.
2. Update `package.json` to the intended version and create the matching `v<version>` Git tag only after CI passes.
3. `.github/workflows/release.yml` re-runs checks and tests, builds the immutable archive, creates its SHA-256 and stable-channel manifest, cold-smokes the packaged server, and uploads all three files to one GitHub Release.
4. Production checks only the published stable-channel manifest. It never treats a branch head or an untagged commit as installable.

This keeps Release safety inexpensive: the workflow is automated, while Release frequency remains a product decision. Small low-impact fixes may be batched; security, authentication, data, or severe messaging defects may be released immediately.

## External updater

The first host executor is `tinyoffice-updater.service`, a separate systemd user oneshot. The TinyOffice web process writes a narrow job containing only the approved `releaseId` and asks systemd to start that fixed unit. The updater independently re-downloads the stable manifest, requires the same `releaseId`, downloads the artifact, verifies SHA-256, and invokes `install-production-release.sh`. It cannot accept an arbitrary URL, Git branch, shell command, or database reset request.

Update evidence is stored below the shared `.runtime/updates/` root, so it survives Release replacement and the browser can reconcile after the service restart. Operations > Updates polls that evidence while the external updater downloads, verifies, installs, restarts, and completes or fails.

Configure the host with both `tinyoffice.service` and `tinyoffice-updater.service`, plus `TINYOFFICE_UPDATE_EXECUTOR=systemd`. Without that explicit executor setting, the UI remains read-only and explains that the host is not configured for one-click installation.

The first Release that introduces this updater is a bootstrap exception: an older host cannot invoke a service and API it does not yet contain. Install that one Release with the existing guarded `install-production-release.sh`, add the updater unit and environment entries, and verify them once. Every later approved Release can use the product update flow.

`runtime:postgres:reset` is a local test/development command and refuses to run when `TINYOFFICE_DEPLOYMENT_MODE=production`.

## Operations surfaces

- `/health` remains a cheap process-liveness signal.
- readiness must prove database/schema/static-assets/persistent-root availability before a Release is accepted.
- Operations > Health provides deeper read-only operator diagnostics.
- Operations > Backup & Restore owns verified instance snapshots, not scheduling or remote-storage credentials.
- Operations > Updates separates the installed/approved TinyOffice Release from PI dependency visibility, submits an exact approved Release to the external executor, and reconciles persistent job evidence after restart.
