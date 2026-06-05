#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Castor build helper (Windows / PowerShell 7+). Unix users: use build.sh.

.DESCRIPTION
    Wraps docker buildx + docker compose so the image is reproducible and the
    "< 2 minutes" deploy path is one command. Go is compiled INSIDE Docker, so
    no local Go toolchain is required for `build`, `buildx`, `push`, or `run`.

.PARAMETER Command
    build   Build the image for the local arch and load it into the daemon.
    buildx  Build multi-arch (linux/amd64,linux/arm64) without pushing.
    push    Build + push multi-arch to the registry.
    run     docker compose up -d (the < 2 min path). Needs $env:CASTOR_SECRET_KEY.
    down    docker compose down.
    dev     Local dev: Go backend (:8080) + vite dev server (:5173). Needs Go installed.
    help    Show this help.

.EXAMPLE
    $env:CASTOR_SECRET_KEY = (openssl rand -hex 32)
    ./build.ps1 build
    ./build.ps1 run

.NOTES
    Env overrides: CASTOR_IMAGE, CASTOR_VERSION, CASTOR_COMMIT, CASTOR_PLATFORMS,
    CASTOR_PORT, DOCKER_GID, CASTOR_SECRET_KEY
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('build', 'buildx', 'push', 'run', 'down', 'dev', 'help')]
    [string]$Command = 'help'
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# ---- configuration (env-overridable) ---------------------------------------
function Resolve-GitDescribe {
    try { $v = (git describe --tags --always --dirty 2>$null); if ($LASTEXITCODE -eq 0 -and $v) { return $v } } catch {}
    return 'dev'
}
function Resolve-GitCommit {
    try { $c = (git rev-parse --short HEAD 2>$null); if ($LASTEXITCODE -eq 0 -and $c) { return $c } } catch {}
    return 'none'
}

$Image       = if ($env:CASTOR_IMAGE)     { $env:CASTOR_IMAGE }     else { 'ghcr.io/gtek-it/castor' }
$Version     = if ($env:CASTOR_VERSION)   { $env:CASTOR_VERSION }   else { Resolve-GitDescribe }
$Commit      = if ($env:CASTOR_COMMIT)    { $env:CASTOR_COMMIT }    else { Resolve-GitCommit }
$Platforms   = if ($env:CASTOR_PLATFORMS) { $env:CASTOR_PLATFORMS } else { 'linux/amd64,linux/arm64' }
$Port        = if ($env:CASTOR_PORT)      { $env:CASTOR_PORT }      else { '8080' }
$ComposeFile = 'deploy/docker-compose.yml'

# ---- helpers ----------------------------------------------------------------
function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn([string]$msg) { Write-Host "WARN: $msg" -ForegroundColor Yellow }
function Stop-WithError([string]$msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

function Assert-Secret {
    if (-not $env:CASTOR_SECRET_KEY) {
        Stop-WithError 'CASTOR_SECRET_KEY is unset. Run:  $env:CASTOR_SECRET_KEY = (openssl rand -hex 32)'
    }
    if ($env:CASTOR_SECRET_KEY -notmatch '^[0-9a-fA-F]{64}$') {
        Write-Warn 'CASTOR_SECRET_KEY is not 64 hex chars (32 bytes). The backend will refuse to start unless it decodes to 32 bytes. Generate with: openssl rand -hex 32'
    }
}

function Resolve-DockerGid {
    if ($env:DOCKER_GID) { return $env:DOCKER_GID }
    # On Windows hosts the docker socket GID concept does not apply; the compose
    # default (999) is used. On Linux, prefer the build.sh path or set DOCKER_GID.
    return '999'
}

# ---- commands ---------------------------------------------------------------
function Invoke-Build {
    Write-Step "buildx (local arch, --load): ${Image}:${Version}"
    docker buildx build `
        --build-arg "VERSION=$Version" `
        --build-arg "COMMIT=$Commit" `
        -t "${Image}:${Version}" -t "${Image}:latest" `
        --load .
    if ($LASTEXITCODE -ne 0) { Stop-WithError "docker buildx build failed ($LASTEXITCODE)" }
    Write-Step "done. images: ${Image}:${Version}, ${Image}:latest"
}

function Invoke-Buildx {
    Write-Step "buildx multi-arch ($Platforms): ${Image}:${Version}"
    docker buildx build `
        --platform $Platforms `
        --build-arg "VERSION=$Version" `
        --build-arg "COMMIT=$Commit" `
        -t "${Image}:${Version}" -t "${Image}:latest" `
        .
    if ($LASTEXITCODE -ne 0) { Stop-WithError "docker buildx build failed ($LASTEXITCODE)" }
}

function Invoke-Push {
    Write-Step "buildx multi-arch + push ($Platforms): ${Image}:${Version}"
    docker buildx build `
        --platform $Platforms `
        --build-arg "VERSION=$Version" `
        --build-arg "COMMIT=$Commit" `
        -t "${Image}:${Version}" -t "${Image}:latest" `
        --push .
    if ($LASTEXITCODE -ne 0) { Stop-WithError "docker buildx build --push failed ($LASTEXITCODE)" }
}

function Invoke-Run {
    Assert-Secret
    $env:DOCKER_GID = Resolve-DockerGid
    Write-Step "docker compose up -d ($ComposeFile)"
    docker compose -f $ComposeFile up -d
    if ($LASTEXITCODE -ne 0) { Stop-WithError "docker compose up failed ($LASTEXITCODE)" }
    Write-Step "Castor is starting -> http://localhost:$Port (first run shows the bootstrap screen)"
}

function Invoke-Down {
    Write-Step "docker compose down ($ComposeFile)"
    docker compose -f $ComposeFile down
}

function Invoke-Dev {
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
        Stop-WithError 'Go is not installed on this host; dev mode needs Go. (Production builds happen inside Docker — use "./build.ps1 build".)'
    }
    if (-not (Test-Path 'ui/node_modules')) {
        Write-Step 'installing UI deps'
        Push-Location ui; npm ci; Pop-Location
    }
    Write-Step 'starting Go backend on :8080 (background job)'
    $env:CGO_ENABLED = '0'
    $backend = Start-Job -ScriptBlock {
        param($root)
        Set-Location $root
        $env:CGO_ENABLED = '0'
        go run ./server/cmd/castor
    } -ArgumentList $PSScriptRoot
    try {
        Write-Step 'starting vite dev server on :5173 (proxies /api and /ws -> :8080)'
        Push-Location ui; npm run dev; Pop-Location
    }
    finally {
        Write-Step 'stopping backend job'
        Stop-Job $backend -ErrorAction SilentlyContinue
        Remove-Job $backend -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-Help {
    Get-Help $PSCommandPath -Detailed
}

switch ($Command) {
    'build'  { Invoke-Build }
    'buildx' { Invoke-Buildx }
    'push'   { Invoke-Push }
    'run'    { Invoke-Run }
    'down'   { Invoke-Down }
    'dev'    { Invoke-Dev }
    default  { Invoke-Help }
}
