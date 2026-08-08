[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('status', 'close', 'open')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Url
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'LiveWall.Launcher.psm1') -Force
try {
  if ($Action -eq 'open') { $result = Open-LiveWallExternalTv -Root $Root -Url $Url }
  elseif ($Action -eq 'close') { $result = Close-LiveWallExternalTv -Root $Root }
  else { $result = Get-LiveWallExternalTvStatus -Root $Root }
  $result | ConvertTo-Json -Compress
  if (-not $result.Ok) { exit 2 }
} catch {
  [pscustomobject]@{ Ok = $false; Status = 'error'; Message = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
}
