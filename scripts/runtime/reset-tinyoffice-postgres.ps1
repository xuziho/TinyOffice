param(
    [string]$ContainerName = "tinyoffice-postgres",
    [string]$VolumeName = "tinyoffice-postgres-data",
    [int]$HostPort = 55432,
    [string]$Database = "tinyoffice",
    [string]$User = "tinyoffice",
    [string]$Password = "tinyoffice_dev",
    [string]$Image = "postgres:18-alpine",
    [switch]$Help
)

$ErrorActionPreference = "Stop"

function Show-Help {
    Write-Output @"
Deletes and recreates the local TinyOffice PostgreSQL test database.

This is intentionally destructive and only targets the local TinyOffice runtime
PostgreSQL container and volume:

  Container: $ContainerName
  Volume:    $VolumeName
  Port:      127.0.0.1:$HostPort -> 5432

Use this when local test data can be discarded and the current schema should be
rebuilt from source.

Usage:
  npm run runtime:postgres:reset
"@
}

function Invoke-Docker([string[]]$Arguments, [switch]$AllowFailure) {
    $previousErrorActionPreference = $ErrorActionPreference
    $hasNativePreference = Test-Path Variable:\PSNativeCommandUseErrorActionPreference
    if ($hasNativePreference) {
        $previousNativePreference = $PSNativeCommandUseErrorActionPreference
        $PSNativeCommandUseErrorActionPreference = $false
    }

    $ErrorActionPreference = "Continue"
    try {
        $output = & docker @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        if ($hasNativePreference) {
            $PSNativeCommandUseErrorActionPreference = $previousNativePreference
        }
    }

    if (-not $AllowFailure -and $exitCode -ne 0) {
        $output | ForEach-Object { Write-Host $_ }
        throw "docker $($Arguments -join ' ') failed with exit code $exitCode"
    }

    return [pscustomobject]@{
        ExitCode = [int]$exitCode
        Output = @($output)
    }
}

function Get-ContainerJson {
    $result = Invoke-Docker @("inspect", $ContainerName) -AllowFailure
    if ($result.ExitCode -ne 0 -or $result.Output.Count -eq 0) {
        return $null
    }
    return ($result.Output | ConvertFrom-Json)[0]
}

function Test-DockerVolumeExists {
    $result = Invoke-Docker @("volume", "inspect", $VolumeName) -AllowFailure
    return $result.ExitCode -eq 0
}

if ($Help) {
    Show-Help
    exit 0
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI is required to reset the local TinyOffice PostgreSQL service."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$ensureScript = Join-Path $scriptDir "ensure-tinyoffice-postgres.ps1"
$initScript = Join-Path $scriptDir "init-tinyoffice-postgres-schema.ts"

$container = Get-ContainerJson
if ($null -ne $container) {
    $roleLabel = $container.Config.Labels."com.tinyoffice.role"
    if ($roleLabel -ne "runtime-postgres") {
        throw "Container '$ContainerName' exists but is not labeled as TinyOffice runtime PostgreSQL. Refusing to delete it."
    }

    Write-Host "Deleting TinyOffice PostgreSQL container '$ContainerName'." -ForegroundColor Yellow
    docker rm -f $ContainerName | Out-Null
}

if (Test-DockerVolumeExists) {
    Write-Host "Deleting TinyOffice PostgreSQL volume '$VolumeName'." -ForegroundColor Yellow
    docker volume rm $VolumeName | Out-Null
}

& powershell -ExecutionPolicy Bypass -File $ensureScript `
    -ContainerName $ContainerName `
    -VolumeName $VolumeName `
    -HostPort $HostPort `
    -Database $Database `
    -User $User `
    -Password $Password `
    -Image $Image

$env:TINYOFFICE_DATABASE_URL = "postgresql://${User}:${Password}@127.0.0.1:${HostPort}/${Database}?sslmode=disable"
Push-Location $repoRoot
try {
    node --import tsx $initScript
} finally {
    Pop-Location
}
