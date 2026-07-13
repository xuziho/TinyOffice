# Update Center

Settings / Updates is the product surface for controlled TinyOffice dependency updates. It separates upstream discovery from installation approval.

## Product Contract

- The npm registry reports whether `@earendil-works/pi-coding-agent` has published a newer version.
- The TinyOffice stable manifest at `updates/stable.json`, refreshed from the official `main` branch, declares the exact PI version TinyOffice has validated, its minimum Node.js version, and its approved OpenAI Codex model catalog.
- An npm release newer than the installed version is shown as `Awaiting approval` until the stable manifest approves it.
- Only an approved version can become `Ready to install`.
- The browser never runs npm, shell commands, service restarts, or rollback logic directly.
- `Back up and install` is enabled only when the runtime prerequisites pass and the deployment supplies an external update executor.
- An update executor must create a verified backup, install only the manifest version, run verification, restart the runtime, and preserve a rollback path. A local preview without such a supervisor reports the missing executor explicitly instead of presenting a fake working button.

## API

`GET /api/tinyoffice/updates` returns the installed TinyOffice and PI versions, npm latest version, approved version, Node compatibility, model catalog changes, source warnings, and installation eligibility.

`POST /api/tinyoffice/updates` requests installation of the exact currently approved version. It fails closed when no external update executor is configured, the runtime is incompatible, update sources cannot be checked, or the approved version is already installed.

Both routes require the current TinyOffice user session. They are instance-scoped rather than Company-scoped because application code and runtime dependencies are shared by every Company.

## Stable Manifest

The bundled manifest is a safe offline fallback. The remote manifest is the update approval source. Updating the npm package alone does not approve installation. A TinyOffice maintainer first validates the dependency change, tests it, records runtime requirements and model catalog changes in the manifest, and merges that manifest through the normal repository workflow.

## Current Boundary

The first implementation provides live monitoring, approval state, runtime prerequisite checks, model catalog comparison, and the controlled executor boundary. The local development preview intentionally does not mutate its own checkout or restart itself. A deployment supervisor or future `tinyoffice update` coordinator must implement the executor before one-click installation is enabled in that deployment.
