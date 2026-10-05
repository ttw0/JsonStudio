param(
    [string]$Version = $env:JSONSTUDIO_VERSION,
    [string]$InstallDir = $env:JSONSTUDIO_INSTALL_DIR,
    [switch]$Uninstall
)

# This script also works when evaluated through: irm URL | iex
function Invoke-JsonStudioInstaller {
    $ErrorActionPreference = 'Stop'
    function Assert-AbsoluteInstallPath([string]$Path) {
        if ($Path -notmatch '^(?:[A-Za-z]:[\\/]|\\\\)' -or $Path -match '[\x00-\x1f"]') {
            throw 'The install path must be fully qualified without quotes or control characters.'
        }
    }
    if ($env:OS -ne 'Windows_NT') { throw 'This installer is for Windows. Use install.sh on macOS or Linux.' }
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required.' }
    $stateDir = Join-Path $env:LOCALAPPDATA 'JsonStudio\installer'
    $receipt = Join-Path $stateDir 'app-path'
    if (Get-Process -Name 'jsonstudio', 'Json Studio', 'Json.Studio' -ErrorAction SilentlyContinue) {
        throw 'Close JsonStudio before installing or uninstalling.'
    }

    if ($Uninstall -or $env:JSONSTUDIO_ACTION -eq 'uninstall') {
        if (-not (Test-Path -LiteralPath $receipt -PathType Leaf)) { throw 'No script-managed installation was found.' }
        $appPath = (Get-Content -LiteralPath $receipt -Raw).Trim()
        Assert-AbsoluteInstallPath $appPath
        if ([IO.Path]::GetFileName($appPath) -notin @('jsonstudio.exe', 'Json Studio.exe', 'Json.Studio.exe')) {
            throw 'Invalid installation record; nothing was removed.'
        }
        $appDir = Split-Path $appPath -Parent
        $uninstaller = Join-Path $appDir 'uninstall.exe'
        if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'The registered application uninstaller was not found.' }
        # _?= keeps NSIS in this process so -Wait covers the complete uninstall.
        $process = Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$appDir" -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "Uninstall failed with exit code $($process.ExitCode)." }
        if (Test-Path -LiteralPath $appPath -PathType Leaf) { throw 'The uninstaller finished but the application is still present.' }
        Remove-Item -LiteralPath $uninstaller -Force -ErrorAction SilentlyContinue
        if ((Test-Path -LiteralPath $appDir -PathType Container) -and -not (Get-ChildItem -LiteralPath $appDir -Force)) {
            Remove-Item -LiteralPath $appDir -Force
        }
        Remove-Item -LiteralPath $receipt -Force
        Remove-Item -LiteralPath (Join-Path $stateDir 'version') -Force -ErrorAction SilentlyContinue
        Write-Host 'JsonStudio was uninstalled. Your documents and application settings were kept.'
        return
    }

    if (-not $Version) { $Version = 'latest' }
    if ($Version -ne 'latest') {
        $Version = $Version -replace '^v', ''
        if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "Invalid version: $Version" }
    }
    $arch = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE', 'Machine')
    if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
    if ($arch -ne 'AMD64') { throw "No native Windows release is available for $arch. Only x64 is currently supported." }

    $previousApp = $null
    if (Test-Path -LiteralPath $receipt -PathType Leaf) {
        $previousApp = (Get-Content -LiteralPath $receipt -Raw).Trim()
        if (-not $InstallDir) { $InstallDir = Split-Path $previousApp -Parent }
    }
    if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'Json Studio' }
    Assert-AbsoluteInstallPath $InstallDir
    $InstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
    if ($InstallDir.TrimEnd('\') -eq [IO.Path]::GetPathRoot($InstallDir).TrimEnd('\')) {
        throw 'Choose an application directory, not the root of a drive.'
    }
    if ($previousApp -and (Split-Path $previousApp -Parent) -ne $InstallDir) {
        throw "Already installed at $previousApp. Uninstall it before changing the location."
    }
    $existing = @('jsonstudio.exe', 'Json Studio.exe', 'Json.Studio.exe') |
        ForEach-Object { Join-Path $InstallDir $_ } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
    if ($existing -and -not $previousApp) { throw "Refusing to replace an unmanaged application in $InstallDir." }
    if (-not $previousApp) {
        $registered = @(
            foreach ($key in @(
                'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
            )) {
                Get-ItemProperty -Path $key -ErrorAction SilentlyContinue |
                    Where-Object { $_.DisplayName -in @('Json Studio', 'JsonStudio') }
            }
        )
        if ($registered.Count) { throw 'An existing JsonStudio installation is registered. Use its original channel or uninstall it first.' }
    }
    $base = 'https://github.com/sundegan/JsonStudio/releases'
    $releaseUrl = if ($Version -eq 'latest') { "$base/latest/download" } else { "$base/download/v$Version" }
    $stage = Join-Path ([IO.Path]::GetTempPath()) ("jsonstudio-install-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    $oldProtocol = [Net.ServicePointManager]::SecurityProtocol
    try {
        [Net.ServicePointManager]::SecurityProtocol = $oldProtocol -bor [Net.SecurityProtocolType]::Tls12
        Write-Host 'Resolving JsonStudio for Windows/x64...'
        try {
            $manifest = Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/SHA256SUMS" -TimeoutSec 60
        } catch {
            throw 'Release checksums are unavailable. The publisher must run the Publish installer checksums workflow for this release.'
        }
        $manifestText = $manifest.Content
        if ($manifestText -is [byte[]]) { $manifestText = [Text.Encoding]::UTF8.GetString($manifestText) }
        $entries = @(
            foreach ($line in ($manifestText -split '\r?\n')) {
                if ($line -cmatch '^([0-9a-f]{64})  (Json\.Studio_([0-9]+\.[0-9]+\.[0-9]+)_windows_x64-setup\.exe)$') {
                    [PSCustomObject]@{ Hash = $Matches[1]; Asset = $Matches[2]; Version = $Matches[3] }
                }
            }
        )
        if ($entries.Count -ne 1) { throw 'The release must contain exactly one Windows/x64 installer checksum.' }
        $entry = $entries[0]
        if ($Version -ne 'latest' -and $Version -ne $entry.Version) { throw 'Release version mismatch.' }
        $Version = $entry.Version
        $installer = Join-Path $stage $entry.Asset
        Write-Host "Downloading JsonStudio $Version..."
        Invoke-WebRequest -UseBasicParsing -Uri "$base/download/v$Version/$($entry.Asset)" -OutFile $installer -TimeoutSec 600
        $actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -cne $entry.Hash) { throw 'SHA256 verification failed. Nothing was installed.' }
        # NSIS consumes everything after /D= as the directory; it must be last and unquoted.
        $process = Start-Process -FilePath $installer -ArgumentList "/S /D=$InstallDir" -Wait -PassThru
        if ($process.ExitCode -notin @(0, 3010)) { throw "Installation failed with exit code $($process.ExitCode)." }
        $appPath = @('jsonstudio.exe', 'Json Studio.exe', 'Json.Studio.exe') |
            ForEach-Object { Join-Path $InstallDir $_ } |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
            Select-Object -First 1
        if (-not $appPath) { throw "The installer finished but the application was not found in $InstallDir." }
        New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
        [IO.File]::WriteAllText($receipt, "$appPath`n", [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText((Join-Path $stateDir 'version'), "$Version`n", [Text.UTF8Encoding]::new($false))
        Write-Host "Installed JsonStudio $Version at $appPath"
        Write-Host 'Launch JsonStudio from the Start menu. Windows security confirmation may still be required.'
    } finally {
        [Net.ServicePointManager]::SecurityProtocol = $oldProtocol
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Invoke-JsonStudioInstaller
