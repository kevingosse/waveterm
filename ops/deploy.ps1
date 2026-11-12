# Copyright 2026, Wavelet contributors
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
Builds the current commit and makes it the installed app.

.DESCRIPTION
  1. package     clean production build (ops\package.ps1)
  2. smoke test  the packaged build has to start and reach a shell prompt under a throwaway profile (ops\smoke.ps1)
  3. stage       copy the build next to the installed app
  4. swap        if the installed app is closed it is replaced right away; if it is running, the new version takes
                 over when it exits (ops\apply-staged.ps1 waits in the background), so deploying from a terminal
                 inside the app is safe

The previous version stays in app.prev and the databases are backed up before every swap; ops\rollback.ps1 undoes a
deploy. Each deployed commit is tagged with its version.
#>
param(
    # deploy what ops\package.ps1 already built
    [switch]$SkipPackage,
    [switch]$SkipSmoke,
    # build with uncommitted changes (the build is then not tagged)
    [switch]$AllowDirty,
    # when the installed app is running: close it and start the new version once the swap is done
    [switch]$Restart
)

. $PSScriptRoot\lib.ps1
Add-BuildToolsToPath

$version = Get-ReleaseVersion
$dirty = @(& git -C $RepoRoot status --porcelain).Count -gt 0
$built = Join-Path $RepoRoot 'make\win-unpacked'

if (-not $SkipPackage) {
    & (Join-Path $PSScriptRoot 'package.ps1') -AllowDirty:$AllowDirty
}
$exe = Join-Path $built "$AppName.exe"
if (-not (Test-Path $exe)) {
    throw "$exe not found; run without -SkipPackage"
}
$builtVersion = Get-AppVersion $built
if ($builtVersion -ne $version) {
    throw "make\win-unpacked holds version $builtVersion but this commit is $version; run without -SkipPackage"
}

if (-not $SkipSmoke) {
    & (Join-Path $PSScriptRoot 'smoke.ps1') -AppDir $built
}

Write-Step "staging $AppName $version"
New-Item -ItemType Directory -Force $InstallRoot | Out-Null
Invoke-Robocopy $built $StagedAppDir /MIR
Write-DeployLog "deploy: staged $version ($(& git -C $RepoRoot rev-parse --short HEAD)$(if ($dirty) { ', dirty' }))"

if (-not $dirty) {
    & git -C $RepoRoot tag -f "v$version" | Out-Null
}

$apply = Join-Path $PSScriptRoot 'apply-staged.ps1'
$running = Get-ProcessesUnder $LiveAppDir
if ($running.Count -eq 0) {
    & $apply
    return
}

# Detached and windowless on purpose: it has to outlive this shell, which may itself be running inside the app.
$applyArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$apply`"", '-WaitForExit')
if ($Restart) {
    $applyArgs += '-Relaunch'
}
Start-Process -FilePath 'pwsh' -ArgumentList $applyArgs -WindowStyle Hidden | Out-Null
if ($Restart) {
    Write-Step "$AppName is running: closing it; version $version starts as soon as the swap is done"
    Stop-ProcessesUnder $LiveAppDir
} else {
    Write-Step "$AppName is running: version $version is staged and takes over the next time $AppName is started"
}
