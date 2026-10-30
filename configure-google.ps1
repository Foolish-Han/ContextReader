param([string]$ClientId, [string]$ChromeUserDataPath = (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'))
$ErrorActionPreference = 'Stop'
$taskProject = [IO.Path]::GetFullPath($PSScriptRoot)
if (-not $ClientId) { $ClientId = Read-Host '粘贴 Google OAuth Client ID（不需要 Client Secret）' }
$ClientId = $ClientId.Trim()
if ($ClientId -notmatch '^\d+-[\w-]+\.apps\.googleusercontent\.com$') { throw 'Client ID 格式不正确，应以 .apps.googleusercontent.com 结尾。' }
$taskManifestPath = Join-Path $taskProject 'dist\manifest.json'
$taskPublicConfig = Join-Path $taskProject 'extension\google-oauth.json'
if (-not (Test-Path -LiteralPath $taskManifestPath)) { throw '请使用包含 dist 的已构建安装包。' }
$taskManifest = Get-Content -LiteralPath $taskManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$taskAppNames = @('语境 Context Reader', '语境 · Context Reader')
if ($taskManifest.name -notin $taskAppNames -or -not $taskManifest.key) { throw '目标目录不是预期的语境扩展。' }
if (@($taskManifest.permissions) -notcontains 'identity') { throw '请先升级到支持 Google 同步的语境版本。' }
$taskKeyBytes = [Convert]::FromBase64String($taskManifest.key)
$taskSha = [Security.Cryptography.SHA256]::Create()
try { $taskHash = $taskSha.ComputeHash($taskKeyBytes) } finally { $taskSha.Dispose() }
$taskExtensionId = -join ($taskHash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
$taskOAuth = @{ client_id=$ClientId; scopes=@('https://www.googleapis.com/auth/drive.appdata') }
$taskUtf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($taskPublicConfig, (@{clientId=$ClientId} | ConvertTo-Json), $taskUtf8)
$taskTargets = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
[void]$taskTargets.Add([IO.Path]::GetFullPath($taskManifestPath))
# Inspect installation metadata only. Never read cookies or credentials, and
# never write the browser's Preferences or Secure Preferences files.
if (Test-Path -LiteralPath $ChromeUserDataPath) {
    $taskProfiles = @(Get-ChildItem -LiteralPath $ChromeUserDataPath -Directory | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' })
    foreach ($taskProfile in $taskProfiles) {
        foreach ($taskPreferenceName in @('Preferences', 'Secure Preferences')) {
            $taskPreferencePath = Join-Path $taskProfile.FullName $taskPreferenceName
            if (-not (Test-Path -LiteralPath $taskPreferencePath)) { continue }
            try {
                $taskPreferences = Get-Content -LiteralPath $taskPreferencePath -Raw -Encoding UTF8 | ConvertFrom-Json
                $taskExtensionProperty = $taskPreferences.extensions.settings.PSObject.Properties[$taskExtensionId]
                if (-not $taskExtensionProperty) { continue }
                $taskInstalled = $taskExtensionProperty.Value
                if ($taskInstalled.location -ne 4 -or -not [IO.Path]::IsPathRooted([string]$taskInstalled.path)) { continue }
                $taskCandidate = Join-Path ([IO.Path]::GetFullPath($taskInstalled.path)) 'manifest.json'
                if (-not (Test-Path -LiteralPath $taskCandidate)) { continue }
                $taskCandidateManifest = Get-Content -LiteralPath $taskCandidate -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($taskCandidateManifest.key -ne $taskManifest.key -or $taskCandidateManifest.name -notin $taskAppNames -or @($taskCandidateManifest.permissions) -notcontains 'identity') { continue }
                [void]$taskTargets.Add($taskCandidate)
            } catch { Write-Warning ('跳过无法读取的 Chrome 扩展安装元数据：' + $taskPreferencePath) }
        }
    }
}
foreach ($taskTarget in $taskTargets) {
    $taskTargetManifest = Get-Content -LiteralPath $taskTarget -Raw -Encoding UTF8 | ConvertFrom-Json
    $taskTargetManifest | Add-Member -NotePropertyName oauth2 -NotePropertyValue $taskOAuth -Force
    [IO.File]::WriteAllText($taskTarget, ($taskTargetManifest | ConvertTo-Json -Depth 20), $taskUtf8)
    $taskTargetRoot = Split-Path -Parent (Split-Path -Parent $taskTarget)
    $taskTargetSource = Join-Path $taskTargetRoot 'extension'
    if (Test-Path -LiteralPath $taskTargetSource -PathType Container) { [IO.File]::WriteAllText((Join-Path $taskTargetSource 'google-oauth.json'), (@{clientId=$ClientId} | ConvertTo-Json), $taskUtf8) }
    Write-Host ('应用配置已写入：' + $taskTarget)
}
Write-Host '已同步同一扩展 ID 的 Chrome 已加载开发副本。请重新加载语境，并刷新设置页。'
Write-Host 'Client ID 是应用级公开标识，由发布者配置一次；普通用户只需点击“连接 Google Drive”并本人授权。'
