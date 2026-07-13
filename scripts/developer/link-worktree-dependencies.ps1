param(
  [string]$RepoRoot = (Get-Location).Path,
  [string]$MainCheckout,
  [switch]$Force
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

function Get-ReparseTarget {
  param([Parameter(Mandatory = $true)][string]$Path)

  $item = Get-Item -LiteralPath $Path -Force
  if ($item.LinkType -eq "Junction") {
    return @($item.Target)[0]
  }

  return $null
}

function Ensure-Junction {
  param(
    [Parameter(Mandatory = $true)][string]$LinkPath,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [switch]$Force
  )

  $resolvedTarget = Resolve-FullPath $TargetPath
  if (-not (Test-Path -LiteralPath $resolvedTarget -PathType Container)) {
    throw "Dependency source missing: $resolvedTarget. Install dependencies once in the main checkout first."
  }

  if (Test-Path -LiteralPath $LinkPath) {
    $existingTarget = Get-ReparseTarget $LinkPath
    if ($existingTarget) {
      $resolvedExistingTarget = Resolve-FullPath $existingTarget
      if ($resolvedExistingTarget -eq $resolvedTarget) {
        Write-Host "OK: $LinkPath -> $resolvedTarget"
        return
      }

      if (-not $Force) {
        throw "Existing junction points elsewhere: $LinkPath -> $resolvedExistingTarget. Re-run with -Force to replace it."
      }

      Remove-Item -LiteralPath $LinkPath -Force
    } else {
      if (-not $Force) {
        throw "Refusing to overwrite existing real directory/file: $LinkPath. Remove it manually or re-run with -Force."
      }

      Remove-Item -LiteralPath $LinkPath -Recurse -Force
    }
  }

  $parent = Split-Path -Parent $LinkPath
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
  }

  New-Item -ItemType Junction -Path $LinkPath -Target $resolvedTarget | Out-Null
  Write-Host "Linked: $LinkPath -> $resolvedTarget"
}

$repoRootPath = Resolve-FullPath $RepoRoot
$mainCheckoutPath = if ($MainCheckout) {
  Resolve-FullPath $MainCheckout
} else {
  Get-MainCheckoutPath $repoRootPath
}

$dependencies = @(
  "node_modules",
  "packages/pi-web-tools/node_modules"
)

foreach ($relativePath in $dependencies) {
  Ensure-Junction `
    -LinkPath (Join-Path $repoRootPath $relativePath) `
    -TargetPath (Join-Path $mainCheckoutPath $relativePath) `
    -Force:$Force
}
