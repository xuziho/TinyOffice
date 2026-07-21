# Update Center

Operations / Updates at `/updates` is the product surface for controlled TinyOffice Release and dependency updates. It separates upstream discovery from installation approval and keeps instance maintenance out of the Owner's personal Settings.

## Product Contract

- The npm registry reports whether `@earendil-works/pi-coding-agent` has published a newer version.
- The TinyOffice stable manifest at `updates/stable.json`, refreshed from the official `main` branch through the GitHub Contents API, declares the exact PI version TinyOffice has validated, its minimum Node.js version, and its approved OpenAI Codex model catalog.
- The approved TinyOffice Release is discovered through the GitHub Releases API. TinyOffice locates the exact `tinyoffice-stable.json` asset and downloads it through the asset API instead of depending on the redirect-heavy `releases/latest/download` path.
- An npm release newer than the installed version is shown as `Awaiting approval` until the stable manifest approves it.
- Only an approved version can become `Ready to install`.
- The browser never runs npm, shell commands, service restarts, or rollback logic directly.
- `Back up and install` is enabled only when the runtime prerequisites pass and the deployment supplies an external update executor.
- An update executor must create a verified backup, install only the manifest version, run verification, restart the runtime, and preserve a rollback path. A local preview without such a supervisor reports the missing executor explicitly instead of presenting a fake working button.

## API

`GET /api/tinyoffice/updates` returns the installed TinyOffice and PI versions, npm latest version, approved version, Node compatibility, model catalog changes, source warnings, and installation eligibility.

Each remote update source receives one bounded retry when the first attempt fails with a transport error, timeout, rate limit, or retryable server response. Non-retryable HTTP responses, malformed JSON, and invalid manifests fail immediately. If both attempts fail, the update check remains fail-closed and cannot authorize installation.

The default GitHub API requests identify themselves as `TinyOffice-update-check`. Explicit `TINYOFFICE_UPDATE_MANIFEST_URL` and `TINYOFFICE_RELEASE_MANIFEST_URL` overrides remain direct JSON endpoints for controlled private mirrors or test environments; TinyOffice does not silently fall back from an unavailable official source to an older manifest.

`POST /api/tinyoffice/updates` requests installation of the exact currently approved version. It fails closed when no external update executor is configured, the runtime is incompatible, update sources cannot be checked, or the approved version is already installed.

Both routes require the current TinyOffice user session. They are instance-scoped rather than Company-scoped because application code and runtime dependencies are shared by every Company.

## Stable Manifest

The bundled manifest is a safe offline fallback. The remote manifest is the update approval source. Updating the npm package alone does not approve installation. A TinyOffice maintainer first validates the dependency change, tests it, records runtime requirements and model catalog changes in the manifest, and merges that manifest through the normal repository workflow.

## Current Boundary

The first implementation provides live PI monitoring, approval state, runtime prerequisite checks, model catalog comparison, and the controlled executor boundary. The local development preview intentionally does not mutate its own checkout or restart itself.

The production Release foundation adds a versioned artifact, production-only dependency installation, static frontend serving, `/ready`, protected production reset behavior, shared persistent roots, and the guarded Linux executor in `scripts/release/install-production-release.sh`. During real-use Alpha, an external Codex operator may invoke that executor and diagnose exceptional failures. The browser still does not execute shell commands itself, and the current POST contract remains disabled until a separately supervised executor is configured.

The next manifest revision will promote TinyOffice Release version, artifact checksum, schema compatibility, and rollback evidence to first-class update fields rather than treating PI as the only install target. See [Production Releases](production-releases.md).
