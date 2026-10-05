param([string]$GameDirectory = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$taskTarget = (Resolve-Path -LiteralPath $GameDirectory).Path
$taskRunning = Get-Process PolyTrack -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $taskTarget 'PolyTrack.exe') }
if ($taskRunning) { throw 'Close this copy of PolyTrack before restoring.' }
$taskPriorRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
  $env:ELECTRON_RUN_AS_NODE = '1'
  & (Join-Path $taskTarget 'PolyTrack.exe') (Join-Path $PSScriptRoot 'scripts/install.mjs') $taskTarget --restore | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Restoration failed. See the message above.' }
} finally { $env:ELECTRON_RUN_AS_NODE = $taskPriorRunAsNode }
