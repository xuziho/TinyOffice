param(
    [string]$HostName = "agent-mini",
    [string]$TailscaleBaseUrl = "http://100.118.212.69:8066",
    [string]$CloudflareBaseUrl = "https://tinyoffice.aiziho.click",
    [switch]$SkipCloudflare
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "shell-script-helpers.ps1")

function Run($FilePath, [string[]]$Arguments, [string]$WorkingDirectory = (Get-Location).Path) {
    Write-Host ">> $FilePath $($Arguments -join ' ')" -ForegroundColor Cyan
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Command failed with exit code $($process.ExitCode): $FilePath $($Arguments -join ' ')"
    }
}

function CurlCheck([string]$Label, [string]$Url) {
    Write-Host ">> curl $Label $Url" -ForegroundColor Cyan
    $result = & curl.exe -sS -o NUL -w "code=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}" $Url
    if ($LASTEXITCODE -ne 0) {
        throw "curl failed for ${Label}: $Url"
    }
    Write-Host "$Label $result"
    if ($result -notmatch "code=2\d\d|code=3\d\d") {
        throw "Unexpected HTTP result for ${Label}: $result"
    }
}

function CurlStatusCheck([string]$Label, [string]$Url, [string]$ExpectedStatus) {
    Write-Host ">> curl $Label $Url" -ForegroundColor Cyan
    $result = & curl.exe -sS -o NUL -w "code=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}" $Url
    if ($LASTEXITCODE -ne 0) {
        throw "curl failed for ${Label}: $Url"
    }
    Write-Host "$Label $result"
    if ($result -notmatch "code=$ExpectedStatus\b") {
        throw "Unexpected HTTP result for ${Label}: $result"
    }
}

$remoteScript = @'
set -euo pipefail
check_url() {
  label="$1"
  url="$2"
  result="$(curl -sS -o /dev/null -w "${label} %{http_code} %{time_total}" "$url")"
  echo "$result"
  case "$result" in
    *" 2"*|*" 3"*) ;;
    *) echo "Unexpected HTTP result for $label: $result" >&2; exit 1 ;;
  esac
}
check_status() {
  label="$1"
  expected="$2"
  url="$3"
  result="$(curl -sS -o /dev/null -w "${label} %{http_code} %{time_total}" "$url")"
  echo "$result"
  case "$result" in
    *" ${expected} "*) ;;
    *) echo "Unexpected HTTP result for $label: $result" >&2; exit 1 ;;
  esac
}
echo "REMOTE_HOST $(hostname)"
echo "TAILSCALE"
tailscale status | head -5 || true
echo "SERVICES"
systemctl is-active cloudflared || true
systemctl is-active tinyoffice-legacy-redirect.service || true
systemctl --user is-active tinyoffice-realtime-intake
echo "PORTS"
ss -ltnp | grep -E ':(8066|8095|19006)\b' || true
echo "DOCKER"
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' | grep -E 'docker-candidate|stage5-host' || true
echo "LOCAL_HTTP"
check_url mattermost_ping http://127.0.0.1:8066/api/v4/system/ping
check_url runtime_health http://127.0.0.1:8095/health
check_url tasks_product_api http://127.0.0.1:8095/api/companies/tinyoffice/tasks/view-model
check_url sessions_product_api http://127.0.0.1:8095/api/companies/tinyoffice/sessions/view-model
check_url console_company_config http://127.0.0.1:8095/console/company-config
echo "MATTERMOST_PLUGIN"
docker exec docker-candidate-mattermost-1 /mattermost/bin/mmctl --local plugin list | grep -E 'com\.tinyoffice\.collaboration|com\.agentcompanyos\.collaboration' || true
docker exec docker-candidate-mattermost-1 /mattermost/bin/mmctl --local plugin list | awk '
  /^Listing enabled plugins/ { section="enabled"; next }
  /^Listing disabled plugins/ { section="disabled"; next }
  section=="enabled" && /^com\.tinyoffice\.collaboration:/ { tinyoffice_enabled=1 }
  section=="enabled" && /^com\.agentcompanyos\.collaboration:/ { old_enabled=1 }
  END {
    if (!tinyoffice_enabled) { print "com.tinyoffice.collaboration is not enabled" > "/dev/stderr"; exit 1 }
    if (old_enabled) { print "com.agentcompanyos.collaboration must not be enabled" > "/dev/stderr"; exit 1 }
  }
'
check_status retired_plugin_work_board 404 http://127.0.0.1:8066/plugins/com.tinyoffice.collaboration/api/v1/work-board
check_status retired_plugin_sessions 404 http://127.0.0.1:8066/plugins/com.tinyoffice.collaboration/api/v1/session-explorer
check_status retired_plugin_company_config 404 http://127.0.0.1:8066/plugins/com.tinyoffice.collaboration/api/v1/company-config
echo "RECENT_ERRORS"
docker logs --since 5m docker-candidate-mattermost-1 2>&1 | grep -Ei 'cloudlimits|GetAllTeamsPage|status_code":"5|panic|fatal|plugin not found' | tail -20 || true
'@

$temp = Join-Path $env:TEMP "tinyoffice-dogfood-verify-$([Guid]::NewGuid().ToString('N')).sh"
Write-LfTextFile -Path $temp -Text $remoteScript
Run "scp" @($temp, "${HostName}:/tmp/tinyoffice-dogfood-verify.sh")
Run "ssh" @($HostName, "bash /tmp/tinyoffice-dogfood-verify.sh")
Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue

CurlCheck "tailscale_root" $TailscaleBaseUrl
CurlCheck "tailscale_ping" "$TailscaleBaseUrl/api/v4/system/ping"
CurlStatusCheck "tailscale_retired_plugin_work_board" "$TailscaleBaseUrl/plugins/com.tinyoffice.collaboration/api/v1/work-board" "404"
CurlStatusCheck "tailscale_retired_plugin_sessions" "$TailscaleBaseUrl/plugins/com.tinyoffice.collaboration/api/v1/session-explorer" "404"
CurlStatusCheck "tailscale_retired_plugin_company_config" "$TailscaleBaseUrl/plugins/com.tinyoffice.collaboration/api/v1/company-config" "404"

if (-not $SkipCloudflare) {
    CurlCheck "cloudflare_root" $CloudflareBaseUrl
    CurlCheck "cloudflare_ping" "$CloudflareBaseUrl/api/v4/system/ping"
    CurlStatusCheck "cloudflare_retired_plugin_work_board" "$CloudflareBaseUrl/plugins/com.tinyoffice.collaboration/api/v1/work-board" "404"
}

Write-Host "Dogfood verification complete." -ForegroundColor Green
