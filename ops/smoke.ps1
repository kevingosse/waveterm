# Copyright 2026, Wavelet contributors
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
Launches a packaged build under a throwaway profile and checks that it actually works.

.DESCRIPTION
Catches the failures that only show up in a packaged app (asar paths, missing binaries, production-only code paths)
before the build gets anywhere near the installed app. The instance runs under the "smoke" profile, so it can run
while the installed app is open and never touches its data.

Passes when a window comes up, a new terminal block reaches a shell prompt, and nothing fatal is in the log.
Running the build here also gets antivirus first-run scanning of the new binaries out of the way.
#>
param(
    [string]$AppDir,
    [int]$Port = 9444,
    # leave the instance running and its profile on disk, for a closer look
    [switch]$Keep
)

. $PSScriptRoot\lib.ps1
Add-BuildToolsToPath
if (-not $AppDir) {
    $AppDir = Join-Path $RepoRoot 'make\win-unpacked'
}
$exe = Join-Path $AppDir "$AppName.exe"
if (-not (Test-Path $exe)) {
    throw "$exe not found; run ops\package.ps1 first"
}

$profilePaths = Get-ProfilePaths 'smoke'
$profileRoots = @((Split-Path -Parent $profilePaths.Data), $profilePaths.Config, (Split-Path -Parent $profilePaths.UserData))

function Remove-SmokeProfile {
    foreach ($dir in $profileRoots) {
        if (Test-Path $dir) {
            Remove-Item -Recurse -Force $dir
        }
    }
}

# anything still running from this directory is a leftover of an earlier smoke run
Stop-ProcessesUnder $AppDir
Remove-SmokeProfile

Write-Step "launching $exe (profile: smoke, debug port: $Port)"
$env:WAVELET_PROFILE = 'smoke'
$env:WAVELET_CDP_PORT = "$Port"
$launched = Get-Date
try {
    Start-Process -FilePath $exe -WorkingDirectory $AppDir | Out-Null
} finally {
    Remove-Item Env:WAVELET_PROFILE, Env:WAVELET_CDP_PORT
}

$log = Join-Path $profilePaths.Data 'waveapp.log'
$failed = $null
try {
    $deadline = (Get-Date).AddSeconds(120)
    while (-not ((Test-Path $log) -and (Select-String -Path $log -Pattern 'show window' -Quiet))) {
        if ((Get-Date) -gt $deadline) {
            throw "no window after 120s"
        }
        if ((Get-ProcessesUnder $AppDir).Count -eq 0) {
            throw "the app exited before showing a window"
        }
        if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'error running wavesrv|wavesrv exited' -Quiet)) {
            throw "the backend did not start"
        }
        Start-Sleep -Milliseconds 500
    }
    $windowAfter = ((Get-Date) - $launched).TotalSeconds
    Write-Step ("window shown {0:N1}s after launch" -f $windowAfter)

    Write-Step "timing a new terminal block to its first prompt"
    $timing = & node (Join-Path $PSScriptRoot 'measure-prompt.mjs') --port $Port --runs 2 --target active
    $timing | ForEach-Object { Write-Host "    $_" }
    if (-not ($timing | Select-String -Pattern 'PROMPT \d+ ms' -Quiet)) {
        throw "a new terminal block never reached a prompt"
    }

    $fatal = @(Select-String -Path $log -Pattern 'panic:|\[panic\]|Uncaught Exception|error initializing|wavesrv exited' | Select-Object -First 5)
    if ($fatal.Count -gt 0) {
        $fatal | ForEach-Object { Write-Host "    $($_.Line)" -ForegroundColor Red }
        throw "fatal errors in the log"
    }
    Get-Content $log | Select-String -Pattern 'wave version|wavesrv ready signal|tabview init|wave-ready init' | Select-Object -First 6 |
        ForEach-Object { Write-Host "    $($_.Line)" }
} catch {
    $failed = $_
    if (Test-Path $log) {
        Write-Host "--- last log lines ($log)" -ForegroundColor Yellow
        Get-Content $log -Tail 40 | ForEach-Object { Write-Host "    $_" }
    }
}

if ($Keep) {
    Write-Step "left running (profile dirs: $($profileRoots -join ', '))"
} else {
    Stop-ProcessesUnder $AppDir
    Remove-SmokeProfile
}
if ($failed) {
    throw "smoke test FAILED: $failed"
}
Write-Step "smoke test passed"
