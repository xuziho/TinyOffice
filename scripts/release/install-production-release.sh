#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${1:-}"
EXPECTED_SHA256="${2:-}"
APP_ROOT="${TINYOFFICE_APP_ROOT:-$HOME/apps/tinyoffice}"
SERVICE="${TINYOFFICE_SYSTEMD_SERVICE:-tinyoffice.service}"

if [[ -z "$ARCHIVE" || -z "$EXPECTED_SHA256" ]]; then
  echo "Usage: install-production-release.sh <release.tgz> <sha256>" >&2
  exit 2
fi
ARCHIVE="$(readlink -f "$ARCHIVE")"
mkdir -p "$APP_ROOT/releases" "$APP_ROOT/shared/companies" "$APP_ROOT/shared/.data" "$APP_ROOT/shared/.runtime" "$APP_ROOT/shared/.scratch"
APP_ROOT="$(readlink -f "$APP_ROOT")"
case "$APP_ROOT" in
  "$HOME"/apps/tinyoffice|/opt/tinyoffice) ;;
  *) echo "Refusing unsupported TinyOffice app root: $APP_ROOT" >&2; exit 2 ;;
esac

ACTUAL_SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "Release checksum mismatch." >&2
  exit 3
fi

ENV_FILE="$APP_ROOT/shared/tinyoffice.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production environment: $ENV_FILE" >&2
  exit 4
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
if [[ "${TINYOFFICE_DEPLOYMENT_MODE:-}" != "production" ]]; then
  echo "TINYOFFICE_DEPLOYMENT_MODE=production is required." >&2
  exit 4
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$ARCHIVE" -C "$WORK"
RELEASE_DIR_SOURCE="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'tinyoffice-*' -print -quit)"
if [[ -z "$RELEASE_DIR_SOURCE" || ! -f "$RELEASE_DIR_SOURCE/RELEASE.json" ]]; then
  echo "Archive is not a TinyOffice production Release." >&2
  exit 5
fi
RELEASE_ID="$(node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(p.schema!=="tinyoffice-production-release"||!p.releaseId||!p.tinyOfficeVersion||!p.gitCommit) process.exit(1); process.stdout.write(p.releaseId)' "$RELEASE_DIR_SOURCE/RELEASE.json")"
if [[ ! "$RELEASE_ID" =~ ^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$ ]]; then
  echo "Release id is unsafe." >&2
  exit 5
fi
TARGET="$APP_ROOT/releases/$RELEASE_ID"
if [[ -e "$TARGET" ]]; then
  echo "Release already exists: $TARGET" >&2
  exit 5
fi

PREVIOUS=""
if [[ -L "$APP_ROOT/current" ]]; then
  PREVIOUS="$(readlink -f "$APP_ROOT/current")"
fi

mv "$RELEASE_DIR_SOURCE" "$TARGET"
for persistent in companies .data .runtime .scratch; do
  rm -rf "$TARGET/$persistent"
  ln -s "$APP_ROOT/shared/$persistent" "$TARGET/$persistent"
done

echo "Installing production dependencies for TinyOffice $RELEASE_ID"
if ! (cd "$TARGET" && npm ci --omit=dev); then
  rm -rf "$TARGET"
  echo "Production dependency installation failed; the inactive target Release was removed." >&2
  exit 6
fi

SERVICE_WAS_ACTIVE=0
if systemctl --user is-active --quiet "$SERVICE"; then
  SERVICE_WAS_ACTIVE=1
  systemctl --user stop "$SERVICE"
fi

if [[ -n "$PREVIOUS" ]]; then
  echo "Creating verified pre-update backup from $PREVIOUS"
  if ! (cd "$PREVIOUS" && node --import tsx src/cli/agentco.ts backup create --output "$APP_ROOT/shared/.data/backups/pre-update" --json); then
    if [[ "$SERVICE_WAS_ACTIVE" -eq 1 ]]; then systemctl --user start "$SERVICE"; fi
    rm -rf "$TARGET"
    echo "Pre-update backup failed; the active Release was not changed." >&2
    exit 6
  fi
fi

echo "Applying pending append-only migrations"
if ! MIGRATION_OUTPUT="$(cd "$TARGET" && TINYOFFICE_RELEASE_VERSION="$RELEASE_ID" node --import tsx scripts/runtime/init-tinyoffice-postgres-schema.ts)"; then
  if [[ "$SERVICE_WAS_ACTIVE" -eq 1 ]]; then systemctl --user start "$SERVICE"; fi
  rm -rf "$TARGET"
  echo "Database migration failed; the active Release was not changed." >&2
  exit 6
fi
echo "$MIGRATION_OUTPUT"
MIGRATIONS_APPLIED=1
if [[ "$MIGRATION_OUTPUT" == *"PostgreSQL schema is already current."* ]]; then
  MIGRATIONS_APPLIED=0
fi

rm -f "$APP_ROOT/current.next"
ln -s "$TARGET" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
RESTART_ACCEPTED=1
if ! systemctl --user restart "$SERVICE"; then
  RESTART_ACCEPTED=0
  echo "TinyOffice service restart was rejected; evaluating the guarded rollback boundary." >&2
fi

READY_URL="${TINYOFFICE_INTERNAL_ORIGIN:-http://127.0.0.1:8095}/ready"
if [[ "$RESTART_ACCEPTED" -eq 1 ]]; then
  for attempt in {1..30}; do
    if curl --fail --silent --show-error "$READY_URL" >/dev/null; then
      echo "TinyOffice $RELEASE_ID is ready."
      exit 0
    fi
    sleep 1
  done
fi

echo "TinyOffice $RELEASE_ID failed readiness." >&2
if [[ -n "$PREVIOUS" && "$MIGRATIONS_APPLIED" -eq 0 ]]; then
  echo "Restoring previous code Release: $PREVIOUS" >&2
  rm -f "$APP_ROOT/current.rollback"
  ln -s "$PREVIOUS" "$APP_ROOT/current.rollback"
  mv -Tf "$APP_ROOT/current.rollback" "$APP_ROOT/current"
  systemctl --user restart "$SERVICE" || echo "Previous Release restart also failed; inspect the user service journal." >&2
elif [[ "$MIGRATIONS_APPLIED" -eq 1 ]]; then
  echo "A database migration was applied; automatic code rollback is unsafe." >&2
  if [[ -n "$PREVIOUS" ]]; then
    echo "The previous Release remains at $PREVIOUS and the verified backup is under shared/.data/backups/pre-update." >&2
  else
    echo "This was the first installed Release, so there is no previous code Release to restore." >&2
  fi
fi
exit 6
