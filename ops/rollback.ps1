# Copyright 2026, Wavelet contributors
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
Goes back to the version that was installed before the last deploy.

.DESCRIPTION
Swaps app and app.prev, so running it twice returns to where you started. The app must be closed.

A newer version may have migrated the databases. If the previous version then fails to start, restore the backup
that was taken right before that deploy with -RestoreData. Without a value it lists the backups; with a backup name
it puts that backup back (the current databases are kept beside it as "replaced-<time>").
#>
param(
    [string]$RestoreData,
    [switch]$ListBackups
)

. $PSScriptRoot\lib.ps1

$profilePaths = Get-ProfilePaths
$backupRoot = Join-Path $profilePaths.Data 'backups'
if ($ListBackups) {
    if (Test-Path $backupRoot) {
        Get-ChildItem $backupRoot -Directory | Sort-Object Name -Descending | ForEach-Object { Write-Host $_.Name }
    }
    return
}

if ((Get-ProcessesUnder $InstallRoot).Count -gt 0) {
    throw "$AppName is running; close it first"
}
if (-not (Test-Path $PrevAppDir)) {
    throw "there is no previous version to go back to ($PrevAppDir does not exist)"
}

if ($RestoreData) {
    $backup = Join-Path $backupRoot $RestoreData
    if (-not (Test-Path (Join-Path $backup 'waveterm.db'))) {
        throw "$backup is not a database backup (see -ListBackups)"
    }
    $dbDir = Join-Path $profilePaths.Data 'db'
    $replaced = Join-Path $backupRoot ("replaced-{0:yyyyMMdd-HHmmss}" -f (Get-Date))
    Move-Item $dbDir $replaced
    New-Item -ItemType Directory -Force $dbDir | Out-Null
    Copy-Item -Path (Join-Path $backup '*') -Destination $dbDir -Force
    Write-DeployLog "rollback: databases restored from $backup (previous ones kept in $replaced)"
    Write-Step "databases restored from $RestoreData"
}

$swapDir = Join-Path $InstallRoot 'app.swap'
Rename-Item $LiveAppDir (Split-Path -Leaf $swapDir)
Rename-Item $PrevAppDir (Split-Path -Leaf $LiveAppDir)
Rename-Item $swapDir (Split-Path -Leaf $PrevAppDir)

$version = Get-AppVersion $LiveAppDir
Write-DeployLog "rollback: $AppName $version is live again"
Write-Step "$AppName $version is live again"
