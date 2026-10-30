$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($PSScriptRoot)
Push-Location -LiteralPath $taskRoot
try {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js 22 or newer is required.' }
    if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules\jose'))) {
        npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'auth\siwc-runtime.mjs'))) {
        node.exe scripts/build-auth.mjs
        if ($LASTEXITCODE -ne 0) { throw 'OAuth runtime build failed.' }
    }
    $taskHealth = $null
    try { $taskHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:43821/health' -TimeoutSec 3 } catch {}
    if ($taskHealth -and $taskHealth.provider -ne 'context-reader-oauth') { throw 'Port 43821 is occupied by another service. Stop the previous project bridge before starting OAuth.' }
    if ($taskHealth.provider -ne 'context-reader-oauth') {
        $taskLocal = Join-Path $taskRoot '.local'
        New-Item -ItemType Directory -Path $taskLocal -Force | Out-Null
        $taskNode = (Get-Command node.exe).Source
        $taskServer = Join-Path $taskRoot 'auth\server.mjs'
        $taskProcess = Start-Process -FilePath $taskNode -ArgumentList @('"' + $taskServer + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLocal 'auth.log') -RedirectStandardError (Join-Path $taskLocal 'auth-error.log') -PassThru
        $taskProcess.Id | Set-Content -LiteralPath (Join-Path $taskLocal 'auth.pid')
        Start-Sleep -Milliseconds 700
        $taskHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:43821/health' -TimeoutSec 5
    }
    Write-Host 'Independent OAuth helper is ready. Click Continue with ChatGPT in extension settings.'
    Write-Host 'Model requests go directly from the extension to OpenAI. Codex is not used.'
} finally { Pop-Location }
