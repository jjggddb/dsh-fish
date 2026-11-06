# 来源、二次开发与许可

本仓库基于 [ssamurias/dsh-fish](https://github.com/ssamurias/dsh-fish) 二次开发，继承其 MIT 许可代码。`LICENSE` 保留上游原始版权声明。

继承的核心包括事件校验与追加存储、经历派生、判断/引用修正与召回、日记、进程租约及锁、备份、输入与外发防护。微信群观察、来源归属、分群隔离、参与决策、定时回合与简化管理功能由本 fork 维护。

本仓库不再包含上游 B 站、工作区出门、请神、桌面通知和自更新功能，不再分发这些功能的界面素材；旧版本可通过 Git 历史追溯。

## 内置微信传输

`lib/wechat/transport.js`、`store.js` 和对应测试移植自 原项目 `jjggddb/dsh-wechat-native`，基于 0.3.0 的本地提交 `96ab9957c1caa2cf1e6deaa96fe83ba4171cb2bd`。MIT 许可保存在 [vendor/dsh-wechat-native/LICENSE](vendor/dsh-wechat-native/LICENSE)。Fish 自行管理其配置与生命周期，不再依赖独立插件服务。

## agent-wechat HTTP SDK

来源：[thisnick/agent-wechat](https://github.com/thisnick/agent-wechat)，v1.5.1，提交 `39af1eec84f4763e1257406f8c5fb848b31d82e9`。

`vendor/agent-wechat/` 的三个 TypeScript 文件原样取自该版本 `packages/shared/src/`，MIT 许可与版权声明保存在同目录 `LICENSE`；`SOURCE.json` 保存源码 SHA-256。`scripts/build-sdk.mjs` 校验哈希、去除类型并将相对导入改为 `.js`，生成 `lib/wechat/sdk/`。本 fork 不宣称这些协议客户端代码为原创。

DeepSeek Harness 与 agent-wechat Native 发布物仍由各自项目许可约束。本仓库不复制 Native 二进制或微信协议实现，也不附带账号及登录态。
