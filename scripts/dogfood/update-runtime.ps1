param(
    [string]$HostName = "agent-mini",
    [string]$RemoteAppPath = "/home/xu/apps/tinyoffice",
    [string]$RemoteService = "tinyoffice-realtime-intake",
    [string]$RemoteBundlePath = "/tmp/tinyoffice-dogfood-runtime.bundle",
    [switch]$RunTests,
    [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "shell-script-helpers.ps1")

function Run($FilePath, [string[]]$Arguments, [string]$WorkingDirectory = (Get-Location).Path) {
    Write-Host ">> $FilePath $($Arguments -join ' ')" -ForegroundColor Cyan
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
        }
    } finally {
        Pop-Location
    }
}

function Capture($FilePath, [string[]]$Arguments, [string]$WorkingDirectory = (Get-Location).Path) {
    Write-Host ">> $FilePath $($Arguments -join ' ')" -ForegroundColor DarkCyan
    $output = & $FilePath @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        $output | ForEach-Object { Write-Host $_ }
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
    return ($output -join "`n").Trim()
}

$repoRoot = Capture "git" @("rev-parse", "--show-toplevel")
Set-Location $repoRoot

$branch = Capture "git" @("rev-parse", "--abbrev-ref", "HEAD")
$commit = Capture "git" @("rev-parse", "HEAD")
$shortCommit = Capture "git" @("rev-parse", "--short=12", "HEAD")

Write-Host "Dogfood runtime update source: $branch @ $shortCommit" -ForegroundColor Green

Run "git" @("diff", "--quiet")
Run "git" @("diff", "--cached", "--quiet")

$untracked = Capture "git" @("ls-files", "--others", "--exclude-standard")
if ($untracked) {
    Write-Host "Untracked files are not included in the deployment bundle:" -ForegroundColor Yellow
    $untracked.Split("`n") | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
}

$bundleDir = Join-Path $repoRoot ".scratch\dogfood"
New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null
$bundlePath = Join-Path $bundleDir "tinyoffice-runtime-$shortCommit.bundle"
if (Test-Path $bundlePath) {
    Remove-Item -LiteralPath $bundlePath -Force
}

Run "git" @("bundle", "create", $bundlePath, "HEAD")
Run "scp" @($bundlePath, "${HostName}:$RemoteBundlePath")

$testCommand = ""
if ($RunTests) {
    $testCommand = "npm test"
}

$remoteScript = @"
set -euo pipefail
APP='$RemoteAppPath'
BUNDLE='$RemoteBundlePath'
SERVICE='$RemoteService'
DEPLOY_COMMIT='$commit'
DEPLOY_SHORT='$shortCommit'
TEST_COMMAND='$testCommand'

case "`$(readlink -f "`$APP")" in
  /home/xu/apps/tinyoffice) ;;
  /home/xu/apps/tinyoffice/*) ;;
  *) echo "Refusing to deploy outside /home/xu/apps/tinyoffice: `$APP" >&2; exit 1 ;;
esac

cd "`$APP"
CURRENT="`$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
echo "Remote current commit: `$CURRENT"
echo "Deploying commit: `$DEPLOY_SHORT"

git fetch "`$BUNDLE" HEAD
git checkout -B main FETCH_HEAD
git reset --hard FETCH_HEAD

npm ci
if [ -f packages/pi-web-tools/package.json ]; then
  (cd packages/pi-web-tools && npm ci)
fi

npm run check
if [ -n "`$TEST_COMMAND" ]; then
  `$TEST_COMMAND
fi

systemctl --user restart "`$SERVICE"
systemctl --user is-active "`$SERVICE"
for attempt in {1..30}; do
  if curl -sS -o /dev/null http://127.0.0.1:8095/health; then
    break
  fi
  if [ "`$attempt" -eq 30 ]; then
    echo "Runtime health did not become ready in time." >&2
    journalctl --user -u "`$SERVICE" --no-pager -n 80 >&2 || true
    exit 1
  fi
  sleep 1
done
curl -sS -o /dev/null -w 'runtime_health %{http_code}\n' http://127.0.0.1:8095/health
curl -sS -o /dev/null -w 'tasks_product_api %{http_code}\n' http://127.0.0.1:8095/api/companies/tinyoffice/tasks/view-model
curl -sS -o /dev/null -w 'mattermost_ping %{http_code}\n' http://127.0.0.1:8066/api/v4/system/ping
echo "Dogfood runtime update complete: `$DEPLOY_SHORT"
"@

$remoteScriptPath = Join-Path $bundleDir "remote-update-runtime-$shortCommit.sh"
Write-LfTextFile -Path $remoteScriptPath -Text $remoteScript
Run "scp" @($remoteScriptPath, "${HostName}:/tmp/tinyoffice-dogfood-update-runtime.sh")
Run "ssh" @($HostName, "bash /tmp/tinyoffice-dogfood-update-runtime.sh")

if (-not $SkipVerify) {
    Run "powershell" @("-ExecutionPolicy", "Bypass", "-File", "scripts/dogfood/verify-dogfood.ps1", "-HostName", $HostName)
}

Write-Host "Dogfood runtime update finished: $shortCommit" -ForegroundColor Green
