[CmdletBinding()]
param(
  [string]$ConfigPath,
  [switch]$SkipBrowserLaunch
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $PSScriptRoot 'livewall-launcher.json'
}
$root = Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $PSScriptRoot 'LiveWall.Launcher.psm1') -Force

function Write-ProgressMessage {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message
  Write-Host $line
  if ($script:logFile) { Add-Content -LiteralPath $script:logFile -Value $line -Encoding UTF8 }
}

$mutex = $null
$hasMutex = $false
try {
  if (Initialize-LiveWallLauncherConfig -ConfigPath $ConfigPath) {
    Write-Host "Created local launcher configuration from launcher\livewall-launcher.example.json."
  }
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $port = [int]$config.port
  if ($port -lt 1 -or $port -gt 65535) { throw 'The configured port is invalid.' }
  $baseUrl = "http://127.0.0.1:$port"
  $launcherData = Join-Path $root 'data\launcher'
  New-Item -ItemType Directory -Path $launcherData -Force | Out-Null
  $script:logFile = Join-Path $launcherData 'launcher.log'

  $mutex = New-Object Threading.Mutex($false, "Local\LiveWallLauncher-$port")
  try { $hasMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $hasMutex = $true }
  if (-not $hasMutex) { throw 'Another LiveWall launch is already in progress. Wait a moment and try again.' }

  Write-ProgressMessage 'Checking LiveWall'
  $screens = @(Get-LiveWallScreens)
  foreach ($screen in $screens) {
    Write-ProgressMessage ("Detected {0}: primary={1}; bounds={2},{3} {4}x{5}; working={6},{7} {8}x{9}" -f
      $screen.DeviceName, $screen.Primary,
      $screen.Bounds.X, $screen.Bounds.Y, $screen.Bounds.Width, $screen.Bounds.Height,
      $screen.WorkingArea.X, $screen.WorkingArea.Y, $screen.WorkingArea.Width, $screen.WorkingArea.Height)
  }
  $wallSelection = Select-LiveWallDisplay -Screens $screens -RequestedDeviceName ([string]$config.wallDisplay)
  $adminSelection = Select-LiveWallDisplay -Screens $screens -RequestedDeviceName ([string]$config.adminDisplay)
  if ($wallSelection.FallbackUsed) {
    Write-Warning "Wall display $($config.wallDisplay) is unavailable; using $($wallSelection.Screen.DeviceName)."
  }
  if ($adminSelection.FallbackUsed) {
    Write-Warning "Admin display $($config.adminDisplay) is unavailable; using $($adminSelection.Screen.DeviceName)."
  }

  $browser = Find-LiveWallBrowser -Preferred ([string]$config.browser)
  Write-ProgressMessage ("Using {0}: {1}" -f $browser.Name, $browser.Path)
  if ($browser.FallbackUsed) { Write-Warning 'Configured browser was unavailable; using the documented fallback.' }

  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required. Install the current LTS release from https://nodejs.org/.'
  }
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { throw 'npm.cmd was not found with Node.js.' }
  if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    Write-ProgressMessage 'Preparing LiveWall for first use'
    & $npm.Source install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $root 'dist\index.html'))) {
    Write-ProgressMessage 'Building LiveWall'
    & $npm.Source run build
    if ($LASTEXITCODE -ne 0) { throw 'The production build failed.' }
  }

  $status = Get-LiveWallServerStatus -Port $port
  if ($status.Status -eq 'occupied') {
    throw "Port $port is occupied by another application. Close it or change launcher\livewall-launcher.json."
  }
  if ($status.Status -eq 'unhealthy') {
    throw "LiveWall is listening on port $port but is unhealthy: $($status.Message)"
  }
  if ($status.Status -eq 'healthy') {
    Write-ProgressMessage 'Reusing healthy LiveWall server'
  } else {
    Write-ProgressMessage 'Starting server'
    $serverLog = Join-Path $launcherData 'server.log'
    $serverErrorLog = Join-Path $launcherData 'server-error.log'
    Set-Content -LiteralPath $serverLog -Value '' -Encoding UTF8
    Set-Content -LiteralPath $serverErrorLog -Value '' -Encoding UTF8
    # Windows PowerShell 5.1 can fail when redirected Start-Process output meets
    # duplicate PATH/Path environment entries. The fixed wrapper owns redirection.
    $serverRunner = Join-Path $PSScriptRoot 'run-server.cmd'
    $previousPort = $env:PORT
    try {
      $env:PORT = [string]$port
      $serverProcess = Start-Process -FilePath $serverRunner -WorkingDirectory $root `
        -WindowStyle Hidden -PassThru
    } finally {
      if ($null -eq $previousPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue }
      else { $env:PORT = $previousPort }
    }
    Set-Content -LiteralPath (Join-Path $launcherData 'server.pid') -Value $serverProcess.Id -Encoding ASCII
    Write-ProgressMessage 'Waiting for server'
    $ready = Wait-LiveWallReady -BaseUrl $baseUrl -TimeoutSeconds ([double]$config.startupTimeoutSeconds)
    if (-not $ready -or -not $ready.Healthy) {
      $details = @()
      if (Test-Path $serverLog) { $details += (Get-Content -LiteralPath $serverLog -Raw) }
      if (Test-Path $serverErrorLog) { $details += (Get-Content -LiteralPath $serverErrorLog -Raw) }
      throw ("LiveWall did not become ready. {0}" -f (($details -join [Environment]::NewLine).Trim()))
    }
  }

  if (-not $SkipBrowserLaunch) {
    $profiles = Join-Path $launcherData 'browser-profiles'
    $wallProfile = Join-Path $profiles 'wall'
    $adminProfile = Join-Path $profiles 'admin'
    New-Item -ItemType Directory -Path $wallProfile, $adminProfile -Force | Out-Null
    [void](Stop-LiveWallDedicatedBrowser -ProfilePath $wallProfile)
    [void](Stop-LiveWallDedicatedBrowser -ProfilePath $adminProfile)
    Start-Sleep -Milliseconds 350

    Write-ProgressMessage ("Opening Wall on {0}" -f $wallSelection.Screen.DeviceName)
    $wallArguments = New-LiveWallWallArguments -Screen $wallSelection.Screen -ProfilePath $wallProfile `
      -Url "$baseUrl/wall?launchMode=$($config.wallMode)" -Mode ([string]$config.wallMode)
    $wallProcess = Start-Process -FilePath $browser.Path -ArgumentList $wallArguments -PassThru
    [void](Save-LiveWallWallSession -Root $root -ProcessId $wallProcess.Id `
        -BrowserPath $browser.Path -ProfilePath $wallProfile `
        -Url "$baseUrl/wall?launchMode=$($config.wallMode)" `
        -Mode ([string]$config.wallMode))

    Write-ProgressMessage ("Opening Admin on {0}" -f $adminSelection.Screen.DeviceName)
    $adminArguments = New-LiveWallAdminArguments -Screen $adminSelection.Screen -ProfilePath $adminProfile `
      -Url "$baseUrl/admin"
    Start-Process -FilePath $browser.Path -ArgumentList $adminArguments | Out-Null
    Write-ProgressMessage 'LiveWall is ready. Press Alt+F4 in the Wall window to exit kiosk mode.'
  } else {
    Write-ProgressMessage 'LiveWall server is ready. Browser launch was skipped.'
  }
  exit 0
} catch {
  Write-Host ''
  Write-Host ("ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  if ($hasMutex -and $mutex) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
}
