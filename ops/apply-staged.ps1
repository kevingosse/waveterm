# Copyright 2026, Wavelet contributors
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
Activates the staged build: app.staged becomes app, and the old app is kept as app.prev.

.DESCRIPTION
The swap can only happen while the installed app is not running. With -WaitForExit this script waits for that
moment, which is how a deploy made from inside the app itself gets applied: the app keeps running the old version
and the new one takes over the next time it is started.

The databases are copied aside before the swap, because a new version may migrate them in a way the previous version
cannot read. ops\rollback.ps1 can put both back.
#>
param(
    [switch]$WaitForExit,
    # start the app again after the swap
    [switch]$Relaunch
)

. $PSScriptRoot\lib.ps1

$KeepBackups = 5

try {
    if (-not (Test-Path $StagedAppDir)) {
        Write-DeployLog "apply: nothing staged"
        return
    }
    if ($WaitForExit) {
        Write-DeployLog "apply: waiting for $AppName to exit"
        while ((Get-ProcessesUnder $LiveAppDir).Count -gt 0) {
            Start-Sleep -Seconds 1
        }
        # give Windows a moment to release the handles of the processes that just went away
        Start-Sleep -Seconds 1
    } elseif ((Get-ProcessesUnder $LiveAppDir).Count -gt 0) {
        throw "$AppName is running; close it, or pass -WaitForExit"
    }
    if (-not (Test-Path $StagedAppDir)) {
        # another waiting instance of this script got there first
        return
    }

    $profilePaths = Get-ProfilePaths
    $dbDir = Join-Path $profilePaths.Data 'db'
    if (Test-Path $dbDir) {
        $backupRoot = Join-Path $profilePaths.Data 'backups'
        $backup = Join-Path $backupRoot ("{0:yyyyMMdd-HHmmss}" -f (Get-Date))
        New-Item -ItemType Directory -Force $backup | Out-Null
        Copy-Item -Path (Join-Path $dbDir '*') -Destination $backup -Force
        Write-DeployLog "apply: databases backed up to $backup"
        Get-ChildItem $backupRoot -Directory | Where-Object Name -match '^\d{8}-\d{6}$' | Sort-Object Name -Descending |
            Select-Object -Skip $KeepBackups | ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
    }

    if (Test-Path $PrevAppDir) {
        Remove-Item -Recurse -Force $PrevAppDir
    }
    if (Test-Path $LiveAppDir) {
        Rename-Item $LiveAppDir (Split-Path -Leaf $PrevAppDir)
    }
    Rename-Item $StagedAppDir (Split-Path -Leaf $LiveAppDir)

    $exe = Join-Path $LiveAppDir "$AppName.exe"
    $shortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $LiveAppDir
    $shortcut.Description = "$AppName terminal"
    $shortcut.Save()
    # Explorer caches icons by path, and the path of the executable never changes; without this a new app icon
    # does not show up on the Start menu or on a pinned taskbar button
    $iconRefresh = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
    if (Test-Path $iconRefresh) {
        Start-Process -FilePath $iconRefresh -ArgumentList '-show' -WindowStyle Hidden
    }

    # Antivirus holds a Go binary it has not seen at its path for about ten seconds on first launch. Take that now, in
    # the background, instead of on the next start of the app (wavesrv) or the first wsh command in a terminal.
    $binDir = Join-Path $LiveAppDir 'resources\app.asar.unpacked\dist\bin'
    $wsh = Get-ChildItem $binDir -Filter 'wsh-*-windows.x64.exe' | Select-Object -First 1
    $dataBin = Join-Path $profilePaths.Data 'bin'
    if ($wsh -and (Test-Path $dataBin)) {
        # the same copy wavesrv would make on its next start; doing it here lets it be scanned ahead of time too
        Copy-Item $wsh.FullName (Join-Path $dataBin 'wsh.exe') -Force
    }
    $warmups = @(Get-ChildItem $binDir -Filter '*.exe') + @(Get-ChildItem $dataBin -Filter 'wsh.exe' -ErrorAction SilentlyContinue)
    foreach ($binary in $warmups) {
        Start-Process -FilePath $binary.FullName -ArgumentList 'version' -WindowStyle Hidden | Out-Null
    }

    $version = Get-AppVersion $LiveAppDir
    Write-DeployLog "apply: $AppName $version is now live"
    Write-Host "==> $AppName $version is now live ($exe)" -ForegroundColor Cyan
    if ($Relaunch) {
        Start-Process -FilePath $exe -WorkingDirectory $LiveAppDir | Out-Null
    }
} catch {
    Write-DeployLog "apply: FAILED: $_"
    throw
}
