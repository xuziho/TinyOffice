param(
    [string]$Token,
    [string]$Branch,
    [string]$Worktree,
    [switch]$Force,
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
if ($Token -eq "force" -or $Token -eq "--force" -or $Token -eq "-Force") {
    $Force = $true
    $Token = $null
}

$lockFullPath = Get-FullPath $LockPath
if (-not (Test-Path -LiteralPath $lockFullPath)) {
    Write-Output "No real smoke lock to release."
    exit 0
}

$existing = Get-Content -LiteralPath $lockFullPath -Raw | ConvertFrom-Json
$tokenMatches = -not [string]::IsNullOrWhiteSpace($Token) -and $Token -eq $existing.token
$ownerMatches = $Branch -eq $existing.branch -and $Worktree -eq $existing.worktree

if (-not $Force -and -not $tokenMatches -and -not $ownerMatches) {
    Write-Error @"
Refusing to release a smoke lock owned by another holder.
Holder branch: $($existing.branch)
Holder worktree: $($existing.worktree)
Holder thread: $($existing.thread)
Started at: $($existing.startedAt)

Pass the matching -Token, run from the owning branch/worktree, or use -Force only after confirming the holder is stale.
"@
    exit 3
}

Remove-Item -LiteralPath $lockFullPath -Force
Write-Output "Released real smoke lock: $lockFullPath"
