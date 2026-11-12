# Copyright 2026, Wavelet contributors
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
Builds a release of the app into make\win-unpacked.

.DESCRIPTION
A full, clean production build: Go backend, wsh, frontend, and the unpacked Electron app. The version is derived from
the git history (see Get-ReleaseVersion), so nothing in the working tree is edited.

A dev instance running from this checkout must be closed first, because the build replaces the dist directory it runs
from.
#>
param(
    # build even though the working tree has uncommitted changes
    [switch]$AllowDirty
)

. $PSScriptRoot\lib.ps1
Add-BuildToolsToPath

Push-Location $RepoRoot
try {
    $dirty = @(& git status --porcelain)
    if ($dirty.Count -gt 0 -and -not $AllowDirty) {
        throw "the working tree has uncommitted changes; commit them or pass -AllowDirty"
    }
    $running = Get-ProcessesUnder $RepoRoot
    if ($running.Count -gt 0) {
        throw "a dev instance is running from this checkout (pid $($running[0].ProcessId)); close it first"
    }

    & node ops\fork-notices.mjs --check

    $env:WAVELET_VERSION = Get-ReleaseVersion
    Write-Step "packaging $AppName $($env:WAVELET_VERSION)$(if ($dirty.Count -gt 0) { ' (uncommitted changes included)' })"
    $timer = [Diagnostics.Stopwatch]::StartNew()
    & task package

    $exe = Join-Path $RepoRoot "make\win-unpacked\$AppName.exe"
    if (-not (Test-Path $exe)) {
        throw "packaging finished but $exe does not exist"
    }
    $sizeMb = (Get-ChildItem (Split-Path -Parent $exe) -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
    Write-Step ("packaged in {0:N0}s, {1:N0} MB: {2}" -f $timer.Elapsed.TotalSeconds, $sizeMb, (Split-Path -Parent $exe))
} finally {
    Pop-Location
}
