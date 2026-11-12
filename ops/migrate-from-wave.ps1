# Copyright 2026, Wavelet contributors
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
Copies the data of an official Wave Terminal install into Wavelet: tabs, layouts, scrollback, settings, widgets.

.DESCRIPTION
Wave's own files are only ever read. Its databases are snapshotted consistently, so Wave may stay open while this
runs. The copy reflects Wave's state at the moment of the snapshot; run it again (with -Force) to pick up later
changes, as long as you have not started keeping things in Wavelet that you care about.

Wavelet itself must be closed, because its databases get replaced. With -Force, whatever Wavelet had before is moved
into a backup folder next to its data first.
#>
param(
    # replace Wavelet data that already exists (it is backed up first)
    [switch]$Force,
    # also copy logins and site data of web blocks; this needs Wave to be closed
    [switch]$IncludeBrowserData
)

. $PSScriptRoot\lib.ps1
Add-BuildToolsToPath

$waveData = Join-Path $env:LOCALAPPDATA 'waveterm\Data'
$waveConfig = Join-Path $HOME '.config\waveterm'
$waveUserData = Join-Path $env:APPDATA 'Wave'
$target = Get-ProfilePaths

if (-not (Test-Path (Join-Path $waveData 'db\waveterm.db'))) {
    throw "no Wave Terminal data found at $waveData"
}
if ((Get-ProcessesUnder $InstallRoot).Count -gt 0) {
    throw "$AppName is running; close it first (its databases are about to be replaced)"
}

$targetDb = Join-Path $target.Data 'db'
$hasExisting = (Test-Path (Join-Path $targetDb 'waveterm.db')) -or
    ((Test-Path $target.Config) -and @(Get-ChildItem $target.Config -Force).Count -gt 0)
if ($hasExisting) {
    if (-not $Force) {
        throw "$AppName already has data in $($target.Data) or $($target.Config); pass -Force to replace it (a backup is kept)"
    }
    $backup = Join-Path $target.Data ("backups\pre-migrate-{0:yyyyMMdd-HHmmss}" -f (Get-Date))
    Write-Step "backing up existing $AppName data to $backup"
    New-Item -ItemType Directory -Force $backup | Out-Null
    if (Test-Path $targetDb) {
        Move-Item $targetDb (Join-Path $backup 'db')
    }
    if (Test-Path $target.Config) {
        Move-Item $target.Config (Join-Path $backup 'config')
    }
}

Write-Step "snapshotting Wave's databases"
Copy-SqliteSnapshot (Join-Path $waveData 'db\waveterm.db') (Join-Path $targetDb 'waveterm.db')
Copy-SqliteSnapshot (Join-Path $waveData 'db\filestore.db') (Join-Path $targetDb 'filestore.db')

Write-Step "copying configuration"
New-Item -ItemType Directory -Force $target.Config | Out-Null
if (Test-Path $waveConfig) {
    Copy-Item -Path (Join-Path $waveConfig '*') -Destination $target.Config -Recurse -Force
}
Get-ChildItem $target.Config -Force | ForEach-Object { Write-Host "    $($_.Name)" }

if ($IncludeBrowserData) {
    if (@(Get-Process -Name 'Wave' -ErrorAction SilentlyContinue).Count -gt 0) {
        Write-Warning "Wave is running, so its browser data is locked and was NOT copied. Close Wave and run again with -Force -IncludeBrowserData."
    } elseif (Test-Path $waveUserData) {
        Write-Step "copying web block logins and site data"
        New-Item -ItemType Directory -Force $target.UserData | Out-Null
        # caches are rebuilt on demand, and the lock files belong to the other app
        $skipDirs = 'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'blob_storage', 'Shared Dictionary'
        Invoke-Robocopy $waveUserData $target.UserData /E /XD @skipDirs /XF lockfile SingletonLock SingletonCookie SingletonSocket
    }
}

Write-Step "done. $AppName will open with Wave's tabs as they were at $(Get-Date -Format 'HH:mm:ss')."
