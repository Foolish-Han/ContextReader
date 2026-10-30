$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$taskPidFile = Join-Path $taskRoot '.local\auth.pid'
if (-not (Test-Path -LiteralPath $taskPidFile)) { Write-Host 'No project OAuth helper PID is recorded.'; return }
$taskProcessId = 0
if (-not [int]::TryParse((Get-Content -LiteralPath $taskPidFile -Raw).Trim(), [ref]$taskProcessId)) { throw 'Invalid helper PID file.' }
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId"
if (-not $taskProcess) { Write-Host 'The recorded OAuth helper is no longer running.'; return }
$taskExpected = Join-Path $taskRoot 'auth\server.mjs'
if ($taskProcess.Name -ne 'node.exe' -or -not $taskProcess.CommandLine.Contains($taskExpected)) { throw 'PID belongs to a different process; it will not be stopped.' }
Stop-Process -Id $taskProcessId
Remove-Item -LiteralPath $taskPidFile
Write-Host 'OAuth helper stopped. The encrypted login remains saved for the next start.'
