# 安全政策

## 报告漏洞

请使用仓库的 [Private vulnerability reporting](https://github.com/Foolish-Han/ContextReader/security/advisories/new)。如该入口不可用，请先发一个不含细节的 Issue 请求私下联系，不在公开 Issue 中发布可利用步骤或凭据。

附上受影响版本、运行环境、最小复现和影响范围。密钥、OAuth 凭据、Cookie、授权码、真实知识库和私人原文都应移除。项目由个人维护，不承诺固定响应时限。

## 支持范围

优先修复最新发行版及 `main` 上确认的安全问题。旧版请先升级并复核，不把本机浏览器、Google 或模型服务的权限绕过作为功能。

## 关键边界

- 解释需要读取明确选区及有限上下文；模型调用由用户动作触发。
- 内容脚本不能读取受保护的扩展密钥存储。凭据不进入 DOM、知识库导出或 Drive 快照。
- ChatGPT 凭据以 AES-GCM 密文保存在扩展 Origin 的独立 IndexedDB，密钥为不可导出的 Web Crypto CryptoKey；明文只在后台内存中。该数据库不参与知识库导出或 Google 同步。非导出密钥不等于操作系统钥匙串，无法保护已被控制的浏览器资料或可信扩展上下文。
- OAuth 回调只接受本次登录标签页的顶层导航，校验完整回环地址、state、PKCE、nonce、签名和账号，不启动本机认证服务。
- Google 仅请求 `drive.appdata`；切换账号不允许静默把旧账号资料上传到新账号。
- 自动重试不能把已发出但结果未确认的任务当作未发送请求重放。
- 公开 Client ID 和扩展公钥需要随应用分发；它们不代替用户授权。

更多见 [数据与权限](docs/privacy.md)。
