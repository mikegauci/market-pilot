$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Refresh-Path {
  $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

Write-Host ""
Write-Host "Installing Node.js and Python if they are missing."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  Refresh-Path
}
if (-not (Get-Command python -ErrorAction SilentlyContinue) -and -not (Get-Command py -ErrorAction SilentlyContinue)) {
  winget install --id Python.Python.3.11 -e --accept-package-agreements --accept-source-agreements
  Refresh-Path
}

Write-Host ""
Write-Host "Installing the setup tools."
npm install --prefix setup
node setup/wizard.mjs
