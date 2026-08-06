$ErrorActionPreference = 'Stop'
$result = Invoke-Pester -Script $PSScriptRoot -PassThru
if ($result.FailedCount -gt 0) { exit 1 }
exit 0
