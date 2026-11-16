# Copyright 2026, Wavelet contributors
# SPDX-License-Identifier: Apache-2.0

# How long does antivirus hold the start of an executable it has no verdict for?
#
#   ops\antivirus-hold.ps1               in a scratch directory under the install root
#   ops\antivirus-hold.ps1 -Dir <dir>    somewhere else, to compare; the directory must not exist yet
#
# Windows Defender scans an executable in full before Windows creates a process from it, whenever it has no verdict
# for the file: after a build, and again after each update of its definitions, which is about daily. For a file the
# size of an Electron app that takes seconds, and they pass before the app exists, so the app's own log cannot show
# them (the backend logs them afterwards, as "launch:"). A process exclusion does not prevent the scan: it covers the
# files a process opens, not the process's own file when something else starts it. An exclusion of the file or of its
# folder does.
#
# The installed app's executable and its backend are copied with four bytes changed, which makes them files nobody
# has seen, as after a build. Each copy is then started twice, by Measure-SuspendedStart, which stops short of
# running anything. The first start includes the scan; the second does not.
#
# The last line is the installed executable as it is. Seconds there mean the next start of the app would have been
# held; running this has then taken the hold in its place.

param(
    [string]$Dir
)

. $PSScriptRoot\lib.ps1

if (-not $Dir) {
    $Dir = Join-Path $InstallRoot 'bench'
}
if (Test-Path $Dir) {
    throw "$Dir exists already; this script works in a directory that it creates and removes"
}

function Copy-AsUnseen([string]$Source, [string]$Destination) {
    Copy-Item -LiteralPath $Source -Destination $Destination
    # The checksum field of the PE header is not checked for ordinary programs: a random value there changes the
    # file's hash and nothing else.
    $stream = [IO.File]::Open($Destination, 'Open', 'ReadWrite')
    try {
        $four = New-Object byte[] 4
        $stream.Position = 0x3C
        [void]$stream.Read($four, 0, 4)
        $peHeader = [BitConverter]::ToInt32($four, 0)
        # the optional header starts 24 bytes into the PE header, and the checksum is 64 bytes into that
        $stream.Position = $peHeader + 24 + 64
        [Security.Cryptography.RandomNumberGenerator]::Fill($four)
        $stream.Write($four, 0, 4)
    } finally {
        $stream.Dispose()
    }
}

function Format-Ms([double]$Ms) {
    '{0,7:N0} ms' -f $Ms
}

$appExe = Join-Path $LiveAppDir "$AppName.exe"
$sources = @($appExe) + @(Get-ChildItem (Join-Path $LiveAppDir 'resources\app.asar.unpacked\dist\bin') -Filter 'wavesrv*.exe' |
        ForEach-Object FullName)

Write-Host "unseen copies in $Dir"
Write-Host ('{0,-24} {1,8}  {2,10}  {3,10}' -f '', 'size', 'first', 'second')
New-Item -ItemType Directory $Dir | Out-Null
try {
    foreach ($source in $sources) {
        $copy = Join-Path $Dir (Split-Path -Leaf $source)
        Copy-AsUnseen $source $copy
        $first = Measure-SuspendedStart $copy
        $second = Measure-SuspendedStart $copy
        Write-Host ('{0,-24} {1,5:N0} MB  {2}  {3}' -f (Split-Path -Leaf $source), ((Get-Item $copy).Length / 1MB),
            (Format-Ms $first), (Format-Ms $second))
    }
} finally {
    Remove-Item -LiteralPath $Dir -Recurse -Force
}
Write-Host ''
Write-Host ('{0,-24} {1,5:N0} MB  {2}' -f "$AppName.exe as installed", ((Get-Item $appExe).Length / 1MB),
    (Format-Ms (Measure-SuspendedStart $appExe)))
