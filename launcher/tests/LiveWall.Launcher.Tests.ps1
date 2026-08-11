$modulePath = Join-Path (Split-Path $PSScriptRoot -Parent) 'LiveWall.Launcher.psm1'
Import-Module $modulePath -Force

function New-TestScreen($name, $primary, $x, $y, $width, $height, $workX, $workY, $workWidth, $workHeight) {
  [pscustomobject]@{
    DeviceName = $name
    Primary = $primary
    Bounds = [pscustomobject]@{ X = $x; Y = $y; Width = $width; Height = $height }
    WorkingArea = [pscustomobject]@{ X = $workX; Y = $workY; Width = $workWidth; Height = $workHeight }
  }
}

Describe 'LiveWall launcher configuration initialization' {
  It 'creates a local configuration from the safe example when missing' {
    $launcherDirectory = Join-Path $TestDrive 'launcher'
    New-Item -ItemType Directory -Path $launcherDirectory -Force | Out-Null
    $example = Join-Path $launcherDirectory 'livewall-launcher.example.json'
    $local = Join-Path $launcherDirectory 'livewall-launcher.json'
    '{"wallDisplay":"\\\\.\\DISPLAY2","adminDisplay":"\\\\.\\DISPLAY1","wallMode":"kiosk","browser":"chrome","port":4174,"startupTimeoutSeconds":30}' |
      Set-Content -LiteralPath $example -Encoding UTF8

    (Initialize-LiveWallLauncherConfig -ConfigPath $local) | Should Be $true
    (Test-Path -LiteralPath $local -PathType Leaf) | Should Be $true
    $config = Get-Content -LiteralPath $local -Raw | ConvertFrom-Json
    $config.port | Should Be 4174
    $config.wallMode | Should Be 'kiosk'
  }

  It 'keeps an existing local configuration intact' {
    $launcherDirectory = Join-Path $TestDrive 'existing-launcher'
    New-Item -ItemType Directory -Path $launcherDirectory -Force | Out-Null
    $example = Join-Path $launcherDirectory 'livewall-launcher.example.json'
    $local = Join-Path $launcherDirectory 'livewall-launcher.json'
    '{"port":4174}' | Set-Content -LiteralPath $example -Encoding UTF8
    '{"port":4999}' | Set-Content -LiteralPath $local -Encoding UTF8
    $before = Get-Content -LiteralPath $local -Raw

    (Initialize-LiveWallLauncherConfig -ConfigPath $local) | Should Be $false
    (Get-Content -LiteralPath $local -Raw) | Should Be $before
  }

  It 'adds the Wall autoplay setting atomically to a legacy local configuration' {
    $local = Join-Path $TestDrive 'legacy-launcher.json'
    '{"port":4174,"browser":"chrome"}' | Set-Content -LiteralPath $local -Encoding UTF8
    (Update-LiveWallLauncherConfig -ConfigPath $local) | Should Be $true
    $config = Get-Content -LiteralPath $local -Raw | ConvertFrom-Json
    $config.port | Should Be 4174
    $config.browser | Should Be 'chrome'
    $config.wallAutoplayWithSound | Should Be $true
    $config.externalTvMonitor | Should Be '\\.\DISPLAY2'
    $config.externalTvProfileDir | Should Be 'data\launcher\browser-profiles\external-tv'
    $config.externalTvFullscreen | Should Be $true
    (Test-Path -LiteralPath "$local.tmp") | Should Be $false
  }

  It 'preserves an existing Wall autoplay choice on warm runs' {
    $local = Join-Path $TestDrive 'warm-launcher.json'
    '{"port":4174,"wallAutoplayWithSound":false,"externalTvMonitor":"\\\\.\\DISPLAY2","externalTvProfileDir":"data\\launcher\\browser-profiles\\external-tv","externalTvFullscreen":true}' | Set-Content -LiteralPath $local -Encoding UTF8
    $before = Get-Content -LiteralPath $local -Raw
    (Update-LiveWallLauncherConfig -ConfigPath $local) | Should Be $false
    (Get-Content -LiteralPath $local -Raw) | Should Be $before
  }
}

Describe 'LiveWall display selection' {
  $primary = New-TestScreen '\\.\DISPLAY1' $true 0 0 2560 1440 0 0 2560 1400
  $secondary = New-TestScreen '\\.\DISPLAY2' $false -720 -2160 1920 1080 -720 -2160 1920 1040

  It 'selects Windows display identity and preserves negative coordinates' {
    $result = Select-LiveWallDisplay -Screens @($primary, $secondary) -RequestedDeviceName '\\.\DISPLAY2'
    $result.FallbackUsed | Should Be $false
    $result.Screen.DeviceName | Should Be '\\.\DISPLAY2'
    $result.Screen.Bounds.X | Should Be -720
    $result.Screen.Bounds.Y | Should Be -2160
  }

  It 'falls back to the primary screen when Monitor 2 is missing' {
    $result = Select-LiveWallDisplay -Screens @($primary) -RequestedDeviceName '\\.\DISPLAY2'
    $result.FallbackUsed | Should Be $true
    $result.Screen.DeviceName | Should Be '\\.\DISPLAY1'
  }
}

Describe 'LiveWall browser discovery and arguments' {
  It 'finds Chrome in a path containing spaces' {
    $chrome = Join-Path $TestDrive 'Program Files\Google\Chrome\Application\chrome.exe'
    New-Item -ItemType File -Path $chrome -Force | Out-Null
    $result = Find-LiveWallBrowser -ChromeCandidates @($chrome) -EdgeCandidates @()
    $result.Name | Should Be 'Google Chrome'
    $result.Path | Should Be $chrome
  }

  It 'uses Edge only as a documented fallback' {
    $edge = Join-Path $TestDrive 'Microsoft Edge\msedge.exe'
    New-Item -ItemType File -Path $edge -Force | Out-Null
    $result = Find-LiveWallBrowser -ChromeCandidates @() -EdgeCandidates @($edge)
    $result.Name | Should Be 'Microsoft Edge'
    $result.FallbackUsed | Should Be $true
  }

  It 'constructs kiosk and admin arguments with correct quoting and coordinates' {
    $screen = New-TestScreen '\\.\DISPLAY2' $false -720 -2160 1920 1080 -720 -2160 1920 1040
    $wall = New-LiveWallWallArguments -Screen $screen -ProfilePath 'C:\LiveWall Data\wall' -Url 'http://127.0.0.1:4174/wall'
    $admin = New-LiveWallAdminArguments -Screen $screen -ProfilePath 'C:\LiveWall Data\admin' -Url 'http://127.0.0.1:4174/admin'
    ($wall -contains '--kiosk') | Should Be $true
    ($wall -contains '--window-position=-720,-2160') | Should Be $true
    ($wall -contains '--window-size=1920,1080') | Should Be $true
    ($wall -contains '--user-data-dir="C:\LiveWall Data\wall"') | Should Be $true
    ($admin -contains '--new-window') | Should Be $true
    ($admin -contains '--window-size=1920,1040') | Should Be $true
    ($admin -contains '--user-data-dir="C:\LiveWall Data\admin"') | Should Be $true
  }

  It 'applies autoplay-with-sound only to the dedicated Wall arguments' {
    $screen = New-TestScreen '\\.\DISPLAY2' $false 0 0 1920 1080 0 0 1920 1040
    $wall = New-LiveWallWallArguments -Screen $screen -ProfilePath 'C:\LiveWall\wall' `
      -Url 'http://127.0.0.1:4174/wall' -AutoplayWithSound $true
    $admin = New-LiveWallAdminArguments -Screen $screen -ProfilePath 'C:\LiveWall\admin' `
      -Url 'http://127.0.0.1:4174/admin'
    ($wall -contains '--autoplay-policy=no-user-gesture-required') | Should Be $true
    ($admin -contains '--autoplay-policy=no-user-gesture-required') | Should Be $false
  }

  It 'uses an isolated persistent External TV profile without kiosk restrictions' {
    $screen = New-TestScreen '\\.\DISPLAY2' $false -720 -2160 1920 1080 -720 -2160 1920 1040
    $args = New-LiveWallExternalTvArguments -Screen $screen -ProfilePath 'C:\LiveWall\data\launcher\browser-profiles\external-tv' -Url 'https://provider.example/watch' -Fullscreen $true
    ($args -join ' ') | Should Match '--user-data-dir='
    ($args -join ' ') | Should Match '--start-fullscreen'
    ($args -join ' ') | Should Not Match '--kiosk'
  }
}

Describe 'LiveWall server readiness' {
  It 'accepts every P3 layout mode in the installed health contract' {
    $moduleSource = Get-Content -LiteralPath $modulePath -Raw
    $moduleSource | Should Match "'automatic', 'freeform', 'template'"
  }

  It 'reuses an existing healthy LiveWall server' {
    $status = Get-LiveWallServerStatus -Port 4174 -PortProbe { $true } -EndpointProbe {
      [pscustomobject]@{ IsLiveWall = $true; Healthy = $true; Message = 'ready' }
    }
    $status.Status | Should Be 'healthy'
  }

  It 'rejects an unrelated process occupying the port' {
    $status = Get-LiveWallServerStatus -Port 4174 -PortProbe { $true } -EndpointProbe {
      [pscustomobject]@{ IsLiveWall = $false; Healthy = $false; Message = 'other' }
    }
    $status.Status | Should Be 'occupied'
  }

  It 'returns not-running for an available port' {
    $status = Get-LiveWallServerStatus -Port 4174 -PortProbe { $false }
    $status.Status | Should Be 'not-running'
  }

  It 'times out readiness with a bounded wait' {
    $result = Wait-LiveWallReady -BaseUrl 'http://127.0.0.1:4174' -TimeoutSeconds 0.05 `
      -PollMilliseconds 5 -EndpointProbe {
        [pscustomobject]@{ IsLiveWall = $false; Healthy = $false; Message = 'waiting' }
      }
    $result | Should Be $null
  }
}

Describe 'LiveWall process safety' {
  It 'contains no broad Chrome termination command' {
    $moduleText = Get-Content -LiteralPath $modulePath -Raw
    $scriptText = Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'start-livewall.ps1') -Raw
    ($moduleText + $scriptText) | Should Not Match 'taskkill'
    ($moduleText + $scriptText) | Should Not Match 'Get-Process\s+chrome'
  }

  It 'scopes replacement to the exact dedicated profile argument' {
    $moduleText = Get-Content -LiteralPath $modulePath -Raw
    $moduleText | Should Match '--user-data-dir='
    $moduleText | Should Match '\[regex\]::Escape\(\$normalized\)'
    $moduleText | Should Match 'Stop-Process -Id \$process.ProcessId'
  }

  It 'uses a non-blocking per-port mutex to reject overlapping launches' {
    $scriptText = Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'start-livewall.ps1') -Raw
    $scriptText | Should Match 'Local\\LiveWallLauncher-\$port'
    $scriptText | Should Match '\$mutex\.WaitOne\(0\)'
    $scriptText | Should Match 'Another LiveWall launch is already in progress'
  }

  It 'launches the dedicated Wall with explicit kiosk context' {
    $scriptText = Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'start-livewall.ps1') -Raw
    $scriptText | Should Match '/wall\?launchMode=\$\(\$config.wallMode\)'
  }
}

Describe 'LiveWall dedicated Wall session validation' {
  $browser = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
  $profile = 'C:\LiveWall\data\launcher\browser-profiles\wall'
  $url = 'http://127.0.0.1:4174/wall?launchMode=kiosk'
  $session = [pscustomobject]@{ processId = 42; browserPath = $browser; profilePath = $profile; url = $url; status = 'open' }

  It 'accepts only the registered executable, Wall profile, PID, and URL' {
    $process = [pscustomobject]@{ ProcessId = 42; ExecutablePath = $browser; CommandLine = "`"$browser`" --user-data-dir=`"$profile`" --kiosk $url" }
    $result = Test-LiveWallWallSession -Session $session -ExpectedBrowserPath $browser -ExpectedProfilePath $profile -ExpectedUrl $url -Process $process
    $result.Valid | Should Be $true
  }

  It 'rejects a stale PID without terminating anything' {
    $result = Test-LiveWallWallSession -Session $session -ExpectedBrowserPath $browser -ExpectedProfilePath $profile -ExpectedUrl $url -Process $null
    $result.Valid | Should Be $false
    $result.Status | Should Be 'stale'
  }

  It 'rejects the wrong executable, profile, or URL' {
    $wrong = [pscustomobject]@{ ProcessId = 42; ExecutablePath = 'C:\Windows\notepad.exe'; CommandLine = 'notepad.exe' }
    $result = Test-LiveWallWallSession -Session $session -ExpectedBrowserPath $browser -ExpectedProfilePath $profile -ExpectedUrl $url -Process $wrong
    $result.Valid | Should Be $false
    $result.Status | Should Be 'mismatch'
  }

  It 'makes a second close safe through a closed session record' {
    $closed = [pscustomobject]@{ processId = 42; browserPath = $browser; profilePath = $profile; url = $url; status = 'closed' }
    $result = Test-LiveWallWallSession -Session $closed -ExpectedBrowserPath $browser -ExpectedProfilePath $profile -ExpectedUrl $url -Process $null
    $result.Status | Should Be 'already-closed'
  }

  It 'recovers a stale launcher PID by closing only the dedicated Wall profile' {
    $moduleText = Get-Content -LiteralPath $modulePath -Raw
    $moduleText | Should Match "\$validation.Status -ne 'stale'"
    $moduleText | Should Match '\$_.CommandLine -match \$profileArgument'
    $moduleText | Should Match 'stale Wall launcher record was recovered'
  }
}

Describe 'LiveWall External TV closed-session recovery' {
  It 'reports an already-closed External TV session as a safe closed status' {
    $moduleText = Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'LiveWall.Launcher.psm1') -Raw
    $moduleText | Should Match 'Status -eq ''already-closed''\) \{ return \[pscustomobject\]@\{ Ok = \$true; Status = ''closed'''
  }
}
