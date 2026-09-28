> 🇬🇧 **English** · [🇫🇷 Français](local-sync.fr.md)

# Keep a local copy in sync with GitHub (Windows)

[`scripts/sync.ps1`](../../scripts/sync.ps1) keeps a local folder (default `D:\Castor`) up to date with
`https://github.com/Yannleonard/Castor`: it clones it when missing, then pulls the new commits on every
run — on demand or automatically every 30 minutes.

The script **only fast-forwards**: it never overwrites a local edit and never drops a local commit. When
the update cannot be applied cleanly, it skips it and says why.

## Prerequisites

- **Git for Windows**: `winget install --id Git.Git -e` (or <https://git-scm.com/download/win>), then
  reopen PowerShell.

## Setup (once)

In PowerShell:

```powershell
irm https://raw.githubusercontent.com/Yannleonard/Castor/main/scripts/sync.ps1 -OutFile $env:USERPROFILE\castor-sync.ps1
powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\castor-sync.ps1 -Install
```

The first run prepares `D:\Castor`:

| State of `D:\Castor` | What the script does |
|---|---|
| missing or empty | `git clone` the repository |
| already a Git clone of Castor | update it from GitHub |
| plain folder (e.g. an unzipped download) | rename it to `D:\Castor.backup-<date>` (nothing is deleted), then clone; copy back what is yours afterwards (`.env`, `data\`, …) |

`-Install` then creates the **Castor sync** scheduled task, which re-runs the sync every 30 minutes while
you are logged on (and on wake-up if a run was missed). A PowerShell window may flash for a split second
on each run.

## Usage

```powershell
D:\Castor\scripts\sync.ps1                           # sync now
D:\Castor\scripts\sync.ps1 -Branch claude/my-branch  # switch to another branch, then update it
D:\Castor\scripts\sync.ps1 -Branch main              # back to main
D:\Castor\scripts\sync.ps1 -Install -EveryMinutes 60 # change the interval
D:\Castor\scripts\sync.ps1 -Uninstall                # remove the scheduled task
```

(If PowerShell refuses to run the script, prefix with `powershell -ExecutionPolicy Bypass -File`.)

The scheduled task updates **the branch currently checked out** in `D:\Castor`. Other options: `-Path`
(a folder other than `D:\Castor`) and `-Repo` (another URL, e.g. a fork).

## When the update is skipped

Everything is logged to `%LOCALAPPDATA%\Castor\sync.log`.

- **Local edits to files GitHub also changed**: commit (`git commit`) or undo them, then run again.
- **Unpushed local commits while GitHub moved on**: merge by hand with `git -C D:\Castor pull`, then
  `git push` if needed.
- **"dubious ownership"** (external/exFAT drive, folder created by another account): the script adds
  `D:/Castor` to Git's `safe.directory` automatically.

Sync is one-way (GitHub → PC). To send your own changes to GitHub, use `git add`, `git commit` and
`git push` as usual.
