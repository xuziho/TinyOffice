param(
  [Parameter(Mandatory = $true)][string]$WorktreePath,
  [string]$MainCheckout,
  [switch]$Force,
  [switch]$PreArchiveUnlinkOnly,
  [switch]$SkipGitWorktreeRemove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-FullPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (Test-Path -LiteralPath $Path) {
    return (Resolve-Path -LiteralPath $Path).Path
  }

  return [System.IO.Path]::GetFullPath($Path)
}

function Normalize-PathForCompare {
  param([Parameter(Mandatory = $true)][string]$Path)

  return (Resolve-FullPath $Path).TrimEnd('\', '/').ToLowerInvariant()
}

function Get-MainCheckoutPath {
  param([Parameter(Mandatory = $true)][string]$Cwd)

  $raw = & git -C $Cwd worktree list --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect git worktrees from $Cwd."
  }

  $currentWorktree = $null
  foreach ($line in $raw) {
    if ($line -eq "") {
      $currentWorktree = $null
      continue
    }

    if ($line.StartsWith("worktree ")) {
      $currentWorktree = $line.Substring("worktree ".Length)
      continue
    }

    if ($line -eq "branch refs/heads/main" -and $currentWorktree) {
      return (Resolve-FullPath $currentWorktree)
    }
  }

  throw "Unable to find the main checkout from git worktree list. Pass -MainCheckout explicitly."
}

function Assert-UnderPath {
  param(
    [Parameter(Mandatory = $true)][string]$ChildPath,
    [Parameter(Mandatory = $true)][string]$ParentPath
  )

  $child = Normalize-PathForCompare $ChildPath
  $parent = Normalize-PathForCompare $ParentPath
  if ($child -ne $parent -and -not $child.StartsWith("$parent\")) {
    throw "Refusing to remove path outside worktree: $ChildPath"
  }
}

function Get-ReparseTarget {
  param([Parameter(Mandatory = $true)][string]$Path)

  $item = Get-Item -LiteralPath $Path -Force
  if ($item.LinkType -eq "Junction") {
    return @($item.Target)[0]
  }

  return $null
}

function Remove-DependencyPathSafely {
  param(
    [Parameter(Mandatory = $true)][string]$LinkPath,
    [Parameter(Mandatory = $true)][string]$ExpectedTarget,
    [Parameter(Mandatory = $true)][string]$WorktreeRoot,
    [switch]$Force
  )

  if (-not (Test-Path -LiteralPath $LinkPath)) {
    Write-Host "Dependency path already absent: $LinkPath"
    return
  }

  Assert-UnderPath -ChildPath $LinkPath -ParentPath $WorktreeRoot

  $target = Get-ReparseTarget $LinkPath
  if ($target) {
    $resolvedTarget = Normalize-PathForCompare $target
    $resolvedExpected = Normalize-PathForCompare $ExpectedTarget
    if ($resolvedTarget -ne $resolvedExpected -and -not $Force) {
      throw "Refusing to remove junction with unexpected target: $LinkPath -> $target. Expected $ExpectedTarget."
    }

    [System.IO.Directory]::Delete($LinkPath, $false)
    Write-Host "Unlinked dependency junction: $LinkPath -> $target"
    return
  }

  if (-not $Force) {
    throw "Refusing to remove real dependency path: $LinkPath. Re-run with -Force only after confirming this is disposable child data."
  }

  Remove-Item -LiteralPath $LinkPath -Recurse -Force
  Write-Host "Removed real child dependency path under worktree: $LinkPath"
}

function Assert-MainDependenciesSurvive {
  param([Parameter(Mandatory = $true)][string]$MainCheckoutPath)

  $rootTsx = Join-Path $MainCheckoutPath "node_modules/tsx"
  $piNodeModules = Join-Path $MainCheckoutPath "packages/pi-web-tools/node_modules"

  if (-not (Test-Path -LiteralPath $rootTsx -PathType Container)) {
    throw "Main dependency source failed validation: missing $rootTsx"
  }

  if (-not (Test-Path -LiteralPath $piNodeModules -PathType Container)) {
    throw "Main dependency source failed validation: missing $piNodeModules"
  }
}

function Test-GitWorktreeListed {
  param(
    [Parameter(Mandatory = $true)][string]$MainCheckoutPath,
    [Parameter(Mandatory = $true)][string]$WorktreePath
  )

  $listed = & git -C $MainCheckoutPath worktree list --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect git worktrees from $MainCheckoutPath."
  }

  $normalizedTarget = Normalize-PathForCompare $WorktreePath
  foreach ($line in $listed) {
    if (-not $line.StartsWith("worktree ")) {
      continue
    }

    $listedPath = $line.Substring("worktree ".Length)
    if ((Normalize-PathForCompare $listedPath) -eq $normalizedTarget) {
      return $true
    }
  }

  return $false
}

function Remove-ResidualPhysicalWorktree {
  param([Parameter(Mandatory = $true)][string]$WorktreePath)

  if (-not (Test-Path -LiteralPath $WorktreePath -PathType Container)) {
    Write-Host "Residual physical directory is absent: $WorktreePath"
    return $true
  }

  $reparsePoints = @(Get-ChildItem -LiteralPath $WorktreePath -Force -Recurse -Attributes ReparsePoint)
  if ($reparsePoints.Count -gt 0) {
    $formatted = ($reparsePoints | ForEach-Object { $_.FullName }) -join "; "
    throw "Refusing ordinary residual directory cleanup while reparse points remain: $formatted"
  }

  $children = @(Get-ChildItem -LiteralPath $WorktreePath -Force)
  $mode = if ($children.Count -eq 0) { "empty" } else { "ordinary_non_git_directory" }

  try {
    Remove-Item -LiteralPath $WorktreePath -Recurse -Force
    Write-Host "Removed residual physical worktree directory ($mode): $WorktreePath"
    return $true
  } catch {
    Write-Warning "cleanup_status=residual_dir_locked path=`"$WorktreePath`" detail=`"$($_.Exception.Message)`""
    Write-Warning "The Git worktree entry is already gone. Archive/release the Codex App thread that used this cwd, wait for Windows handles to close, then rerun cleanup."
    return $false
  }
}

$worktreeFullPath = Resolve-FullPath $WorktreePath
$mainCheckoutPath = if ($MainCheckout) {
  Resolve-FullPath $MainCheckout
} else {
  Get-MainCheckoutPath (Get-Location).Path
}

if ((Normalize-PathForCompare $worktreeFullPath) -eq (Normalize-PathForCompare $mainCheckoutPath)) {
  throw "Refusing to clean the main checkout as a worktree: $worktreeFullPath"
}

$dependencies = @(
  "node_modules",
  "packages/pi-web-tools/node_modules"
)

$unlinkOnly = $PreArchiveUnlinkOnly -or $SkipGitWorktreeRemove
if ($PreArchiveUnlinkOnly) {
  Write-Host "Pre-archive unlink only: removing child dependency junctions before Codex App thread archive."
  Write-Host "Worktree remove/prune will not run in this phase: $worktreeFullPath"
} elseif ($SkipGitWorktreeRemove) {
  Write-Host "Unlink only requested via legacy -SkipGitWorktreeRemove."
}

foreach ($relativePath in $dependencies) {
  Remove-DependencyPathSafely `
    -LinkPath (Join-Path $worktreeFullPath $relativePath) `
    -ExpectedTarget (Join-Path $mainCheckoutPath $relativePath) `
    -WorktreeRoot $worktreeFullPath `
    -Force:$Force
}

if ($unlinkOnly) {
  if (-not (Test-Path -LiteralPath $worktreeFullPath -PathType Container)) {
    throw "Pre-archive unlink only expected the child worktree directory to remain, but it is absent: $worktreeFullPath"
  }

  Write-Host "Pre-archive unlink complete: child dependency junctions are absent and worktree directory remains."
} elseif (Test-Path -LiteralPath $worktreeFullPath -PathType Container) {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $removeOutput = & git -C $mainCheckoutPath worktree remove --force $worktreeFullPath 2>&1
  $removeExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference

  if ($removeExitCode -ne 0) {
    $isListed = Test-GitWorktreeListed -MainCheckoutPath $mainCheckoutPath -WorktreePath $worktreeFullPath
    if (-not $isListed) {
      Write-Host "Git no longer lists this worktree; pruning metadata and checking residual physical directory."
      & git -C $mainCheckoutPath worktree prune
      if ($LASTEXITCODE -ne 0) {
        throw "git worktree prune failed after remove reported: $removeOutput"
      }
      $removedResidual = Remove-ResidualPhysicalWorktree -WorktreePath $worktreeFullPath
      if (-not $removedResidual) {
        Assert-MainDependenciesSurvive -MainCheckoutPath $mainCheckoutPath
        exit 2
      }
    } else {
      throw "git worktree remove failed: $removeOutput"
    }
  } else {
    Write-Host "Removed git worktree: $worktreeFullPath"
  }
} else {
  Write-Host "Physical worktree path is absent; pruning git worktree metadata."
  & git -C $mainCheckoutPath worktree prune
  if ($LASTEXITCODE -ne 0) {
    throw "git worktree prune failed."
  }
}

Assert-MainDependenciesSurvive -MainCheckoutPath $mainCheckoutPath
Write-Host "Main dependency source verified: node_modules/tsx and packages/pi-web-tools/node_modules still exist."
