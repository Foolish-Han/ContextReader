# Google Drive 接入与发布者配置

## 普通用户

在设置点击“连接 Google Drive”，本人登录并允许访问应用数据。连接后新增、修订、删除自动提交，Chrome 运行时每分钟检查云端，启动时恢复检查。“立即同步”只是提前检查一次。

应用包已经包含公开的 OAuth Client ID。普通用户不需要建立 Cloud 项目或运行配置脚本。使用同一扩展应用、同一 Google 账号可以合并知识；真实两设备恢复仍需按路线图单独验收。

## 应用配置

本项目 Google 客户端类型为 Chrome 扩展，绑定稳定扩展 ID `hndhiknbifkbmpebjflifdecfpcliddd`。Google Client ID 与扩展公钥都是需要随应用分发的公开标识，不是用户凭据。

- `extension/google-oauth.json` 保存公开 Client ID，构建时写入 manifest。
- 只申请 `https://www.googleapis.com/auth/drive.appdata`，用 Chrome Identity API 获取本人授权。
- 不使用 Client Secret。不要把个人访问令牌、Cookie 或知识库文件放入仓库。
- 测试与正式受众在 Google Cloud Console 管理；Testing 中的其他账号可能需要加入测试用户。当前登录成功不证明所有 Google 账号都能连接。

## 维护者更换配置

1. 在 Google Cloud 项目启用 Drive API，配置同意屏幕、受众和测试用户。
2. 创建 Chrome 扩展类型 OAuth Client，核对应用 ID。
3. 本地运行 `configure-google.cmd`，填写公开 Client ID；或直接更新 `extension/google-oauth.json`。
4. 重新构建，重新加载扩展并刷新设置页。连接诊断应显示当前版本、扩展 ID 和 Client ID，再本人测试连接。
5. 发布前通过 `verify:repo` 与打包检查。不能发布 manifest 与配置不一致的构建。

配置脚本会核对扩展公钥，并识别 Chrome 已加载的同 ID 解压副本；不会改 Chrome 偏好文件、Cookie 或凭据。日常开发应直接加载仓库根目录的 `dist`。

## 数据与恢复

每个设备写独立快照，合并字段版本与删除标记。人工修订保留，旧离线快照不会复活删除项。上传成功后才确认本机水位，上传期间的新改动继续待同步。

断开同步保留本机知识。授权失效或账号不一致时暂停，用户明确处理；不会静默向新账号上传旧资料。API Key、ChatGPT 凭据、任务、网站开关和外观均不上传。

## 参考

- [Chrome OAuth 集成](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Google 应用受众](https://support.google.com/cloud/answer/15549945)
- [Drive 应用数据目录](https://developers.google.com/workspace/drive/api/guides/appdata)
