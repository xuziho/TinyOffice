Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$cleanupScript = Join-Path $scriptDir "cleanup-codex-worktree.ps1"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tinyoffice-cleanup-test-" + [System.Guid]::NewGuid().ToString("N"))

function New-FakeMainDependencies {
  param([Parameter(Mandatory = $true)][string]$MainPath)

  $rootTsx = Join-Path $MainPath "node_modules/tsx"
  $piDeps = Join-Path $MainPath "packages/pi-web-tools/node_modules"

  New-Item -ItemType Directory -Path $rootTsx -Force | Out-Null
  New-Item -ItemType Directory -Path $piDeps -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $rootTsx "package.json") -Value '{"name":"tsx"}' -Encoding utf8
  Set-Content -LiteralPath (Join-Path $piDeps ".keep") -Value "survive" -Encoding utf8

  return @{
    RootTsx = $rootTsx
    PiDeps = $piDeps
  }
}

function New-ChildDependencyJunctions {
  param(
    [Parameter(Mandatory = $true)][string]$ChildPath,
    [Parameter(Mandatory = $true)][string]$MainPath,
    [Parameter(Mandatory = $true)][string]$PiDeps
  )

  New-Item -ItemType Directory -Path $ChildPath -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $ChildPath "packages/pi-web-tools") -Force | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $ChildPath "node_modules") -Target (Join-Path $MainPath "node_modules") | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $ChildPath "packages/pi-web-tools/node_modules") -Target $PiDeps | Out-Null
}

function Assert-ChildJunctionsAbsent {
  param([Parameter(Mandatory = $true)][string]$ChildPath)

  if (Test-Path -LiteralPath (Join-Path $ChildPath "node_modules")) {
    throw "root dependency junction still exists in fake child"
  }

  if (Test-Path -LiteralPath (Join-Path $ChildPath "packages/pi-web-tools/node_modules")) {
    throw "pi-web-tools dependency junction still exists in fake child"
  }
}

function Assert-MainDependencyTargetsExist {
  param(
    [Parameter(Mandatory = $true)][string]$RootTsx,
    [Parameter(Mandatory = $true)][string]$PiDeps
  )

  if (-not (Test-Path -LiteralPath $RootTsx -PathType Container)) {
    throw "fake main node_modules/tsx was removed"
  }

  if (-not (Test-Path -LiteralPath $PiDeps -PathType Container)) {
    throw "fake main pi-web-tools node_modules was removed"
  }
}

try {
  $fakeMain = Join-Path $tempRoot "main"
  $fakeChild = Join-Path $tempRoot "child"
  $fakeDeps = New-FakeMainDependencies -MainPath $fakeMain
  New-ChildDependencyJunctions -ChildPath $fakeChild -MainPath $fakeMain -PiDeps $fakeDeps.PiDeps

  & powershell -NoProfile -ExecutionPolicy Bypass -File $cleanupScript `
    -WorktreePath $fakeChild `
    -MainCheckout $fakeMain `
    -PreArchiveUnlinkOnly

  if ($LASTEXITCODE -ne 0) {
    throw "pre-archive unlink exited with $LASTEXITCODE"
  }

  Assert-ChildJunctionsAbsent -ChildPath $fakeChild
  Assert-MainDependencyTargetsExist -RootTsx $fakeDeps.RootTsx -PiDeps $fakeDeps.PiDeps

  if (-not (Test-Path -LiteralPath $fakeChild -PathType Container)) {
    throw "pre-archive unlink removed the child worktree directory"
  }

  Write-Host "OK: pre-archive unlink removed child junctions, preserved fake main targets, and left child directory in place."

  $gitMain = Join-Path $tempRoot "git-main"
  $gitChild = Join-Path $tempRoot "git-child"
  New-Item -ItemType Directory -Path $gitMain -Force | Out-Null
  & git -C $gitMain init -b main | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "git init failed"
  }

  Set-Content -LiteralPath (Join-Path $gitMain "README.md") -Value "cleanup test" -Encoding utf8
  & git -C $gitMain -c user.name="TinyOffice Cleanup Test" -c user.email="tinyoffice-cleanup@example.invalid" add README.md
  if ($LASTEXITCODE -ne 0) {
    throw "git add failed"
  }

  & git -C $gitMain -c user.name="TinyOffice Cleanup Test" -c user.email="tinyoffice-cleanup@example.invalid" commit -m "seed cleanup test" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "git commit failed"
  }

  $gitDeps = New-FakeMainDependencies -MainPath $gitMain
  & git -C $gitMain worktree add -b cleanup-test-child $gitChild | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "git worktree add failed"
  }

  New-ChildDependencyJunctions -ChildPath $gitChild -MainPath $gitMain -PiDeps $gitDeps.PiDeps

  & powershell -NoProfile -ExecutionPolicy Bypass -File $cleanupScript `
    -WorktreePath $gitChild `
    -MainCheckout $gitMain

  if ($LASTEXITCODE -ne 0) {
    throw "full cleanup exited with $LASTEXITCODE"
  }

  if (Test-Path -LiteralPath $gitChild) {
    throw "full cleanup left the git child worktree directory behind"
  }

  Assert-MainDependencyTargetsExist -RootTsx $gitDeps.RootTsx -PiDeps $gitDeps.PiDeps
  Write-Host "OK: full cleanup removed git child worktree and preserved fake main dependency targets."

  $staleChild = Join-Path $tempRoot "stale-child"
  New-Item -ItemType Directory -Path $staleChild -Force | Out-Null

  & powershell -NoProfile -ExecutionPolicy Bypass -File $cleanupScript `
    -WorktreePath $staleChild `
    -MainCheckout $gitMain

  if ($LASTEXITCODE -ne 0) {
    throw "stale physical directory cleanup exited with $LASTEXITCODE"
  }

  if (Test-Path -LiteralPath $staleChild) {
    throw "stale physical directory cleanup left directory behind"
  }

  Assert-MainDependencyTargetsExist -RootTsx $gitDeps.RootTsx -PiDeps $gitDeps.PiDeps
  Write-Host "OK: full cleanup removes stale physical directories that are no longer Git worktrees."
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
