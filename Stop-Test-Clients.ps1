$ErrorActionPreference = 'Stop'
$taskExe = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'output\test-clients\game\PolyTrack.exe'))
# Match only this helper's isolated executable; do not stop the user's normal game.
Get-Process PolyTrack -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $taskExe } | Stop-Process
Write-Host 'Stopped the isolated PolyCup test clients. Saved profiles were retained.'
