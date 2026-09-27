# Castor — one-command installer for Windows (Docker Desktop) / PowerShell.
#
#   irm https://raw.githubusercontent.com/Yannleonard/Castor/main/scripts/install.ps1 | iex
#
# Pulls ghcr.io/yannleonard/castor:latest, generates a secret key, picks free ports and starts Castor.
# Optional overrides (e.g. $env:CASTOR_HTTPS_PORT = '9443'): CASTOR_HTTPS_PORT (8443), CASTOR_PORT (8080),
#   CASTOR_SECRET_KEY, CASTOR_IMAGE, CASTOR_NAME, CASTOR_DATA, CASTOR_SOCKET_MODE (ro | rw).
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
# Native commands (docker) are judged by exit code, not by stderr output.
$PSNativeCommandUseErrorActionPreference = $false

$Image      = if ($env:CASTOR_IMAGE)       { $env:CASTOR_IMAGE }       else { 'ghcr.io/yannleonard/castor:latest' }
$Name       = if ($env:CASTOR_NAME)        { $env:CASTOR_NAME }        else { 'castor' }
$Data       = if ($env:CASTOR_DATA)        { $env:CASTOR_DATA }        else { 'castor-data' }
$SocketMode = if ($env:CASTOR_SOCKET_MODE) { $env:CASTOR_SOCKET_MODE } else { 'ro' }
$KeyFile    = Join-Path $HOME '.castor-secret.key'

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host " OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host " X  $m" -ForegroundColor Red; exit 1 }

# Runs `docker <args>` silently and returns its exit code (PowerShell 5.1 -> 7.x, works inside iex).
function Invoke-Docker {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & docker @args 2>&1 | Out-Null } catch { } finally { $ErrorActionPreference = $eap }
  return $LASTEXITCODE
}

# --- Docker reachable? -------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Die "Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
}
if ((Invoke-Docker info) -ne 0) { Die "Cannot reach the Docker daemon. Is Docker Desktop running?" }
Ok "Docker is available."

# --- secret key: environment > saved file > generate -------------------------
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
  Ok "Generated a secret key and saved it to $KeyFile."
}
if ($Key -notmatch '^[0-9a-fA-F]{64}$') { Die "CASTOR_SECRET_KEY must be 64 hex characters (32 bytes)." }

# --- free host ports (HTTP 8080, HTTPS 8443) ---------------------------------
function Test-PortBusy($p) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); return $true }
  catch { return $false }
}
$Port = if ($env:CASTOR_PORT) { [int]$env:CASTOR_PORT } else { 8080 }
if (Test-PortBusy $Port) {
  Warn "Port $Port is busy - searching for a free one..."
  foreach ($p in 8081,8082,8090,9000,9090) { if (-not (Test-PortBusy $p)) { $Port = $p; break } }
}
$HttpsPort = if ($env:CASTOR_HTTPS_PORT) { [int]$env:CASTOR_HTTPS_PORT } else { 8443 }
if ((Test-PortBusy $HttpsPort) -or ($HttpsPort -eq $Port)) {
  Warn "Port $HttpsPort is busy - searching for a free one..."
  foreach ($p in 8444,8445,8543,9443,9444) { if (($p -ne $Port) -and -not (Test-PortBusy $p)) { $HttpsPort = $p; break } }
}
Ok "Using host ports $HttpsPort (HTTPS) and $Port (HTTP)."

# --- pull + (re)create -------------------------------------------------------
Info "Pulling $Image ..."
if ((Invoke-Docker pull $Image) -ne 0) { Die "Failed to pull $Image. Check your network connection." }
Ok "Image pulled."

$ErrorActionPreference = 'Continue'
$exists = (& docker ps -a --format '{{.Names}}' 2>$null) | Where-Object { $_ -eq $Name }
$ErrorActionPreference = 'Stop'
if ($exists) {
  Warn "Replacing the existing '$Name' container (the '$Data' volume is kept)."
  Invoke-Docker rm -f $Name | Out-Null
}

Info "Starting Castor..."
# The container listens on the published HTTPS port so the HTTP redirect lands on it.
$code = Invoke-Docker run -d --name $Name `
  -p "${Port}:8080" `
  -p "${HttpsPort}:${HttpsPort}" `
  -e "CASTOR_SECRET_KEY=$Key" `
  -e "CASTOR_HTTPS_ADDR=:${HttpsPort}" `
  -v "/var/run/docker.sock:/var/run/docker.sock:$SocketMode" `
  -v "${Data}:/data" `
  --restart unless-stopped `
  $Image
if ($code -ne 0) { Die "docker run failed." }

# --- wait for health ---------------------------------------------------------
Info "Waiting for Castor to become healthy..."
$ErrorActionPreference = 'Continue'   # docker may write warnings to stderr here
for ($i = 0; $i -lt 30; $i++) {
  $status = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Name 2>$null | Select-Object -Last 1)
  if ($status -eq 'healthy') { Ok "Castor is healthy."; break }
  if ($status -eq 'exited' -or $status -eq 'dead') { & docker logs --tail 20 $Name 2>&1; Die "Castor exited. See the logs above." }
  Start-Sleep -Seconds 2
}
$ErrorActionPreference = 'Stop'

# --- done --------------------------------------------------------------------
Write-Host ""
Write-Host "Castor is up!" -ForegroundColor Green
Write-Host ""
Write-Host "   Open https://localhost:$HttpsPort and create your admin account."
Write-Host "   Your browser warns about the self-signed certificate: accept it once, or replace it in Settings -> HTTPS." -ForegroundColor Yellow
Write-Host ""
