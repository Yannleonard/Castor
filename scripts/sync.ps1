# Castor - keep a local copy of the repository (default D:\Castor) in sync with GitHub, on Windows.
#
#   .\sync.ps1                       # clone D:\Castor, or bring it up to date with GitHub, now
#   .\sync.ps1 -Branch main          # switch to a branch first (e.g. a claude/... branch), then update it
#   .\sync.ps1 -Install              # same as .\sync.ps1, then again every 30 min (Task Scheduler)
#   .\sync.ps1 -Uninstall            # remove the scheduled task
#
# Safe by design: it only ever fast-forwards. Local edits are never overwritten and local commits are
# never discarded - when the update cannot be applied cleanly, it is skipped and the reason is printed
# (and written to %LOCALAPPDATA%\Castor\sync.log). Runbook: docs/runbooks/local-sync.md
#Requires -Version 5.1
[CmdletBinding(DefaultParameterSetName = 'Sync')]
param(
  [string]$Path = 'D:\Castor',
  [string]$Branch,
  [string]$Repo = 'https://github.com/Yannleonard/Castor.git',
  [Parameter(ParameterSetName = 'Install')][switch]$Install,
  [Parameter(ParameterSetName = 'Install')][ValidateRange(5, 1440)][int]$EveryMinutes = 30,
  [Parameter(ParameterSetName = 'Uninstall')][switch]$Uninstall,
  # Set by the scheduled task: never moves folders around, only logs.
  [switch]$Unattended
)
$ErrorActionPreference = 'Stop'
# Native commands (git) are judged by exit code, not by stderr output.
$PSNativeCommandUseErrorActionPreference = $false

$TaskName = 'Castor sync'
$StateDir = Join-Path $env:LOCALAPPDATA 'Castor'
$LogFile  = Join-Path $StateDir 'sync.log'
$Path     = $Path.TrimEnd('\', '/')

function Add-SyncLog($level, $m) {
  try {
    if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }
    if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) { Move-Item $LogFile "$LogFile.old" -Force }
    Add-Content -Path $LogFile -Encoding UTF8 -Value ('{0} {1} {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $level, $m)
  } catch { }
}
function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan;   Add-SyncLog 'INFO' $m }
function Ok($m)   { Write-Host " OK  $m" -ForegroundColor Green; Add-SyncLog 'OK  ' $m }
function Warn($m) { Write-Host "  !  $m" -ForegroundColor Yellow; Add-SyncLog 'WARN' $m }
function Die($m)  { Write-Host " X  $m" -ForegroundColor Red;    Add-SyncLog 'FAIL' $m; exit 1 }

# Runs `git <args>` and returns its exit code and combined output (PowerShell 5.1 -> 7.x).
function Invoke-Git([string[]]$GitArgs, [switch]$InRepo) {
  if ($InRepo) { $GitArgs = @('-C', $Path) + $GitArgs }
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  # Git speaks UTF-8; Windows PowerShell would otherwise decode commit subjects with the OEM code page.
  $enc = $null; try { $enc = [Console]::OutputEncoding; [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }
  try { $out = & git @GitArgs 2>&1 | ForEach-Object { "$_" } }
  finally { $ErrorActionPreference = $eap; if ($enc) { try { [Console]::OutputEncoding = $enc } catch { } } }
  [pscustomobject]@{ Code = $LASTEXITCODE; Out = (($out | Where-Object { $_ }) -join "`n").Trim() }
}

# "https://github.com/Owner/Repo.git", "git@github.com:owner/repo" ... -> "github.com/owner/repo"
function Get-RepoId([string]$url) {
  $u = $url.Trim().ToLowerInvariant() -replace '^(https?|ssh|git)://', '' -replace '^[^@/]+@', ''
  ($u -replace '^([^/:]+):', '$1/' -replace '/+$', '' -replace '\.git$', '')
}

# --- -Uninstall ----------------------------------------------------------------
if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Ok "Scheduled task '$TaskName' removed."
  } else { Info "No scheduled task '$TaskName' to remove." }
  Remove-Item (Join-Path $StateDir 'castor-sync.ps1') -Force -ErrorAction SilentlyContinue
  exit 0
}

# --- prerequisites ---------------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Die "Git is not installed. Install it with: winget install --id Git.Git -e   (or https://git-scm.com/download/win), then open a new PowerShell window."
}
if ($Install -and -not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) { Die "-Install needs Windows Task Scheduler." }
if ($Unattended) { $env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never' }  # never hang on a login prompt

# --- clone / adopt the folder ----------------------------------------------------
function Invoke-Clone {
  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path $parent)) { Die "The parent folder $parent does not exist (is the drive connected?)." }
  Info "Cloning $Repo into $Path ..."
  $cloneArgs = @('clone')
  if ($Branch) { $cloneArgs += @('--branch', $Branch) }
  $r = Invoke-Git ($cloneArgs + @($Repo, $Path))
  if ($r.Code -ne 0) { Die "git clone failed:`n$($r.Out)" }
  $head = Invoke-Git @('log', '-1', '--format=%h %s') -InRepo
  Ok "Cloned. $Path is now a copy of GitHub ($($head.Out))."
}

function Sync-Repo {
  $isEmpty = (Test-Path $Path) -and -not (Get-ChildItem -LiteralPath $Path -Force | Select-Object -First 1)
  if (-not (Test-Path $Path) -or $isEmpty) {
    Invoke-Clone
    return
  }
  if (-not (Test-Path (Join-Path $Path '.git'))) {
    # A plain folder (e.g. an unzipped download): keep it aside untouched and clone in its place.
    if ($Unattended) { Die "$Path is not a Git clone. Run sync.ps1 once by hand to set it up." }
    $backup = '{0}.backup-{1}' -f $Path, (Get-Date -Format 'yyyyMMdd-HHmmss')
    Warn "$Path exists but is not a Git clone. Moving it aside to $backup (nothing is deleted)."
    try { Move-Item -LiteralPath $Path -Destination $backup }
    catch { Die "Could not move $Path (close VS Code, Explorer or any program using it, then retry): $($_.Exception.Message)" }
    Invoke-Clone
    Warn "Your previous files are in $backup - copy back anything local you still need (.env, data\, ...)."
    return
  }

  # update an existing clone
  $r = Invoke-Git @('rev-parse', '--git-dir') -InRepo
  if ($r.Out -match 'dubious ownership') {
    # Common on external/exFAT drives or folders created by another account.
    $safe = $Path -replace '\\', '/'
    Info "Marking $safe as a trusted Git folder (git config --global safe.directory)."
    $null = Invoke-Git @('config', '--global', '--add', 'safe.directory', $safe)
    $r = Invoke-Git @('rev-parse', '--git-dir') -InRepo
  }
  if ($r.Code -ne 0) { Die "$Path is not a usable Git repository:`n$($r.Out)" }

  $origin = Invoke-Git @('remote', 'get-url', 'origin') -InRepo
  if ($origin.Code -ne 0) {
    Info "No 'origin' remote - adding $Repo."
    $r = Invoke-Git @('remote', 'add', 'origin', $Repo) -InRepo
    if ($r.Code -ne 0) { Die "Could not add the origin remote:`n$($r.Out)" }
  } elseif ((Get-RepoId $origin.Out) -ne (Get-RepoId $Repo)) {
    Die "$Path points to $($origin.Out), not to $Repo. Nothing changed."
  }

  Info "Fetching from GitHub ..."
  $r = Invoke-Git @('fetch', '--prune', 'origin') -InRepo
  if ($r.Code -ne 0) { Die "git fetch failed (network?):`n$($r.Out)" }

  $current = (Invoke-Git @('symbolic-ref', '--quiet', '--short', 'HEAD') -InRepo).Out
  if ($Branch -and $Branch -ne $current) {
    Info "Switching to branch $Branch ..."
    $r = Invoke-Git @('switch', $Branch) -InRepo
    if ($r.Code -ne 0) { Die "Could not switch to $Branch (uncommitted changes in the way, or no such branch on GitHub):`n$($r.Out)" }
    $current = $Branch
  }
  if (-not $current) { Warn "$Path is not on a branch (detached HEAD) - nothing to update. Run: git -C `"$Path`" switch main"; return }

  $up = Invoke-Git @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}') -InRepo
  if ($up.Code -ne 0) {
    if ((Invoke-Git @('rev-parse', '--verify', '--quiet', "refs/remotes/origin/$current") -InRepo).Code -ne 0) {
      Warn "Branch '$current' does not exist on GitHub - nothing to update."
      return
    }
    $null = Invoke-Git @('branch', "--set-upstream-to=origin/$current") -InRepo
  }

  $counts = (Invoke-Git @('rev-list', '--left-right', '--count', 'HEAD...@{u}') -InRepo).Out -split '\s+'
  $ahead, $behind = [int]$counts[0], [int]$counts[1]
  if ($behind -eq 0) {
    $head = (Invoke-Git @('log', '-1', '--format=%h %s') -InRepo).Out
    if ($ahead -gt 0) { Ok "Up to date with GitHub on '$current' ($ahead local commit(s) not pushed yet)." }
    else { Ok "Already up to date on '$current' ($head)." }
    return
  }
  if ($ahead -gt 0) {
    Warn "'$current' has $ahead local commit(s) that are not on GitHub and GitHub has $behind new one(s). Not updating automatically - merge by hand: git -C `"$Path`" pull"
    return
  }

  $old = (Invoke-Git @('rev-parse', 'HEAD') -InRepo).Out
  $r = Invoke-Git @('merge', '--ff-only', '@{u}') -InRepo
  if ($r.Code -ne 0) {
    Warn "Update of '$current' skipped - Git refused so as not to overwrite your local changes:`n$($r.Out)`nCommit or undo those changes, then run the sync again."
    return
  }
  Ok "Updated '$current': $behind new commit(s) from GitHub."
  (Invoke-Git @('log', '--oneline', '--no-decorate', '-n', '15', "$old..HEAD") -InRepo).Out -split "`n" |
    ForEach-Object { Write-Host "      $_"; Add-SyncLog '    ' $_ }
}

Sync-Repo

# --- -Install: run this script on a schedule ------------------------------------
if ($Install) {
  # Run a private copy, so the task keeps working whatever happens to the working tree.
  $source = if ($PSCommandPath) { $PSCommandPath } else { Join-Path $Path 'scripts\sync.ps1' }
  if (-not (Test-Path $source)) { Die "Save sync.ps1 to a file and run it from there to use -Install." }
  $copy = Join-Path $StateDir 'castor-sync.ps1'
  if ((Resolve-Path $source).Path -ne $copy) { Copy-Item -LiteralPath $source -Destination $copy -Force }

  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Path "{1}" -Unattended' -f $copy, $Path)
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force `
    -Description "Keeps $Path up to date with $Repo (fast-forward only). Log: $LogFile" | Out-Null
  Ok "Scheduled task '$TaskName' installed: $Path syncs every $EveryMinutes min while you are logged on."
  Info "Log: $LogFile   -   remove with: .\sync.ps1 -Uninstall"
}
