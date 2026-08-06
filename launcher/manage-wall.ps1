[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('status', 'close', 'open')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Root
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'LiveWall.Launcher.psm1') -Force
try {
  if ($Action -eq 'close') { $result = Close-LiveWallDedicatedWall -Root $Root }
  elseif ($Action -eq 'open') { $result = Open-LiveWallDedicatedWall -Root $Root }
  else {
    $path = Get-LiveWallWallSessionPath -Root $Root
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      $result = [pscustomobject]@{ Ok = $true; Status = 'closed'; Message = 'The dedicated Wall has not been opened yet.' }
    } else {
      $session = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
      if ($session.status -eq 'closed') {
        $result = [pscustomobject]@{ Ok = $true; Status = 'closed'; Message = 'The dedicated Wall is closed.' }
      } else {
        $context = Get-LiveWallWallContext -Root $Root
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$session.processId)" -ErrorAction SilentlyContinue
        $validation = Test-LiveWallWallSession -Session $session -ExpectedBrowserPath $context.Browser.Path -ExpectedProfilePath $context.ProfilePath -ExpectedUrl $context.Url -Process $process
        $result = [pscustomobject]@{ Ok = $validation.Valid; Status = $validation.Status; Message = $validation.Message }
      }
    }
  }
  $result | ConvertTo-Json -Compress
  if (-not $result.Ok) { exit 2 }
  exit 0
} catch {
  [pscustomobject]@{ Ok = $false; Status = 'error'; Message = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
}
