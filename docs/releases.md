# 发布与维护

## 日常管理

`main` 保持可构建。功能与修复用分支和 PR，CI 通过后 squash 合并。Issue 使用 Bug/功能模板；安全问题走私有漏洞报告。依赖由 Dependabot 定期发 PR，不自动合并未经验证的更新。

维护者在 Issues 中维护优先级、类型与范围，路线图记录验收条件。新功能不先承诺日期；完成后更新 CHANGELOG。

## 发布步骤

1. 更新 `package.json` 和 lockfile 的同一个版本，以及 `CHANGELOG.md`。
2. 在任一支持 Node.js 的系统从干净检出执行：

   ```sh
   npm ci
   npm run build
   npm test
   npm run test:auth
   npm run verify:repo
   npm run test:ui
   npm run test:cloud
   npm run test:async
   npm run test:auto
   npm run test:oauth
   ```

3. 合并并确认 main 的 CI 为绿色。对该提交创建 `vX.Y.Z` 标签并推送。
4. `release.yml` 会重新调用 CI，核对标签与版本，构建发行包和 SHA-256，并发布 GitHub Release。
5. 检查 Release 的 tag、提交、ZIP 内容、校验值与下载结果。安装说明应让普通用户选择 `dist`，而不是配置开发者 OAuth 项目。

## 本地打包

```sh
npm run package
```

打包只从 Git 受控且未修改的源文件与生成的根目录 `dist`收录资料。私人文档、旧截图、测试 profiles、浏览器二进制、日志、密钥和旧 ZIP 不会因为存在于工作目录就被复制进发行包。

产物在忽略的 `release/` 下：`context-reader-X.Y.Z.zip` 与 `.sha256`。包含第三方完整许可及安装说明。ZIP 使用 Node 与 fflate 生成，不依赖 PowerShell 或系统 ZIP 程序。公开 Client ID 和扩展公钥必须与构建一致；变更固定扩展 ID 需要单独迁移设计。

发布权限仅在标签发布 job 中授予 `contents: write`。普通 CI 只读，不使用真人 API Key、OAuth 登录或 Google 授权。

## 版本与限制

遵循 SemVer。修复或发行工程改动使用 patch；行为新增使用 minor；不兼容数据或接口变更先设计迁移再升 major。发行说明区分模拟服务、真实服务和待验证的跨设备行为。

完整发行包包含非商业 DevKit，不能将根 MIT 许可扩张到该组件。见[第三方许可](../THIRD_PARTY_NOTICES.md)。
