<#
.SYNOPSIS
    Launches TradingView Desktop with Chrome DevTools Protocol enabled (port 9222).
    Used by the TradeWorks-TV-Debug-Launch scheduled task at user logon.

.DESCRIPTION
    Improved over launch_tv_debug.bat: handles MSIX/Microsoft-Store installs
    that live under C:\Program Files\WindowsApps\TradingView.Desktop_* by
    using Get-AppxPackage to discover the install location robustly.

    Idempotent — kills any running TV instance, then relaunches with the debug
    port. Polls CDP /json/version until ready (or 30s timeout).

.PARAMETER Port
    CDP port to expose (default 9222).
#>
param(
  [int]$Port = 9222
)

$ErrorActionPreference = 'Continue'
$logFile = Join-Path $env:LOCALAPPDATA 'TradeWorks-TV-Launch.log'
function Write-Log {
  param($msg)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  Write-Output $line
  Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
}
Write-Log "=== launcher start (port=$Port, user=$env:USERNAME) ==="

# 1. Locate TradingView.exe — try MSIX first (Microsoft Store install), then legacy paths
$tvExe = $null

$pkg = Get-AppxPackage -Name 'TradingView.Desktop' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pkg) {
  $candidate = Join-Path $pkg.InstallLocation 'TradingView.exe'
  if (Test-Path $candidate) { $tvExe = $candidate }
}

if (-not $tvExe) {
  $candidates = @(
    "$env:LOCALAPPDATA\TradingView\TradingView.exe",
    "$env:ProgramFiles\TradingView\TradingView.exe",
    "${env:ProgramFiles(x86)}\TradingView\TradingView.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { $tvExe = $c; break } }
}

if (-not $tvExe) {
  Write-Log "ERROR: TradingView.exe not found. Checked AppX (TradingView.Desktop), LocalAppData, Program Files."
  exit 1
}
Write-Log "Found TradingView at: $tvExe"

# 2. Kill any running instance (Stop-Process is idempotent — silently no-ops if none)
$running = Get-Process TradingView -ErrorAction SilentlyContinue
if ($running) {
  Write-Log "Killing $($running.Count) existing TradingView process(es)..."
  $running | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

# 3. Launch with debug port
Write-Log "Starting TradingView with --remote-debugging-port=$Port..."
Start-Process -FilePath $tvExe -ArgumentList "--remote-debugging-port=$Port"

# 4. Poll CDP until ready (30s timeout)
$deadline = (Get-Date).AddSeconds(30)
$ready = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Port/json/version" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($r.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {
    # CDP not ready yet, keep polling
  }
}

if ($ready) {
  Write-Log "CDP ready at http://localhost:$Port"
  exit 0
} else {
  Write-Log "WARN: CDP did not respond within 30s. TV is running but the debug port may not be open."
  exit 2
}
