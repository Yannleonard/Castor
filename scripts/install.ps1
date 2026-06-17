# =============================================================================
# Castor — one-command installer for Windows (Docker Desktop) / PowerShell.
#
# It is intentionally small and auditable. Read it before running:
#   https://github.com/Yannleonard/Castor/blob/main/scripts/install.ps1
#
# Usage — convenient one-liner (PowerShell):
#   irm https://raw.githubusercontent.com/Yannleonard/Castor/main/scripts/install.ps1 | iex
#
# Usage — audit first (recommended):
#   irm https://raw.githubusercontent.com/Yannleonard/Castor/main/scripts/install.ps1 -OutFile install.ps1
#   notepad install.ps1        # read it
#   ./install.ps1
#
# What it does:
#   1. checks Docker Desktop is installed and reachable,
#   2. generates a 32-byte CASTOR_SECRET_KEY (if you don't pass one) and saves it,
#   3. picks a free host port (8080, else the next free one),
#   4. pulls ghcr.io/yannleonard/castor:latest and runs it (non-root; the
#      entrypoint handles the docker socket group automatically),
#   5. waits for health and prints the URL.
#
# Overrides (set before running, e.g.  $env:CASTOR_PORT = '9090'):
#   CASTOR_PORT, CASTOR_SECRET_KEY, CASTOR_IMAGE, CASTOR_NAME, CASTOR_DATA,
#   CASTOR_SOCKET_MODE (ro | rw)
# =============================================================================
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$Image      = if ($env:CASTOR_IMAGE)       { $env:CASTOR_IMAGE }       else { 'ghcr.io/yannleonard/castor:latest' }
$Name       = if ($env:CASTOR_NAME)        { $env:CASTOR_NAME }        else { 'castor' }
$Data       = if ($env:CASTOR_DATA)        { $env:CASTOR_DATA }        else { 'castor-data' }
$SocketMode = if ($env:CASTOR_SOCKET_MODE) { $env:CASTOR_SOCKET_MODE } else { 'ro' }
$KeyFile    = Join-Path $HOME '.castor-secret.key'

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host " OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host " X  $m" -ForegroundColor Red; exit 1 }

# --- Docker reachable? -------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Die "Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Die "Cannot reach the Docker daemon. Is Docker Desktop running?" }
Ok "Docker is available."

# --- secret key: reuse > saved file > generate -------------------------------
if ($env:CASTOR_SECRET_KEY) {
  $Key = $env:CASTOR_SECRET_KEY
  Info "Using CASTOR_SECRET_KEY from the environment."
} elseif (Test-Path $KeyFile) {
  $Key = (Get-Content -Raw $KeyFile).Trim()
  Info "Reusing the saved key at $KeyFile."
} else {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $Key = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  Set-Content -NoNewline -Path $KeyFile -Value $Key
  Ok "Generated a 32-byte secret key and saved it to $KeyFile (keep it safe)."
}
if ($Key -notmatch '^[0-9a-fA-F]{64}$') { Die "CASTOR_SECRET_KEY must be 64 hex characters (32 bytes)." }

# --- pick a free host port (default 8080) ------------------------------------
function Test-PortBusy($p) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); return $true }
  catch { return $false }
}
$Port = if ($env:CASTOR_PORT) { [int]$env:CASTOR_PORT } else { 8080 }
if (Test-PortBusy $Port) {
  Warn "Port $Port is busy - searching for a free one..."
  foreach ($p in 8081,8082,8090,9000,9090) { if (-not (Test-PortBusy $p)) { $Port = $p; break } }
}
Ok "Will expose Castor on host port $Port."

# --- pull + (re)create -------------------------------------------------------
Info "Pulling $Image ..."
docker pull $Image *> $null
if ($LASTEXITCODE -ne 0) { Die "Failed to pull $Image (is it public / are you online?)." }
Ok "Image pulled."

$exists = docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq $Name }
if ($exists) {
  Warn "A container named '$Name' already exists - replacing it (the '$Data' volume is kept)."
  docker rm -f $Name *> $null
}

Info "Starting Castor..."
docker run -d --name $Name `
  -p "${Port}:8080" `
  -e "CASTOR_SECRET_KEY=$Key" `
  -v "/var/run/docker.sock:/var/run/docker.sock:$SocketMode" `
  -v "${Data}:/data" `
  --restart unless-stopped `
  $Image *> $null
if ($LASTEXITCODE -ne 0) { Die "docker run failed." }

# --- wait for health ---------------------------------------------------------
Info "Waiting for Castor to become healthy..."
for ($i = 0; $i -lt 30; $i++) {
  $status = docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Name 2>$null
  if ($status -eq 'healthy') { Ok "Castor is healthy."; break }
  if ($status -eq 'exited' -or $status -eq 'dead') { docker logs --tail 20 $Name; Die "Castor exited unexpectedly (see logs above)." }
  Start-Sleep -Seconds 2
}

# --- done --------------------------------------------------------------------
Write-Host ""
Write-Host "Castor is up!" -ForegroundColor Green
Write-Host ""
Write-Host "   Open:        http://localhost:$Port   (create your admin account)"
Write-Host "   Secret key:  $KeyFile"
Write-Host "   Logs:        docker logs -f $Name"
Write-Host "   Stop:        docker rm -f $Name   (data persists in the $Data volume)"
Write-Host ""
if ($SocketMode -eq 'ro') {
  Write-Host "   Tip: the Docker socket is mounted read-only (list/inspect/logs/stats)." -ForegroundColor Yellow
  Write-Host "        For full lifecycle (start/stop/exec), set `$env:CASTOR_SOCKET_MODE='rw' and re-run." -ForegroundColor Yellow
  Write-Host ""
}
Write-Host "   Security: enable TOTP 2FA right after creating your admin (Profile -> 2FA)," -ForegroundColor Yellow
Write-Host "             especially if this host is reachable from the internet." -ForegroundColor Yellow
Write-Host ""
