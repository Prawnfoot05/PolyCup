param(
  [ValidateRange(1,8)][int]$Count = 8,
  [ValidateRange(1,8)][int]$StartFrom = 1,
  [string]$GameDirectory = (Split-Path -Parent $PSScriptRoot),
  [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
if (($StartFrom + $Count - 1) -gt 8) { throw 'Choose client numbers within 1 through 8.' }
$taskSource = (Resolve-Path -LiteralPath $GameDirectory).Path
$taskRoot = Join-Path $PSScriptRoot 'output\test-clients'
$taskGame = Join-Path $taskRoot 'game'
$taskExe = Join-Path $taskGame 'PolyTrack.exe'
$taskActive = @(Get-Process PolyTrack -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $taskExe })
$taskPriorNode = $env:ELECTRON_RUN_AS_NODE
$taskPriorProfile = $env:PWC_PROFILE_DIR
$taskPriorClient = $env:PWC_TEST_CLIENT
try {
  if ($taskActive.Count -eq 0) {
    $env:ELECTRON_RUN_AS_NODE = '1'
    & (Join-Path $taskSource 'PolyTrack.exe') (Join-Path $PSScriptRoot 'scripts\prepare-test-clients.mjs') $taskSource | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the test build.' }
  }
  if ($PrepareOnly) { return }
  $env:ELECTRON_RUN_AS_NODE = $null
  foreach ($taskNumber in $StartFrom..($StartFrom + $Count - 1)) {
    $taskProfile = Join-Path $taskRoot "profiles\client-$taskNumber"
    New-Item -ItemType Directory -Path $taskProfile -Force | Out-Null
    $env:PWC_PROFILE_DIR = $taskProfile
    $env:PWC_TEST_CLIENT = [string]$taskNumber
    # The user explicitly launches these visible, interactive test windows.
    Start-Process -FilePath $taskExe -WorkingDirectory $taskGame -WindowStyle Normal
    Write-Host "Opened test client $taskNumber (separate saved tracks, settings, and identity)."
    Start-Sleep -Milliseconds 800
  }
} finally {
  $env:ELECTRON_RUN_AS_NODE = $taskPriorNode
  $env:PWC_PROFILE_DIR = $taskPriorProfile
  $env:PWC_TEST_CLIENT = $taskPriorClient
}
