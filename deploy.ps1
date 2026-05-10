# deploy.ps1 — Deploys this repo to a remote Docker host over SSH.
#
# Reads HOST and SUDO_PASS from .env.deploy (gitignored). Example .env.deploy:
#   HOST=user@1.2.3.4
#   REMOTE_DIR=/home/user/chess
#   SUDO_PASS=...
#   HOST_PORT=8800

param([switch]$NoBuild, [switch]$Logs)

$ErrorActionPreference = 'Stop'

$envFile = Join-Path $PSScriptRoot '.env.deploy'
if (-not (Test-Path $envFile)) {
    throw ".env.deploy not found. Create it with HOST=user@host, REMOTE_DIR=/path, SUDO_PASS=... (optional)"
}

$envVars = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$') {
        $envVars[$matches[1]] = $matches[2]
    }
}

$HOST_TARGET = $envVars['HOST']
$REMOTE_DIR  = $envVars['REMOTE_DIR']
$SUDO_PASS   = $envVars['SUDO_PASS']
$HOST_PORT   = if ($envVars['HOST_PORT']) { $envVars['HOST_PORT'] } else { '8800' }

if (-not $HOST_TARGET -or -not $REMOTE_DIR) {
    throw "HOST and REMOTE_DIR must be set in .env.deploy"
}

function Invoke-Remote([string]$cmd) {
    & ssh $HOST_TARGET $cmd
    if ($LASTEXITCODE -ne 0) { throw "Remote command failed: $cmd" }
}

# Run a multi-line bash script on the remote with sudo. Avoids PowerShell quoting
# pitfalls by scp'ing the script first, then executing it.
function Invoke-RemoteSudoScript([string]$script) {
    $localScript = Join-Path $env:TEMP "chess-remote-$(Get-Random).sh"
    $remoteScript = "/tmp/chess-remote-$(Get-Random).sh"
    # Write with LF line endings, no BOM
    [System.IO.File]::WriteAllText($localScript, "#!/usr/bin/env bash`nset -e`n" + $script.Replace("`r`n", "`n"), (New-Object System.Text.UTF8Encoding $false))
    & scp -q $localScript "${HOST_TARGET}:$remoteScript"
    if ($LASTEXITCODE -ne 0) { Remove-Item -Force $localScript; throw "scp script failed" }
    if ($SUDO_PASS) {
        & ssh $HOST_TARGET "chmod +x $remoteScript && echo '$SUDO_PASS' | sudo -S -p '' bash $remoteScript; rc=`$?; rm -f $remoteScript; exit `$rc"
    } else {
        & ssh $HOST_TARGET "chmod +x $remoteScript && sudo bash $remoteScript; rc=`$?; rm -f $remoteScript; exit `$rc"
    }
    $rc = $LASTEXITCODE
    Remove-Item -Force $localScript
    if ($rc -ne 0) { throw "Remote script failed (exit $rc)" }
}

Write-Host "→ Ensuring remote dir $REMOTE_DIR exists" -ForegroundColor Cyan
Invoke-Remote "mkdir -p $REMOTE_DIR"

Write-Host "→ Syncing source to $HOST_TARGET`:$REMOTE_DIR" -ForegroundColor Cyan
# Tar to a local temp file, scp it, extract on remote. PowerShell pipelines mangle
# binary streams, so we cannot pipe tar | ssh directly.
$localTar = Join-Path $env:TEMP "chess-deploy-$(Get-Random).tar.gz"
$remoteTar = "/tmp/chess-deploy-$(Get-Random).tar.gz"
# Prefer Windows native bsdtar — it understands drive letters cleanly. GNU tar (Git Bash)
# treats "R:" as a remote host. Fall back to whatever's on PATH.
$tarExe = Join-Path $env:WINDIR 'System32\tar.exe'
if (-not (Test-Path $tarExe)) { $tarExe = 'tar' }
$tarArgs = @(
    '--exclude=node_modules', '--exclude=.git', '--exclude=dist',
    '--exclude=build',        '--exclude=data', '--exclude=bin',
    '--exclude=.env',         '--exclude=.env.deploy',
    '-czf', $localTar, '-C', $PSScriptRoot, '.'
)
& $tarExe @tarArgs
if ($LASTEXITCODE -ne 0) { throw "tar failed" }
& scp -q $localTar "${HOST_TARGET}:$remoteTar"
if ($LASTEXITCODE -ne 0) { Remove-Item -Force $localTar; throw "scp failed" }
Invoke-Remote "tar -xzf $remoteTar -C $REMOTE_DIR && rm -f $remoteTar"
Remove-Item -Force $localTar

if (-not $NoBuild) {
    Write-Host "→ Building image on remote (this can take a few minutes)" -ForegroundColor Cyan
    Invoke-RemoteSudoScript @"
cd $REMOTE_DIR
HOST_PORT=$HOST_PORT docker compose build
"@
}

Write-Host "→ Starting container" -ForegroundColor Cyan
Invoke-RemoteSudoScript @"
cd $REMOTE_DIR
HOST_PORT=$HOST_PORT docker compose up -d
sleep 2
docker compose ps
"@

if ($Logs) {
    Invoke-RemoteSudoScript @"
cd $REMOTE_DIR
docker compose logs --tail=50
"@
}

$serverIp = ($HOST_TARGET -split '@')[-1]
Write-Host ""
Write-Host "Deployed. Open http://${serverIp}:$HOST_PORT" -ForegroundColor Green
