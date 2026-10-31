# 贡献指南

## 反馈问题

用 [Bug 模板](https://github.com/Foolish-Han/ContextReader/issues/new?template=bug_report.yml) 提供版本、Chrome/系统版本、复现步骤、预期与实际结果。模型相关问题注明连接方式和模型名称，不提供密钥、Cookie、授权码、完整日志或私人文章。

功能建议先说明具体阅读阻塞及现有做法。新模型、账号体系、复习功能或数据结构变动先讨论行为边界，避免为一个 UI 需求引入整套框架。

安全问题按 [SECURITY.md](SECURITY.md) 私下报告。

## 本地准备

见 [开发指南](docs/development.md)。CI 在 Linux、macOS、Windows 运行相同检查；本机浏览器回归使用当前平台的 Playwright Chromium，Node.js 22+，依赖以 `npm ci` 和 lockfile 为准。`dist` 不入库；构建后加载根目录的 `dist`。

## 分支与提交

1. 从最新 `main` 创建 `feat/`、`fix/` 或 `docs/` 分支。
2. 尽量让一次 PR 对应一个可解释的行为变化。提交前检查 `git diff` 与 `git diff --cached`。
3. 使用说明目的的提交标题，如 `fix: preserve edited definitions on regeneration`。
4. PR 写清问题、最终行为、验证及限制。UI 变化附浅深主题和窄屏截图；不要上传真人账户或知识库。
5. 等构建、单测与浏览器回归通过，解决讨论后再合并。默认 squash merge，合并后自动清理工作分支。

## 验证要求

```sh
npm run build
npm test
npm run test:auth
npm run verify:repo
```

阅读、设置、存储、任务或同步行为变化，还应跑相应浏览器套件：`test:ui`、`test:cloud`、`test:async`、`test:auto`、`test:oauth`。CI 五套全跑，不使用真实 LLM 或 Google 授权。

`test:live` 等真人服务脚本不能放入 CI，也不能因为重复测试而撤销已有会话。

## 许可

项目自有代码按 [MIT](LICENSE) 接受贡献。第三方代码及派生修改遵守其自身许可，尤其是 [DevKit 非商业许可](vendor/siwc-local/LICENSE)。不要把第三方源码或生成的适配运行时重新标为 MIT；修改该适配时更新变更说明与[第三方说明](THIRD_PARTY_NOTICES.md)。
