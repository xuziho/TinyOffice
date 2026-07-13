param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [string]$RcloneDestination,
  [int]$KeepLocalDays = 14
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $repoRoot
try {
  $json = node --import tsx src/cli/agentco.ts backup create --output $OutputDirectory --json
  if ($LASTEXITCODE -ne 0) { throw "TinyOffice backup command failed with exit code $LASTEXITCODE." }
  $receipt = $json | ConvertFrom-Json
  if (-not $receipt.ok -or -not (Test-Path -LiteralPath $receipt.path)) { throw "TinyOffice did not return a valid backup receipt." }

  node --import tsx src/cli/agentco.ts backup verify --from $receipt.path | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "TinyOffice backup verification failed." }

  if ($RcloneDestination) {
    & rclone copyto $receipt.path "$RcloneDestination/$($receipt.fileName)"
    if ($LASTEXITCODE -ne 0) { throw "rclone upload failed." }
  }

  $cutoff = (Get-Date).AddDays(-$KeepLocalDays)
  Get-ChildItem -LiteralPath $OutputDirectory -Filter "*.tobackup" -File |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
      Remove-Item -LiteralPath "$($_.FullName).json" -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $_.FullName -Force
    }

  [pscustomobject]@{ ok = $true; backup = $receipt.path; uploaded = [bool]$RcloneDestination } | ConvertTo-Json
} finally {
  Pop-Location
}
