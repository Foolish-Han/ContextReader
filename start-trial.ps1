$ErrorActionPreference = 'Stop'
$taskProjectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$taskLocal = Join-Path $taskProjectRoot '.local'
New-Item -ItemType Directory -Path $taskLocal -Force | Out-Null
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 22 或更新版本。' }
Push-Location -LiteralPath $taskProjectRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $taskProjectRoot 'node_modules\playwright'))) {
        npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $taskProjectRoot 'dist\manifest.json'))) {
        npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw '扩展构建失败。' }
    }
    & (Join-Path $taskProjectRoot 'start-auth.ps1')
    $taskBrowsers = Join-Path $taskLocal 'browsers'
    $taskChrome = Get-ChildItem -LiteralPath $taskBrowsers -Directory -Filter 'chromium-*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | ForEach-Object { Join-Path $_.FullName 'chrome-win64\chrome.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $taskChrome) {
        $taskPreviousBrowsers = $env:PLAYWRIGHT_BROWSERS_PATH
        try {
            $env:PLAYWRIGHT_BROWSERS_PATH = $taskBrowsers
            npx.cmd playwright install chromium
            if ($LASTEXITCODE -ne 0) { throw 'Chrome for Testing 下载失败。也可手动在 Chrome 中加载 dist 文件夹。' }
        } finally { $env:PLAYWRIGHT_BROWSERS_PATH = $taskPreviousBrowsers }
        $taskChrome = Get-ChildItem -LiteralPath $taskBrowsers -Directory -Filter 'chromium-*' | Sort-Object LastWriteTime -Descending | ForEach-Object { Join-Path $_.FullName 'chrome-win64\chrome.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if (-not $taskChrome) { throw '未找到 Chrome for Testing。请手动在 Chrome 中加载 dist 文件夹。' }
    $taskExtensionId = node.exe (Join-Path $taskProjectRoot 'scripts\extension-id.mjs')
    if ($LASTEXITCODE -ne 0 -or $taskExtensionId -notmatch '^[a-p]{32}$') { throw '无法确认扩展 ID。' }
    $taskDist = Join-Path $taskProjectRoot 'dist'
    $taskProfile = Join-Path $taskLocal 'trial-profile'
    $taskArguments = @(
        ('--user-data-dir="' + $taskProfile + '"')
        ('--disable-extensions-except="' + $taskDist + '"')
        ('--load-extension="' + $taskDist + '"')
        '--no-first-run'
        '--no-default-browser-check'
        ('chrome-extension://' + $taskExtensionId + '/options.html')
        'https://www.autodidacts.io/troubleshooting/'
    )
    Start-Process -FilePath $taskChrome -ArgumentList $taskArguments | Out-Null
    Write-Host '已打开独立试用窗口。先在设置页检查连接，再回到文章划选词句；所有普通网页默认启用。'
    Write-Host '这份试用资料保存在项目的 .local\trial-profile；日常 Chrome 需要单独加载 dist。'
} finally { Pop-Location }
