# setup.ps1 — Downloads Stockfish binary for local Windows development.
# Not needed when running via Docker (the image installs Stockfish itself).

$ErrorActionPreference = 'Stop'

$binDir = Join-Path $PSScriptRoot 'bin'
$stockfishExe = Join-Path $binDir 'stockfish.exe'

if (Test-Path $stockfishExe) {
    Write-Host "Stockfish already present at $stockfishExe" -ForegroundColor Green
    exit 0
}

New-Item -ItemType Directory -Force -Path $binDir | Out-Null

# Stockfish 17 — official release. AVX2 build covers all recent Intel/AMD CPUs.
$url = 'https://github.com/official-stockfish/Stockfish/releases/download/sf_17/stockfish-windows-x86-64-avx2.zip'
$zip = Join-Path $env:TEMP "stockfish-$(Get-Random).zip"
$tempExtract = Join-Path $env:TEMP "stockfish-extract-$(Get-Random)"

Write-Host "Downloading Stockfish 17 (AVX2)..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

Write-Host "Extracting..." -ForegroundColor Cyan
Expand-Archive -Path $zip -DestinationPath $tempExtract -Force

$exe = Get-ChildItem -Path $tempExtract -Filter 'stockfish*.exe' -Recurse | Select-Object -First 1
if (-not $exe) { throw "stockfish.exe not found in downloaded archive" }

Move-Item -Path $exe.FullName -Destination $stockfishExe -Force
Remove-Item -Path $zip -Force
Remove-Item -Path $tempExtract -Recurse -Force

Write-Host ""
Write-Host "Stockfish installed at $stockfishExe" -ForegroundColor Green
Write-Host "Run 'npm install && npm run dev' to start the app." -ForegroundColor Green
