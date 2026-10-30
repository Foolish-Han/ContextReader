# 开发指南

## 环境

- 完整开发与自动回归：Windows、Node.js 22 或 24、npm、Git。
- API Key 已构建扩展的使用不需要 Node.js。
- ChatGPT 认证助手依赖 Windows DPAPI。不要把其他系统视为已验证；跨平台支持是待办。

```powershell
git clone https://github.com/Foolish-Han/ContextReader.git
cd ContextReader
npm ci
npm run build
npm test
npm run test:auth
npm run verify:repo
```

`npm test` 会先生成认证测试所需的运行时。`vendor` 的原始固定源码不修改；适配在构建阶段完成。

在 `chrome://extensions` 加载根目录 `dist`。修改源码后重新 build、重新加载扩展、刷新文章。不要把生成文件直接改成新的源码，也不要把浏览器安装路径指向一次性的历史发行目录。

## 浏览器回归

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.local/browsers"
npx playwright install chromium
npm run test:ui
npm run test:cloud
npm run test:async
npm run test:auto
```

各套件在 `test-results` 创建自己的 Chrome 资料和模拟服务，不复用日常 Chrome，不需要真人密钥、Google 登录或 ChatGPT 额度。请保持此隔离。

`test:ui` 检查主要模块、主题、键盘、修订、备份、失败状态和窄屏；`test:cloud` 验证模拟 Drive 的线请求、合并、删除和重新生成；`test:async` 覆盖并发/排队、关闭页面及后台重启；`test:auto` 覆盖站点默认启用与停用恢复。

`test:live`、`test:e2e` 等真人服务脚本不在 CI 中运行。必须由本人明确进行登录和授权，不能为了复测撤销或重新索取已有授权。

## 公共配置与私密数据

`extension/public-key.json` 和 `extension/google-oauth.json` 为需要随应用分发的公开配置。扩展 ID 固定为 `hndhiknbifkbmpebjflifdecfpcliddd`，不要随意重新生成。

API Key、OAuth 凭据、`.local`、浏览器 profile、知识库备份和私人调研记录不得提交。`.gitignore` 对文档使用公开白名单，发布检查只扫描受控文件并检查引用。

## 第三方与界面

新依赖必须说明现有栈无法解决的需求。组件优先复用原生 HTML，图标用 Lucide，配色用 Radix，文字使用 14/16/20/44px。遵守 `AGENTS.md` 的数据、凭据、任务和阅读交互约束。

开发技能保存在 `.agents/skills`，来源与校验记录保留。依赖版本固定在 lockfile。更新 DevKit 必须重新核对许可、上游哈希、适配点和测试，不能只改版本号。

## 提交与发布

用工作分支和 PR，检查暂存差异，CI 通过后 squash 合并。标签发布见 [发布指南](releases.md)。
