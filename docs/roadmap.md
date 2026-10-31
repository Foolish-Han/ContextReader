# 路线图

当前基线：0.7.1。下面区分已实现与待验证，不承诺未经验证的时间表。

## 已交付

- [x] 默认启用、按网站停用、选区解释与已知表达标记。
- [x] 基础含义、本处语境、可选深学、历史积累和人工修订。
- [x] 异步队列、并发控制、取消/明确重试和中断恢复。
- [x] API Key 与独立 ChatGPT 登录路径。
- [x] Drive 自动同步、离线缓存、合并与删除标记。
- [x] 英美 IPA、重新生成、浅深主题、响应式工作台。
- [x] 公开源码、项目说明、CI、贡献与发布流程。

## 下一阶段：试用验证

### 真实跨设备同步 [#3](https://github.com/Foolish-Han/ContextReader/issues/3)

用两个实际 Chrome 设备、同一个 Google 账号，验证新增、修改、删除、离线编辑和恢复。记录版本、账号授权步骤和可重复结果，不能用模拟服务代替此项。

### 公开安装与 Google 受众 [#4](https://github.com/Foolish-Han/ContextReader/issues/4)

确认 OAuth Testing/Production、允许的扩展 ID 与其他账号可用性，整理发布者清单。评估 Chrome Web Store 所需材料、权限说明和 ID 迁移。当前没有上架声明。

### 浏览器内 ChatGPT 授权 [#5](https://github.com/Foolish-Han/ContextReader/issues/5)

已移除平台认证助手与启动脚本，使用浏览器内回调及加密持久凭据。重启恢复和过期刷新通过实际 Chrome / 合成服务回归。完成真实 Chrome 与合成 OAuth 服务回归后，由本人手动验证真实 OpenAI 注册、订阅授权、重登录、模型目录与解释。模拟验证不代表真人服务验收。

## 不默认扩展的范围

不会因为存在知识库就自动加入知识图谱、向量检索、全页模型扫描、强制复习或新的商业账号体系。新需求先证明阅读阻塞、成本和实际收益。

任务状态见[工作看板](https://github.com/users/Foolish-Han/projects/1/views/2)，问题和验收以 [GitHub Issues](https://github.com/Foolish-Han/ContextReader/issues) 为准。
