param([string]$GameDirectory = (Split-Path $PSScriptRoot -Parent))
& (Join-Path $PSScriptRoot "Install-PolyCup.ps1") -GameDirectory $GameDirectory
