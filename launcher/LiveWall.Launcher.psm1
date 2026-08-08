Set-StrictMode -Version Latest

function Initialize-LiveWallLauncherConfig {
  param([Parameter(Mandatory = $true)][string]$ConfigPath)
  if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) { return $false }

  $examplePath = Join-Path (Split-Path $ConfigPath -Parent) 'livewall-launcher.example.json'
  if (-not (Test-Path -LiteralPath $examplePath -PathType Leaf)) {
    throw "Launcher configuration and example were not found: $ConfigPath"
  }

  $config = Get-Content -LiteralPath $examplePath -Raw | ConvertFrom-Json
  $tempPath = "$ConfigPath.tmp"
  $config | ConvertTo-Json | Set-Content -LiteralPath $tempPath -Encoding UTF8
  Move-Item -LiteralPath $tempPath -Destination $ConfigPath
  $true
}

function Update-LiveWallLauncherConfig {
  param([Parameter(Mandatory = $true)][string]$ConfigPath)
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $changed = $false
  if (-not ($config.PSObject.Properties.Name -contains 'wallAutoplayWithSound')) {
    $config | Add-Member -NotePropertyName wallAutoplayWithSound -NotePropertyValue $true
    $changed = $true
  }
  if (-not ($config.PSObject.Properties.Name -contains 'externalTvMonitor')) {
    $monitor = if ($config.PSObject.Properties.Name -contains 'wallDisplay') { [string]$config.wallDisplay } else { '\\.\DISPLAY2' }
    $config | Add-Member -NotePropertyName externalTvMonitor -NotePropertyValue $monitor
    $changed = $true
  }
  if (-not ($config.PSObject.Properties.Name -contains 'externalTvProfileDir')) {
    $config | Add-Member -NotePropertyName externalTvProfileDir -NotePropertyValue 'data\launcher\browser-profiles\external-tv'
    $changed = $true
  }
  if (-not ($config.PSObject.Properties.Name -contains 'externalTvFullscreen')) {
    $config | Add-Member -NotePropertyName externalTvFullscreen -NotePropertyValue $true
    $changed = $true
  }
  if (-not $changed) { return $false }
  $tempPath = "$ConfigPath.tmp"
  $config | ConvertTo-Json | Set-Content -LiteralPath $tempPath -Encoding UTF8
  Move-Item -LiteralPath $tempPath -Destination $ConfigPath -Force
  $true
}

function Get-LiveWallExternalTvSessionPath {
  param([Parameter(Mandatory = $true)][string]$Root)
  Join-Path $Root 'data\launcher\external-tv-session.json'
}

function Get-LiveWallExternalTvContext {
  param([Parameter(Mandatory = $true)][string]$Root)
  $wall = Get-LiveWallWallContext -Root $Root
  $configured = [string]$wall.Config.externalTvProfileDir
  if ([IO.Path]::IsPathRooted($configured)) { throw 'externalTvProfileDir must be relative to the LiveWall installation.' }
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $profile = [IO.Path]::GetFullPath((Join-Path $rootPath $configured))
  if (-not $profile.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'externalTvProfileDir must remain inside the LiveWall installation.' }
  [pscustomobject]@{ Config = $wall.Config; Browser = $wall.Browser; ProfilePath = $profile; Monitor = [string]$wall.Config.externalTvMonitor }
}

function New-LiveWallExternalTvArguments {
  param([Parameter(Mandatory = $true)]$Screen,[Parameter(Mandatory = $true)][string]$ProfilePath,[Parameter(Mandatory = $true)][string]$Url,[bool]$Fullscreen = $true)
  $arguments = @("--user-data-dir=`"$ProfilePath`"",'--no-first-run','--no-default-browser-check','--disable-background-mode','--new-window',"--window-position=$($Screen.Bounds.X),$($Screen.Bounds.Y)","--window-size=$($Screen.Bounds.Width),$($Screen.Bounds.Height)")
  if ($Fullscreen) { $arguments += '--start-fullscreen' }
  $arguments + $Url
}

function Save-LiveWallExternalTvSession {
  param([Parameter(Mandatory = $true)][string]$Root,[Parameter(Mandatory = $true)][int]$ProcessId,[Parameter(Mandatory = $true)][string]$BrowserPath,[Parameter(Mandatory = $true)][string]$ProfilePath,[Parameter(Mandatory = $true)][string]$Url,[string]$Status = 'open')
  $path = Get-LiveWallExternalTvSessionPath -Root $Root
  New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
  $record = [ordered]@{ version = 1; processId = $ProcessId; browserPath = [IO.Path]::GetFullPath($BrowserPath); profilePath = [IO.Path]::GetFullPath($ProfilePath).TrimEnd('\'); url = $Url; status = $Status; updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  $temp = "$path.tmp"
  $record | ConvertTo-Json | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $path -Force
  [pscustomobject]$record
}

function Test-LiveWallExternalTvSession {
  param([Parameter(Mandatory = $true)]$Session,[Parameter(Mandatory = $true)][string]$ExpectedBrowserPath,[Parameter(Mandatory = $true)][string]$ExpectedProfilePath,$Process)
  if ($Session.status -eq 'closed') { return [pscustomobject]@{ Valid = $false; Status = 'already-closed'; Message = 'The dedicated External TV session is closed.' } }
  if (-not $Process) { return [pscustomobject]@{ Valid = $false; Status = 'stale'; Message = 'The dedicated External TV process is no longer running.' } }
  $browser = [IO.Path]::GetFullPath($ExpectedBrowserPath); $profile = [IO.Path]::GetFullPath($ExpectedProfilePath).TrimEnd('\')
  $profileArgument = '--user-data-dir=(?:")?' + [regex]::Escape($profile) + '(?:")?(?:\s|$)'
  $valid = $Process.ExecutablePath -and ([IO.Path]::GetFullPath([string]$Process.ExecutablePath) -ieq $browser) -and [int]$Session.processId -eq [int]$Process.ProcessId -and [string]$Session.profilePath -ieq $profile -and $Process.CommandLine -match $profileArgument -and ([string]$Process.CommandLine).IndexOf([string]$Session.url,[StringComparison]::OrdinalIgnoreCase) -ge 0
  if (-not $valid) { return [pscustomobject]@{ Valid = $false; Status = 'mismatch'; Message = 'The registered External TV process did not match its executable, profile, and URL. Nothing was closed.' } }
  [pscustomobject]@{ Valid = $true; Status = 'open'; Message = 'The dedicated External TV process is valid.' }
}

function Get-LiveWallExternalTvStatus {
  param([Parameter(Mandatory = $true)][string]$Root)
  $path = Get-LiveWallExternalTvSessionPath -Root $Root
  if (-not (Test-Path -LiteralPath $path)) { return [pscustomobject]@{ Ok = $true; Status = 'closed'; Message = 'External TV is not active.' } }
  $session = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $context = Get-LiveWallExternalTvContext -Root $Root
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$session.processId)" -ErrorAction SilentlyContinue
  $test = Test-LiveWallExternalTvSession -Session $session -ExpectedBrowserPath $context.Browser.Path -ExpectedProfilePath $context.ProfilePath -Process $process
  if ($test.Valid) { return [pscustomobject]@{ Ok = $true; Status = 'active'; Message = 'External TV is active.'; Url = $session.url; ProcessId = $session.processId } }
  if ($test.Status -eq 'stale') { [void](Save-LiveWallExternalTvSession -Root $Root -ProcessId ([int]$session.processId) -BrowserPath $context.Browser.Path -ProfilePath $context.ProfilePath -Url $session.url -Status 'closed'); return [pscustomobject]@{ Ok = $true; Status = 'closed'; Message = 'External TV closed; LiveWall can be restored.' } }
  [pscustomobject]@{ Ok = $false; Status = $test.Status; Message = $test.Message }
}

function Open-LiveWallExternalTv {
  param([Parameter(Mandatory = $true)][string]$Root,[Parameter(Mandatory = $true)][string]$Url)
  if ($Url -notmatch '^https?://') { throw 'External TV accepts only http:// or https:// URLs.' }
  $existing = Get-LiveWallExternalTvStatus -Root $Root
  if ($existing.Status -eq 'active') { return [pscustomobject]@{ Ok = $true; Status = 'already-active'; Message = 'External TV is already active.'; ProcessId = $existing.ProcessId } }
  $context = Get-LiveWallExternalTvContext -Root $Root; $selection = Select-LiveWallDisplay -Screens @(Get-LiveWallScreens) -RequestedDeviceName $context.Monitor
  New-Item -ItemType Directory -Path $context.ProfilePath -Force | Out-Null
  $arguments = New-LiveWallExternalTvArguments -Screen $selection.Screen -ProfilePath $context.ProfilePath -Url $Url -Fullscreen ([bool]$context.Config.externalTvFullscreen)
  $process = Start-Process -FilePath $context.Browser.Path -ArgumentList $arguments -PassThru
  [void](Save-LiveWallExternalTvSession -Root $Root -ProcessId $process.Id -BrowserPath $context.Browser.Path -ProfilePath $context.ProfilePath -Url $Url)
  [pscustomobject]@{ Ok = $true; Status = 'opened'; Message = "External TV opened on $($selection.Screen.DeviceName)."; ProcessId = $process.Id; Display = $selection.Screen.DeviceName; FallbackUsed = $selection.FallbackUsed }
}

function Close-LiveWallExternalTv {
  param([Parameter(Mandatory = $true)][string]$Root)
  $path = Get-LiveWallExternalTvSessionPath -Root $Root
  if (-not (Test-Path -LiteralPath $path)) { return [pscustomobject]@{ Ok = $true; Status = 'already-closed'; Message = 'External TV is already closed.' } }
  $session = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json; $context = Get-LiveWallExternalTvContext -Root $Root
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$session.processId)" -ErrorAction SilentlyContinue
  $test = Test-LiveWallExternalTvSession -Session $session -ExpectedBrowserPath $context.Browser.Path -ExpectedProfilePath $context.ProfilePath -Process $process
  if ($test.Status -eq 'already-closed') { return [pscustomobject]@{ Ok = $true; Status = 'already-closed'; Message = 'External TV is already closed.' } }
  if (-not $test.Valid) { return [pscustomobject]@{ Ok = $false; Status = $test.Status; Message = $test.Message } }
  Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
  [void](Save-LiveWallExternalTvSession -Root $Root -ProcessId ([int]$session.processId) -BrowserPath $context.Browser.Path -ProfilePath $context.ProfilePath -Url $session.url -Status 'closed')
  [pscustomobject]@{ Ok = $true; Status = 'closed'; Message = 'External TV closed.' }
}

function Set-LiveWallDpiAwareness {
  try {
    if (-not ('LiveWall.NativeMethods' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace LiveWall {
  public static class NativeMethods {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  }
}
'@
    }
    [void][LiveWall.NativeMethods]::SetProcessDpiAwarenessContext([IntPtr](-4))
  } catch {
    # Older Windows releases may not expose per-monitor-v2 awareness.
  }
}

function Get-LiveWallScreens {
  Set-LiveWallDpiAwareness
  Add-Type -AssemblyName System.Windows.Forms
  @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
      [pscustomobject]@{
        DeviceName = $_.DeviceName
        Primary = $_.Primary
        Bounds = [pscustomobject]@{
          X = $_.Bounds.X
          Y = $_.Bounds.Y
          Width = $_.Bounds.Width
          Height = $_.Bounds.Height
        }
        WorkingArea = [pscustomobject]@{
          X = $_.WorkingArea.X
          Y = $_.WorkingArea.Y
          Width = $_.WorkingArea.Width
          Height = $_.WorkingArea.Height
        }
      }
    })
}

function Select-LiveWallDisplay {
  param(
    [Parameter(Mandatory = $true)][object[]]$Screens,
    [Parameter(Mandatory = $true)][string]$RequestedDeviceName
  )
  if ($Screens.Count -eq 0) { throw 'Windows did not report any displays.' }
  $selected = $Screens | Where-Object { $_.DeviceName -ieq $RequestedDeviceName } | Select-Object -First 1
  $fallback = $false
  if (-not $selected) {
    $selected = $Screens | Where-Object { $_.Primary } | Select-Object -First 1
    if (-not $selected) { $selected = $Screens[0] }
    $fallback = $true
  }
  [pscustomobject]@{ Screen = $selected; FallbackUsed = $fallback }
}

function Find-LiveWallBrowser {
  param(
    [ValidateSet('chrome', 'edge')][string]$Preferred = 'chrome',
    [string[]]$ChromeCandidates,
    [string[]]$EdgeCandidates
  )
  if (-not $PSBoundParameters.ContainsKey('ChromeCandidates')) {
    $ChromeCandidates = @(
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
    )
  }
  if (-not $PSBoundParameters.ContainsKey('EdgeCandidates')) {
    $EdgeCandidates = @(
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe"
    )
  }
  $chrome = $ChromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
  $edge = $EdgeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
  if ($Preferred -eq 'edge' -and $edge) {
    return [pscustomobject]@{ Name = 'Microsoft Edge'; Path = $edge; FallbackUsed = $false }
  }
  if ($chrome) {
    return [pscustomobject]@{ Name = 'Google Chrome'; Path = $chrome; FallbackUsed = ($Preferred -ne 'chrome') }
  }
  if ($edge) {
    return [pscustomobject]@{ Name = 'Microsoft Edge'; Path = $edge; FallbackUsed = $true }
  }
  throw 'Google Chrome was not found in its common install locations, and Microsoft Edge is unavailable as a fallback.'
}

function New-LiveWallWallArguments {
  param(
    [Parameter(Mandatory = $true)]$Screen,
    [Parameter(Mandatory = $true)][string]$ProfilePath,
    [Parameter(Mandatory = $true)][string]$Url,
    [string]$Mode = 'kiosk',
    [bool]$AutoplayWithSound = $false
  )
  $arguments = @(
    "--user-data-dir=`"$ProfilePath`"",
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    "--window-position=$($Screen.Bounds.X),$($Screen.Bounds.Y)",
    "--window-size=$($Screen.Bounds.Width),$($Screen.Bounds.Height)"
  )
  if ($Mode -eq 'kiosk') { $arguments += '--kiosk' }
  if ($AutoplayWithSound) { $arguments += '--autoplay-policy=no-user-gesture-required' }
  $arguments + $Url
}

function New-LiveWallAdminArguments {
  param(
    [Parameter(Mandatory = $true)]$Screen,
    [Parameter(Mandatory = $true)][string]$ProfilePath,
    [Parameter(Mandatory = $true)][string]$Url
  )
  @(
    "--user-data-dir=`"$ProfilePath`"",
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--new-window',
    "--window-position=$($Screen.WorkingArea.X),$($Screen.WorkingArea.Y)",
    "--window-size=$($Screen.WorkingArea.Width),$($Screen.WorkingArea.Height)",
    $Url
  )
}

function Test-LiveWallPortOpen {
  param([int]$Port, [int]$TimeoutMilliseconds = 400)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $attempt = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $attempt.AsyncWaitHandle.WaitOne($TimeoutMilliseconds)) { return $false }
    $client.EndConnect($attempt)
    $true
  } catch {
    $false
  } finally {
    $client.Dispose()
  }
}

function Test-LiveWallEndpoint {
  param([Parameter(Mandatory = $true)][string]$BaseUrl)
  try {
    $health = Invoke-RestMethod "$BaseUrl/api/health" -TimeoutSec 2
    $hasHealthContract = $health.PSObject.Properties.Name -contains 'ok'
    if (-not $hasHealthContract) {
      return [pscustomobject]@{ IsLiveWall = $false; Healthy = $false; Message = 'The health response is not LiveWall.' }
    }
    if ($health.ok -ne $true) {
      return [pscustomobject]@{ IsLiveWall = $true; Healthy = $false; Message = [string]$health.stateError }
    }
    $state = Invoke-RestMethod "$BaseUrl/api/state" -TimeoutSec 2
    $validLayout = $state.layoutMode -in @('automatic', 'freeform', 'template')
    $hasTiles = $null -ne $state.tiles
    [pscustomobject]@{
      IsLiveWall = ($validLayout -and $hasTiles)
      Healthy = ($validLayout -and $hasTiles)
      Message = if ($validLayout -and $hasTiles) { 'LiveWall is ready.' } else { 'The state response is not LiveWall.' }
    }
  } catch {
    [pscustomobject]@{ IsLiveWall = $false; Healthy = $false; Message = $_.Exception.Message }
  }
}

function Get-LiveWallServerStatus {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [scriptblock]$PortProbe,
    [scriptblock]$EndpointProbe
  )
  if (-not $PortProbe) { $PortProbe = { param($value) Test-LiveWallPortOpen -Port $value } }
  if (-not $EndpointProbe) { $EndpointProbe = { param($url) Test-LiveWallEndpoint -BaseUrl $url } }
  if (-not (& $PortProbe $Port)) { return [pscustomobject]@{ Status = 'not-running'; Message = 'Port is available.' } }
  $probe = & $EndpointProbe "http://127.0.0.1:$Port"
  if ($probe.IsLiveWall -and $probe.Healthy) { return [pscustomobject]@{ Status = 'healthy'; Message = $probe.Message } }
  if ($probe.IsLiveWall) { return [pscustomobject]@{ Status = 'unhealthy'; Message = $probe.Message } }
  [pscustomobject]@{ Status = 'occupied'; Message = 'Another application is already using the LiveWall port.' }
}

function Wait-LiveWallReady {
  param(
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [double]$TimeoutSeconds = 30,
    [int]$PollMilliseconds = 300,
    [scriptblock]$EndpointProbe
  )
  if (-not $EndpointProbe) { $EndpointProbe = { param($url) Test-LiveWallEndpoint -BaseUrl $url } }
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $probe = & $EndpointProbe $BaseUrl
    if ($probe.IsLiveWall -and $probe.Healthy) { return $probe }
    if ($probe.IsLiveWall -and -not $probe.Healthy) { return $probe }
    Start-Sleep -Milliseconds $PollMilliseconds
  } while ([DateTime]::UtcNow -lt $deadline)
  $null
}

function Stop-LiveWallDedicatedBrowser {
  param(
    [Parameter(Mandatory = $true)][string]$ProfilePath,
    [string[]]$ProcessNames = @('chrome.exe', 'msedge.exe')
  )
  $normalized = [IO.Path]::GetFullPath($ProfilePath).TrimEnd('\')
  $profileArgument = '--user-data-dir=(?:")?' + [regex]::Escape($normalized) + '(?:")?(?:\s|$)'
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -in $ProcessNames -and $_.CommandLine -and
    $_.CommandLine -match $profileArgument
  }
  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
  }
  @($processes).Count
}

function Get-LiveWallWallSessionPath {
  param([Parameter(Mandatory = $true)][string]$Root)
  Join-Path $Root 'data\launcher\wall-session.json'
}

function Save-LiveWallWallSession {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$BrowserPath,
    [Parameter(Mandatory = $true)][string]$ProfilePath,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Mode,
    [string]$Status = 'open'
  )
  $path = Get-LiveWallWallSessionPath -Root $Root
  New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
  $record = [ordered]@{
    version = 1
    processId = $ProcessId
    browserPath = [IO.Path]::GetFullPath($BrowserPath)
    profilePath = [IO.Path]::GetFullPath($ProfilePath).TrimEnd('\')
    url = $Url
    mode = $Mode
    status = $Status
    updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
  $temp = "$path.tmp"
  $record | ConvertTo-Json | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $path -Force
  [pscustomobject]$record
}

function Test-LiveWallWallSession {
  param(
    [Parameter(Mandatory = $true)]$Session,
    [Parameter(Mandatory = $true)][string]$ExpectedBrowserPath,
    [Parameter(Mandatory = $true)][string]$ExpectedProfilePath,
    [Parameter(Mandatory = $true)][string]$ExpectedUrl,
    $Process
  )
  if ($Session.status -eq 'closed') {
    return [pscustomobject]@{ Valid = $false; Status = 'already-closed'; Message = 'The dedicated Wall is already closed.' }
  }
  if (-not $Process) {
    return [pscustomobject]@{ Valid = $false; Status = 'stale'; Message = 'The registered Wall process is no longer running.' }
  }
  $expectedBrowser = [IO.Path]::GetFullPath($ExpectedBrowserPath)
  $expectedProfile = [IO.Path]::GetFullPath($ExpectedProfilePath).TrimEnd('\')
  $profileArgument = '--user-data-dir=(?:")?' + [regex]::Escape($expectedProfile) + '(?:")?(?:\s|$)'
  $pathMatches = $Process.ExecutablePath -and ([IO.Path]::GetFullPath([string]$Process.ExecutablePath) -ieq $expectedBrowser)
  $recordMatches =
    [int]$Session.processId -eq [int]$Process.ProcessId -and
    [string]$Session.browserPath -ieq $expectedBrowser -and
    [string]$Session.profilePath -ieq $expectedProfile -and
    [string]$Session.url -eq $ExpectedUrl
  $commandMatches =
    $Process.CommandLine -and
    [string]$Process.CommandLine -match $profileArgument -and
    ([string]$Process.CommandLine).IndexOf($ExpectedUrl, [StringComparison]::OrdinalIgnoreCase) -ge 0
  if (-not ($pathMatches -and $recordMatches -and $commandMatches)) {
    return [pscustomobject]@{ Valid = $false; Status = 'mismatch'; Message = 'The registered Wall process did not match its executable, profile, and Wall URL. Nothing was closed.' }
  }
  [pscustomobject]@{ Valid = $true; Status = 'open'; Message = 'The dedicated Wall process is valid.' }
}

function Get-LiveWallWallContext {
  param([Parameter(Mandatory = $true)][string]$Root)
  $configPath = Join-Path $Root 'launcher\livewall-launcher.json'
  [void](Initialize-LiveWallLauncherConfig -ConfigPath $configPath)
  [void](Update-LiveWallLauncherConfig -ConfigPath $configPath)
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $browser = Find-LiveWallBrowser -Preferred ([string]$config.browser)
  $profile = Join-Path $Root 'data\launcher\browser-profiles\wall'
  $url = "http://127.0.0.1:$([int]$config.port)/wall?launchMode=$([string]$config.wallMode)"
  [pscustomobject]@{ Config = $config; Browser = $browser; ProfilePath = $profile; Url = $url }
}

function Close-LiveWallDedicatedWall {
  param([Parameter(Mandatory = $true)][string]$Root)
  $path = Get-LiveWallWallSessionPath -Root $Root
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    return [pscustomobject]@{ Ok = $true; Status = 'already-closed'; Message = 'The dedicated Wall is already closed.' }
  }
  $session = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $context = Get-LiveWallWallContext -Root $Root
  if ($session.status -eq 'closed') {
    return [pscustomobject]@{ Ok = $true; Status = 'already-closed'; Message = 'The dedicated Wall is already closed.' }
  }
  $registered = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$session.processId)" -ErrorAction SilentlyContinue
  $validation = Test-LiveWallWallSession -Session $session -ExpectedBrowserPath $context.Browser.Path `
    -ExpectedProfilePath $context.ProfilePath -ExpectedUrl $context.Url -Process $registered
  if (-not $validation.Valid) {
    return [pscustomobject]@{ Ok = $false; Status = $validation.Status; Message = $validation.Message }
  }
  $expectedBrowser = [IO.Path]::GetFullPath($context.Browser.Path)
  $expectedProfile = [IO.Path]::GetFullPath($context.ProfilePath).TrimEnd('\')
  $profileArgument = '--user-data-dir=(?:")?' + [regex]::Escape($expectedProfile) + '(?:")?(?:\s|$)'
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ExecutablePath -and ([IO.Path]::GetFullPath([string]$_.ExecutablePath) -ieq $expectedBrowser) -and
      $_.CommandLine -and [string]$_.CommandLine -match $profileArgument
    })
  foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue }
  [void](Save-LiveWallWallSession -Root $Root -ProcessId ([int]$session.processId) `
      -BrowserPath $expectedBrowser -ProfilePath $expectedProfile -Url $context.Url `
      -Mode ([string]$context.Config.wallMode) -Status 'closed')
  [pscustomobject]@{ Ok = $true; Status = 'closed'; Message = 'The dedicated Wall was closed. The server and saved configuration remain running.'; ProcessCount = $processes.Count }
}

function Open-LiveWallDedicatedWall {
  param([Parameter(Mandatory = $true)][string]$Root)
  $context = Get-LiveWallWallContext -Root $Root
  $screens = @(Get-LiveWallScreens)
  $selection = Select-LiveWallDisplay -Screens $screens -RequestedDeviceName ([string]$context.Config.wallDisplay)
  New-Item -ItemType Directory -Path $context.ProfilePath -Force | Out-Null
  $path = Get-LiveWallWallSessionPath -Root $Root
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    $session = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($session.status -eq 'open') {
      $registered = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$session.processId)" -ErrorAction SilentlyContinue
      $validation = Test-LiveWallWallSession -Session $session -ExpectedBrowserPath $context.Browser.Path `
        -ExpectedProfilePath $context.ProfilePath -ExpectedUrl $context.Url -Process $registered
      if ($validation.Valid) {
        return [pscustomobject]@{ Ok = $true; Status = 'already-open'; Message = 'The dedicated Wall is already open.'; ProcessId = [int]$session.processId }
      }
      if ($validation.Status -eq 'mismatch') {
        return [pscustomobject]@{ Ok = $false; Status = 'mismatch'; Message = $validation.Message }
      }
    }
  }
  $arguments = New-LiveWallWallArguments -Screen $selection.Screen -ProfilePath $context.ProfilePath `
    -Url $context.Url -Mode ([string]$context.Config.wallMode) `
    -AutoplayWithSound ([bool]$context.Config.wallAutoplayWithSound)
  $process = Start-Process -FilePath $context.Browser.Path -ArgumentList $arguments -PassThru
  [void](Save-LiveWallWallSession -Root $Root -ProcessId $process.Id -BrowserPath $context.Browser.Path `
      -ProfilePath $context.ProfilePath -Url $context.Url -Mode ([string]$context.Config.wallMode))
  [pscustomobject]@{ Ok = $true; Status = 'opened'; Message = "The dedicated Wall opened on $($selection.Screen.DeviceName)."; ProcessId = $process.Id; Display = $selection.Screen.DeviceName; FallbackUsed = $selection.FallbackUsed }
}

Export-ModuleMember -Function *-LiveWall*
