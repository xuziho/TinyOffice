# Backup and Restore

TinyOffice owns the creation, verification, inspection, and recovery semantics of a full-instance backup. External automation owns scheduling, off-machine transfer, retention, storage credentials, and notifications.

## Product boundary

The first supported backup scope is the complete TinyOffice instance. A backup contains:

- the PostgreSQL runtime database in PostgreSQL custom dump format;
- `companies/`, including Company and Employee Skills, employee instructions, workspaces, and branding;
- `.data/companies/`, including locally stored Chat attachment bytes;
- a versioned manifest with file sizes and SHA-256 checksums.

System provider credentials, API keys, `.env`, repository-level logs and scratch evidence, runtime pid files, source code, dependencies, and previous backups are not included. Employee workspaces are backed up as user data and may themselves contain private material. Treat every backup as sensitive, use a trusted destination or an encrypted rclone remote, and configure system secrets separately on the restored host.

Per-Company import/export is not part of disaster recovery. It requires identity remapping and conflict policy and must not be represented as a safe partial restore.

## Product and automation entries

Operations > Backup & Restore creates a verified local backup and offers a download. The browser uses an internal TinyOffice route, but that HTTP surface is not the external automation contract.

Scheduled automation uses the CLI:

```powershell
node --import tsx src/cli/agentco.ts backup create --output D:\TinyOfficeBackups --json
node --import tsx src/cli/agentco.ts backup inspect --from D:\TinyOfficeBackups\tinyoffice-....tobackup
node --import tsx src/cli/agentco.ts backup verify --from D:\TinyOfficeBackups\tinyoffice-....tobackup
```

The create command emits JSON and a non-zero exit code on failure. An external script may parse `path`, upload that immutable file with rclone or another provider tool, apply retention, and notify the operator. TinyOffice does not store cloud-drive credentials or embed provider-specific destinations.

## Restore safety

Restore is CLI-only in the first release. TinyOffice writes and employee runtimes must be stopped first. The command requires both maintenance acknowledgement and explicit confirmation:

```powershell
node --import tsx src/cli/agentco.ts backup restore --from D:\TinyOfficeBackups\tinyoffice-....tobackup --maintenance --confirm RESTORE
```

Restore verifies the complete archive before mutation and creates a fresh pre-restore safety backup. It restores PostgreSQL and managed file roots, then the operator runs Doctor and the normal local preview verification. A failed or unsupported manifest must stop before mutation.

## PostgreSQL tools

TinyOffice uses an explicitly configured `TINYOFFICE_PG_DUMP_PATH` / `TINYOFFICE_PG_RESTORE_PATH` when present, otherwise host `pg_dump` / `pg_restore`. If the host tools are absent in the standard local Docker deployment, it uses `tinyoffice-postgres`; `TINYOFFICE_POSTGRES_CONTAINER` can override that container name.

## Consistency

Backup files are immutable snapshots and the archive is verified after creation. If database/file evidence cannot be read or checksums do not match, creation fails and removes the incomplete archive. Restore is deliberately stricter and requires maintenance mode; online restore is unsupported.
