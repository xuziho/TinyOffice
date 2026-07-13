param(
    [string]$ContainerName = "tinyoffice-postgres",
    [string]$VolumeName = "tinyoffice-postgres-data",
    [int]$HostPort = 55432,
    [string]$Database = "tinyoffice",
    [string]$User = "tinyoffice",
    [string]$Password = "tinyoffice_dev",
    [string]$Image = "postgres:18-alpine",
    [switch]$PrintEnv,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

function Show-Help {
    Write-Output @"
Ensures the long-lived local TinyOffice PostgreSQL service exists and is ready.

Defaults:
  Container: $ContainerName
  Volume:    $VolumeName
  Port:      127.0.0.1:$HostPort -> 5432
  Database:  $Database
  User:      $User
  URL:       postgresql://${User}:<password>@127.0.0.1:${HostPort}/${Database}?sslmode=disable

This script is non-destructive: it creates a missing volume/container or starts
an existing stopped container. It never deletes containers, volumes, or data.

Usage:
  npm run runtime:postgres:ensure
  powershell -ExecutionPolicy Bypass -File scripts/runtime/ensure-tinyoffice-postgres.ps1 -PrintEnv
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

function Run-Docker([string[]]$Arguments) {
    $result = Invoke-Docker $Arguments
    return $result.Output
}

function Test-DockerVolumeExists {
    $result = Invoke-Docker @("volume", "inspect", $VolumeName) -AllowFailure
    return $result.ExitCode -eq 0
}

function Get-ContainerJson {
    $result = Invoke-Docker @("inspect", $ContainerName) -AllowFailure
    if ($result.ExitCode -ne 0 -or $result.Output.Count -eq 0) {
        return $null
    }
    return ($result.Output | ConvertFrom-Json)[0]
}

function Get-DatabaseUrl {
    return "postgresql://${User}:${Password}@127.0.0.1:${HostPort}/${Database}?sslmode=disable"
}

if ($Help) {
    Show-Help
    exit 0
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI is required to ensure the local TinyOffice PostgreSQL service."
}

$container = Get-ContainerJson
if ($null -eq $container) {
    if (-not (Test-DockerVolumeExists)) {
        Run-Docker @("volume", "create", $VolumeName) | Out-Null
    }

    Write-Host "Creating TinyOffice PostgreSQL container '$ContainerName'." -ForegroundColor Cyan
    Run-Docker @(
        "run",
        "--name", $ContainerName,
        "--label", "com.tinyoffice.role=runtime-postgres",
        "-e", "POSTGRES_DB=$Database",
        "-e", "POSTGRES_USER=$User",
        "-e", "POSTGRES_PASSWORD=$Password",
        "-p", "127.0.0.1:${HostPort}:5432",
        "-v", "${VolumeName}:/var/lib/postgresql",
        "-d",
        $Image
    ) | Out-Null
    $container = Get-ContainerJson
} else {
    $roleLabel = $container.Config.Labels."com.tinyoffice.role"
    if ($roleLabel -and $roleLabel -ne "runtime-postgres") {
        throw "Container '$ContainerName' exists but is not labeled as TinyOffice runtime PostgreSQL."
    }

    $portBinding = $container.HostConfig.PortBindings."5432/tcp"
    $matchingPort = $false
    if ($portBinding) {
        foreach ($binding in $portBinding) {
            if ($binding.HostIp -eq "127.0.0.1" -and [int]$binding.HostPort -eq $HostPort) {
                $matchingPort = $true
            }
        }
    }
    if (-not $matchingPort) {
        throw "Container '$ContainerName' exists but does not bind 127.0.0.1:${HostPort}->5432. Refusing to mutate existing data container."
    }

    if ($container.State.Running -ne $true) {
        Write-Host "Starting TinyOffice PostgreSQL container '$ContainerName'." -ForegroundColor Cyan
        Run-Docker @("start", $ContainerName) | Out-Null
    }
}

$ready = $false
for ($attempt = 1; $attempt -le 60; $attempt += 1) {
    $readiness = Invoke-Docker @("exec", $ContainerName, "pg_isready", "-U", $User, "-d", $Database) -AllowFailure
    if ($readiness.ExitCode -eq 0) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    throw "TinyOffice PostgreSQL did not become ready in time."
}

$databaseUrl = Get-DatabaseUrl
Write-Host "TinyOffice PostgreSQL is ready." -ForegroundColor Green
Write-Output "Container: $ContainerName"
Write-Output "Volume: $VolumeName"
Write-Output "Database: $Database"
Write-Output "URL: $databaseUrl"

if ($PrintEnv) {
    Write-Output "`$env:TINYOFFICE_DATABASE_URL = `"$databaseUrl`""
}
