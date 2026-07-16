# Publish And Install A Production Release

Use this runbook only after the target commit is merged, CI is green, and the user has explicitly authorized a production Release.

## Publish

1. Choose whether ordinary fixes should be batched or an urgent hotfix is justified.
2. Update the root `package.json` version and lockfile together.
3. Run the complete local checks appropriate for the change.
4. Create and push the exact matching tag, for example `v0.1.0-alpha.2`.
5. Wait for `Publish production Release` to complete. It refuses a tag that does not match `package.json`.
6. Confirm the GitHub Release contains the `.tgz`, `.tgz.sha256`, and `tinyoffice-stable.json` assets.

Do not upload a locally modified archive under an existing tag. Release artifacts are immutable; publish a new version instead.

## Configure A Mini-Host Once

The first updater-capable Release must still be installed with the guarded CLI installer because the previous Release does not contain the updater. Configure the units below immediately after that bootstrap install; subsequent Releases can be installed from Operations > Updates.

Install the examples as systemd user units for the operating-system account that owns TinyOffice:

```bash
mkdir -p ~/.config/systemd/user
cp "$TINYOFFICE_APP_ROOT/current/deploy/systemd/tinyoffice.service.example" ~/.config/systemd/user/tinyoffice.service
cp "$TINYOFFICE_APP_ROOT/current/deploy/systemd/tinyoffice-updater.service.example" ~/.config/systemd/user/tinyoffice-updater.service
systemctl --user daemon-reload
systemctl --user enable tinyoffice.service
```

If `TINYOFFICE_APP_ROOT` is not the default home-directory layout, adjust both unit `WorkingDirectory` values deliberately. Keep `tinyoffice.env` under the shared host root and include:

```dotenv
TINYOFFICE_DEPLOYMENT_MODE=production
TINYOFFICE_UPDATE_EXECUTOR=systemd
TINYOFFICE_UPDATER_SYSTEMD_SERVICE=tinyoffice-updater.service
TINYOFFICE_RELEASE_MANIFEST_URL=https://github.com/xuziho/TinyOffice/releases/latest/download/tinyoffice-stable.json
```

Run the PI model enumeration preflight from the product Production Releases page after any host or service-account change.

## Install From TinyOffice

1. Open Operations > Updates and refresh the stable channel.
2. Review installed and approved Release ids, required Node version, notes, and warnings.
3. Select **Back up and install**.
4. Leave the page open. A brief disconnect is expected while `tinyoffice.service` restarts; the page resumes polling when the service returns.
5. Require a completed job plus successful readiness, authentication, Chat, realtime, and employee-runtime smoke evidence before declaring the deployment complete.

If the updater fails, inspect:

```bash
systemctl --user status tinyoffice-updater.service
journalctl --user -u tinyoffice-updater.service -n 200 --no-pager
cat "$TINYOFFICE_APP_ROOT/shared/.runtime/updates/latest.json"
```

Never repair a failed production update with `runtime:postgres:reset` or an improvised `git pull`. Follow the migration-aware recovery boundary in the Production Releases page.
