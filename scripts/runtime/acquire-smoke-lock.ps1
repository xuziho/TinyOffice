param(
    [string]$Reason = "real TinyOffice runtime smoke",
    [string]$Branch,
    [string]$Worktree,
    [string]$Thread,
    [string]$Resources = "8095,runtime worker,session trace,PostgreSQL-backed preview state",
    [string]$Token,
    [string]$LockPath = ".runtime/smoke.lock.json"
)

$ErrorActionPreference = "Stop"

function Get-GitBranch {
    $name = git branch --show-current 2>$null
    if ([string]::IsNullOrWhiteSpace($name)) {
        return "HEAD"
    }
    return $name.Trim()
}

function Get-FullPath([string]$Path) {
    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

if ([string]::IsNullOrWhiteSpace($Branch)) {
    $Branch = Get-GitBranch
}
if ([string]::IsNullOrWhiteSpace($Worktree)) {
    $Worktree = (Get-Location).Path
}
if ([string]::IsNullOrWhiteSpace($Thread)) {
    $Thread = $env:CODEX_THREAD_ID
}
if ([string]::IsNullOrWhiteSpace($Token)) {
    $Token = [guid]::NewGuid().ToString("N")
}

$lockFullPath = Get-FullPath $LockPath
$lockDir = Split-Path -Parent $lockFullPath
New-Item -ItemType Directory -Force -Path $lockDir | Out-Null

if (Test-Path -LiteralPath $lockFullPath) {
    $existing = Get-Content -LiteralPath $lockFullPath -Raw | ConvertFrom-Json
    Write-Error @"
Real smoke lock is already held.
Holder branch: $($existing.branch)
Holder worktree: $($existing.worktree)
Holder thread: $($existing.thread)
Started at: $($existing.startedAt)
Resources: $($existing.resources)
Reason: $($existing.reason)

Stop this smoke step now. Do not poll or wait automatically. Report the holder, resources, and your completed verification stage to the user.
"@
    exit 2
}

$payload = [ordered]@{
    token = $Token
    branch = $Branch
    worktree = $Worktree
    thread = $Thread
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    resources = $Resources
    reason = $Reason
}

$json = $payload | ConvertTo-Json -Depth 4
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json + [Environment]::NewLine)
$stream = $null
try {
    $stream = [System.IO.File]::Open($lockFullPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $stream.Write($bytes, 0, $bytes.Length)
}
catch [System.IO.IOException] {
    Write-Error "Real smoke lock was acquired by another process while this command was starting. Re-run to inspect the holder."
    exit 2
}
finally {
    if ($null -ne $stream) {
        $stream.Dispose()
    }
}

Write-Output "Acquired real smoke lock."
Write-Output "Token: $Token"
Write-Output "Lock: $lockFullPath"
Write-Output "Branch: $Branch"
Write-Output "Worktree: $Worktree"
