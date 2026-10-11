param(
    [ValidateSet('Start', 'Stop')][string]$Action = 'Start',
    [string]$NodePath,
    [string]$CloudflaredPath,
    [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'
$gevRoot = Split-Path $PSScriptRoot -Parent
$gevStateDir = Join-Path $gevRoot 'output\private-link'
$gevStateFile = Join-Path $gevStateDir 'processes.json'
$gevAccessFile = Join-Path $gevStateDir 'Your online access.txt'
$gevPasswordFile = Join-Path $gevStateDir 'password.txt'
$gevPort = 4180
New-Item -ItemType Directory -Force -Path $gevStateDir | Out-Null
# Protect the local password and process state from other ordinary PC accounts.
$gevIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$gevAcl = Get-Acl -LiteralPath $gevStateDir
$gevAcl.SetAccessRuleProtection($true, $false)
$gevRule = New-Object System.Security.AccessControl.FileSystemAccessRule($gevIdentity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$gevAcl.SetAccessRule($gevRule)
Set-Acl -LiteralPath $gevStateDir -AclObject $gevAcl

function Get-OwnedProcess($entry) {
    if (-not $entry) { return $null }
    $candidate = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if (-not $candidate) { return $null }
    if ($candidate.Path -ne $entry.path -or $candidate.StartTime.ToUniversalTime().Ticks.ToString() -ne $entry.started) { return $null }
    return $candidate
}
function Get-ProcessRecord($process) {
    return @{ id = $process.Id; path = $process.Path; started = $process.StartTime.ToUniversalTime().Ticks.ToString() }
}
function Test-LocalHealth {
    try {
        $result = Invoke-RestMethod -Uri "http://127.0.0.1:$gevPort/healthz" -TimeoutSec 3
        return $result.status -eq 'ok'
    } catch { return $false }
}
function Show-Access {
    Write-Host "Your link and password are saved in: $gevAccessFile"
    if (-not $NoOpen) {
        Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $gevAccessFile + '"')
        Start-Process -FilePath $gevPublicUrl
    }
}

# One launcher at a time; no guessed process IDs or broad process termination.
$gevLock = [System.IO.File]::Open((Join-Path $gevStateDir 'launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
$gevTunnel = $null
$gevApp = $null
try {
    $gevOldState = if (Test-Path -LiteralPath $gevStateFile) { Get-Content -LiteralPath $gevStateFile -Raw | ConvertFrom-Json } else { $null }
    if ($gevOldState) {
        $gevOldApp = Get-OwnedProcess $gevOldState.app
        $gevOldTunnel = Get-OwnedProcess $gevOldState.tunnel
        if ($Action -eq 'Start' -and $gevOldApp -and $gevOldTunnel -and (Test-LocalHealth)) {
            $gevPublicUrl = $gevOldState.url
            Show-Access
            return
        }
        foreach ($gevProcess in @($gevOldTunnel, $gevOldApp)) {
            if ($gevProcess) { Stop-Process -InputObject $gevProcess }
        }
        Remove-Item -LiteralPath $gevStateFile
    }
    if ($Action -eq 'Stop') {
        Write-Host 'Your online link is stopped. Use Start My Gods Eye View.cmd when you want it online again.'
        return
    }
    if (-not $NodePath) {
        $gevBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
        $NodePath = if (Test-Path -LiteralPath $gevBundledNode) { $gevBundledNode } else { (Get-Command node -ErrorAction Stop).Source }
    }
    $gevVersion = & $NodePath -p 'process.versions.node'
    if ($LASTEXITCODE -ne 0 -or -not ($gevVersion -match '^(24|26)\.')) { throw 'Install Node 24.14 or newer in the 24.x series, or Node 26, before starting.' }
    if (-not $CloudflaredPath) { $CloudflaredPath = Join-Path $gevRoot 'output\tools\cloudflared.exe' }
    if (-not (Test-Path -LiteralPath $CloudflaredPath)) { throw 'Download the official Windows cloudflared.exe into output\tools first. See docs/HOSTING.md.' }
    if (-not (Test-Path -LiteralPath (Join-Path $gevRoot 'dist\index.html'))) { throw 'Build the application first. See docs/HOSTING.md.' }
    if (Test-LocalHealth) { throw 'Port 4180 is already serving an application. Stop it before starting this link.' }
    if (-not (Test-Path -LiteralPath $gevPasswordFile)) {
        $gevRandomBytes = New-Object byte[] 32
        $gevRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $gevRng.GetBytes($gevRandomBytes) } finally { $gevRng.Dispose() }
        [Convert]::ToBase64String($gevRandomBytes).TrimEnd('=').Replace('+','-').Replace('/','_') | Set-Content -LiteralPath $gevPasswordFile -Encoding ASCII
    }
    $gevPassword = (Get-Content -LiteralPath $gevPasswordFile -Raw).Trim()
    if ($gevPassword -notmatch '^[A-Za-z0-9_-]{40,}$') { throw 'The saved password file is invalid.' }
    # An explicit empty config keeps this tunnel independent of other tunnels.
    $gevTunnelConfig = Join-Path $gevStateDir 'tunnel.yml'
    '{}' | Set-Content -LiteralPath $gevTunnelConfig -Encoding ASCII
    $gevTunnelError = Join-Path $gevStateDir 'tunnel-error.log'
    $gevTunnel = Start-Process -FilePath $CloudflaredPath -ArgumentList @('tunnel', '--config', ('"' + $gevTunnelConfig + '"'), '--no-autoupdate', '--protocol', 'http2', '--url', "http://127.0.0.1:$gevPort") -WorkingDirectory $gevRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $gevStateDir 'tunnel.log') -RedirectStandardError $gevTunnelError
    $gevPublicUrl = $null
    for ($gevAttempt = 0; $gevAttempt -lt 60; $gevAttempt++) {
        Start-Sleep -Milliseconds 500
        $gevTunnel.Refresh()
        if ($gevTunnel.HasExited) { throw 'The tunnel could not start. Check output/private-link/tunnel-error.log.' }
        $gevLog = Get-Content -LiteralPath $gevTunnelError -Raw -ErrorAction SilentlyContinue
        if ($gevLog -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $gevPublicUrl = $Matches[0]; break }
    }
    if (-not $gevPublicUrl) { throw 'The tunnel did not return an address in time. Try Start again.' }
    # Node reads these credentials from a private file, never command arguments.
    $gevEnvFile = Join-Path $gevStateDir 'runtime.env'
    @("GEV_PUBLIC_ORIGIN=$gevPublicUrl", "GEV_ACCESS_PASSWORD=$gevPassword", "PORT=$gevPort", 'GEV_BIND_HOST=127.0.0.1') | Set-Content -LiteralPath $gevEnvFile -Encoding ASCII
    $gevApp = Start-Process -FilePath $NodePath -ArgumentList @('--env-file-if-exists=.env.hosted.local', '--env-file=output/private-link/runtime.env', 'server/hosted/start.js') -WorkingDirectory $gevRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $gevStateDir 'app.log') -RedirectStandardError (Join-Path $gevStateDir 'app-error.log')
    $gevReady = $false
    for ($gevAttempt = 0; $gevAttempt -lt 30; $gevAttempt++) {
        Start-Sleep -Milliseconds 500
        $gevApp.Refresh()
        if ($gevApp.HasExited) { throw 'The application could not start. Check output/private-link/app-error.log.' }
        if (Test-LocalHealth) { $gevReady = $true; break }
    }
    if (-not $gevReady) { throw 'The application did not become ready in time.' }
    @{ url = $gevPublicUrl; app = (Get-ProcessRecord $gevApp); tunnel = (Get-ProcessRecord $gevTunnel) } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $gevStateFile -Encoding UTF8
    @("MY GOD'S EYE VIEW", '', "Open: $gevPublicUrl", "Password: $gevPassword", '', 'Keep this file private. Anyone with the password can use this app.', 'The link works while this PC is awake, connected to the internet, and the hosting processes are running.', 'Use Stop My Gods Eye View.cmd to stop it. Use Start My Gods Eye View.cmd to start again.', 'Restarting creates a new address; this file will be updated. The password stays the same.', '', 'Optional provider features need your own keys. See docs/HOSTING.md.') | Set-Content -LiteralPath $gevAccessFile -Encoding UTF8
    Write-Host "Your private God's Eye View is online: $gevPublicUrl"
    Show-Access
} catch {
    foreach ($gevProcess in @($gevTunnel, $gevApp)) {
        if ($gevProcess) { $gevProcess.Refresh(); if (-not $gevProcess.HasExited) { Stop-Process -InputObject $gevProcess } }
    }
    throw
} finally { $gevLock.Dispose() }
