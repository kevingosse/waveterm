# Copyright 2026, Wavelet contributors
# SPDX-License-Identifier: Apache-2.0

# Shared by the ops scripts. Dot-source it: . $PSScriptRoot\lib.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$RepoRoot = Split-Path -Parent $PSScriptRoot
$AppName = 'Wavelet'
$DirPrefix = 'wavelet'
$VersionLine = '0.20'
# the upstream commit the fork started from; release versions count the commits since
$ForkBase = '9f1c9670d407be3b93cf090319a63ef30bf54d0e'

# Layout of the install root:
#   app\         the version that the Start menu shortcut launches
#   app.prev\    the version before that, kept for rollback
#   app.staged\  a new version waiting for the running app to exit
$InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\$AppName"
$LiveAppDir = Join-Path $InstallRoot 'app'
$PrevAppDir = Join-Path $InstallRoot 'app.prev'
$StagedAppDir = Join-Path $InstallRoot 'app.staged'
$DeployLog = Join-Path $InstallRoot 'deploy.log'

# Mirrors emain/emain-platform.ts: every profile has its own three directories.
function Get-ProfilePaths([string]$ProfileName = '') {
    $name = if ($ProfileName) { "$DirPrefix-$ProfileName" } else { $DirPrefix }
    [pscustomobject]@{
        Name     = $name
        Data     = Join-Path $env:LOCALAPPDATA "$name\Data"
        Config   = Join-Path $HOME ".config\$name"
        UserData = Join-Path $env:APPDATA "$name\electron"
    }
}

function Add-BuildToolsToPath {
    # where the toolchain lands when installed per-user; a shell started before the install does not have them on PATH yet
    foreach ($dir in @("$env:LOCALAPPDATA\Programs\Go\bin", "$env:LOCALAPPDATA\Microsoft\WinGet\Links")) {
        if ((Test-Path $dir) -and (($env:PATH -split ';') -notcontains $dir)) {
            $env:PATH = "$dir;$env:PATH"
        }
    }
    foreach ($tool in 'go', 'task', 'zig', 'node', 'npm', 'git') {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "$tool was not found on PATH (see the README for the toolchain)"
        }
    }
}

function Get-ProcessesUnder([string]$Dir) {
    $found = @()
    if (Test-Path $Dir) {
        $prefix = (Resolve-Path $Dir).Path.TrimEnd('\') + '\'
        $found = @(Get-CimInstance Win32_Process | Where-Object {
                $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
            })
    }
    # the comma keeps this an array for the caller even when it holds zero or one process
    , $found
}

function Stop-ProcessesUnder([string]$Dir) {
    # wavesrv flushes and closes its databases by itself once the app that started it is gone; only kill it if it lingers
    foreach ($proc in (Get-ProcessesUnder $Dir)) {
        if ($proc.Name -notlike 'wavesrv*') {
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    $graceUntil = (Get-Date).AddSeconds(5)
    while ((Get-ProcessesUnder $Dir).Count -gt 0 -and (Get-Date) -lt $graceUntil) {
        Start-Sleep -Milliseconds 200
    }
    foreach ($proc in (Get-ProcessesUnder $Dir)) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-ProcessesUnder $Dir).Count -gt 0) {
        if ((Get-Date) -gt $deadline) {
            throw "processes under $Dir are still running"
        }
        Start-Sleep -Milliseconds 200
    }
}

function Get-ReleaseVersion {
    $count = (& git -C $RepoRoot rev-list --count "$ForkBase..HEAD").Trim()
    "$VersionLine.$count"
}

function Get-AppVersion([string]$AppDir) {
    (Get-Item (Join-Path $AppDir "$AppName.exe")).VersionInfo.FileVersion
}

# robocopy reports success with exit codes below 8, which the native-command error preference would treat as failure
function Invoke-Robocopy {
    $PSNativeCommandUseErrorActionPreference = $false
    & robocopy @args /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed with exit code $LASTEXITCODE"
    }
    $global:LASTEXITCODE = 0
}

function Write-DeployLog([string]$Message) {
    New-Item -ItemType Directory -Force $InstallRoot | Out-Null
    Add-Content -Path $DeployLog -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $Message)
}

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

# Creates a process from an executable without running any of it (suspended, then ended at once) and returns the
# milliseconds that took. Antivirus scans an executable it has no verdict for at exactly this point, so this measures
# such a hold, and takes it ahead of time. Nothing appears on screen.
function Measure-SuspendedStart([string]$Exe) {
    if (-not ('SuspendedStart' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class SuspendedStart
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string app, IntPtr cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags,
        IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr h, uint code);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_NO_WINDOW = 0x08000000;

    public static double Time(string exe)
    {
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        PROCESS_INFORMATION pi;
        var sw = Stopwatch.StartNew();
        bool ok = CreateProcessW(exe, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, false,
            CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, null, ref si, out pi);
        sw.Stop();
        if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error());
        TerminateProcess(pi.hProcess, 0);
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return sw.Elapsed.TotalMilliseconds;
    }
}
'@
    }
    [SuspendedStart]::Time($Exe)
}

# Consistent copy of a SQLite database that may be open in a running app.
function Copy-SqliteSnapshot([string]$Source, [string]$Destination) {
    New-Item -ItemType Directory -Force (Split-Path -Parent $Destination) | Out-Null
    foreach ($suffix in '', '-wal', '-shm') {
        Remove-Item -Force -ErrorAction SilentlyContinue "$Destination$suffix"
    }
    & node --no-warnings (Join-Path $PSScriptRoot 'sqlite-snapshot.mjs') $Source $Destination
}
