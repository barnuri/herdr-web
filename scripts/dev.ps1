# herdr-web development helper (Windows PowerShell / pwsh)
# Usage: scripts/dev.ps1 [setup|dev|test|build]   (default: dev)
param(
    [ValidateSet('setup', 'dev', 'test', 'build')]
    [string]$Command = 'dev'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

function Invoke-Setup {
    Write-Host '==> installing server deps'
    Push-Location $Root; try { npm install } finally { Pop-Location }
    Write-Host '==> installing client deps'
    Push-Location (Join-Path $Root 'client'); try { npm install } finally { Pop-Location }
}

function Confirm-Deps {
    $serverDeps = Join-Path $Root 'node_modules'
    $clientDeps = Join-Path $Root 'client/node_modules'
    if (-not (Test-Path $serverDeps) -or -not (Test-Path $clientDeps)) {
        Invoke-Setup
    }
}

function Invoke-Dev {
    Confirm-Deps
    Write-Host '==> server on http://127.0.0.1:7936 + vite dev on http://127.0.0.1:5173 (ctrl+c stops both)'
    $server = Start-Process -PassThru -NoNewWindow node -ArgumentList 'server.js' -WorkingDirectory $Root
    try {
        Push-Location (Join-Path $Root 'client'); try { npm run dev } finally { Pop-Location }
    } finally {
        if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    }
}

function Invoke-Test {
    Confirm-Deps
    Write-Host '==> server lib tests'
    Push-Location $Root; try { npm test } finally { Pop-Location }
    Write-Host '==> client tests'
    Push-Location (Join-Path $Root 'client'); try { npm test } finally { Pop-Location }
}

function Invoke-Build {
    Confirm-Deps
    Write-Host '==> building client into public/ (commit the result)'
    Push-Location (Join-Path $Root 'client'); try { npm run build } finally { Pop-Location }
}

switch ($Command) {
    'setup' { Invoke-Setup }
    'dev' { Invoke-Dev }
    'test' { Invoke-Test }
    'build' { Invoke-Build }
}
