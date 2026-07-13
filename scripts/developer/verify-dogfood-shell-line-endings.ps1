Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
    throw "Unable to resolve git repository root."
}

. (Join-Path $repoRoot "scripts/dogfood/shell-script-helpers.ps1")

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "tinyoffice-dogfood-lf-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    $samplePath = Join-Path $tempDir "sample.sh"
    $mixedLineEndings = "set -euo pipefail`r`necho one`recho two`n"
    Write-LfTextFile -Path $samplePath -Text $mixedLineEndings

    $bytes = [System.IO.File]::ReadAllBytes($samplePath)
    for ($index = 0; $index -lt ($bytes.Length - 1); $index++) {
        if ($bytes[$index] -eq 13 -and $bytes[$index + 1] -eq 10) {
            throw "CRLF found in generated shell script: $samplePath"
        }
    }
    if ($bytes -contains 13) {
        throw "CR byte found in generated shell script: $samplePath"
    }

    $dogfoodScripts = @(
        "scripts/dogfood/update-runtime.ps1",
        "scripts/dogfood/verify-dogfood.ps1"
    )

    foreach ($relativePath in $dogfoodScripts) {
        $fullPath = Join-Path $repoRoot $relativePath
        $content = Get-Content -LiteralPath $fullPath -Raw
        if ($content -notmatch "shell-script-helpers\.ps1") {
            throw "$relativePath does not load shell-script-helpers.ps1"
        }
        if ($content -notmatch "Write-LfTextFile") {
            throw "$relativePath does not use Write-LfTextFile"
        }
        if ($content -match '\[System\.IO\.File\]::WriteAllText\(\s*\$[a-zA-Z0-9_]+,\s*\$remoteScript') {
            throw "$relativePath still writes remote shell script directly with WriteAllText"
        }
    }

    Write-Host "Dogfood shell script LF verification passed."
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
