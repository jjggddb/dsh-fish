# 大肥鱼 · 微信群版

基于 [ssamurias/dsh-fish](https://github.com/ssamurias/dsh-fish) 二次开发。大肥鱼在微信群里旁听、记忆和回复。各群共享同一个人格起点，具体经历和会话按账号与群隔离。

**DSH 只需安装 Fish 一个业务插件。** 微信群消息经 [agent-wechat Native](https://github.com/thisnick/agent-wechat) 的 HTTP/SSE 接口进入 Fish。Fish 合并同群消息，附上人格与记忆，交给 [DSH Agent](https://github.com/deepseek-ai/deepseek-harness) 推理。DSH 按授权执行工具；回合成功完成且 Agent 选择回复时，Fish 通过 Native 发回原群。

## 安装

线上使用 Node.js ≥ 22.19、DSH `0.2.1-rc.5` 和 Native `1.5.1`。先启动 Native、登录微信并取得账号、机器人和目标群的准确 ID，再安装 Fish。

```sh
dsh plugin --profile my-profile add git+https://github.com/jjggddb/dsh-fish.git#wechat-deployment
```

在 DSH 宿主环境设置 `WECHAT_NATIVE_TOKEN`，在 profile 的 `cordis.patch.yml` 中配置已安装的 Fish 节点。将占位值替换为 Native 返回的 ID。

```yaml
- id: dsh-fish
  config:
    root: /data/fish
    wechat:
      enabled: true
      baseUrl: http://127.0.0.1:6174/
      accountId: YOUR_NATIVE_ACCOUNT_ID
      selfId: YOUR_BOT_WECHAT_ID
      groups:
        - id: '123456@chatroom'
      dataDir: /data/wechat-transport
      sending: false
```

重载 profile，打开「大肥鱼 → 微信」。未登录时可扫码登录。微信群和私聊联系人都可逐条添加、检测或删除，勾选「允许发送回复」后保存即可生效。首次使用 profile 中的名单，此后以面板保存的设置为准。跨容器连接 Native 时使用 HTTPS。

## 工具与记忆

在「DSH 工具授权」中勾选宿主已注册的工具，保存并重启 DSH Host 生效。默认授权 `web_search` 和 `web_fetch`。如需定时主动发言，在「微信」页同时开启定时观察和定时发送。

`root` 保存人格、记忆和群会话，`dataDir` 保存微信消息队列、游标和发送记录。两者都应使用持久目录。

**从双插件升级**时，先停服，备份上述两个目录。将旧 `dsh-wechat-native` 的配置移到 Fish 的 `config.wechat`，移除旧插件及 `config.nativeChannel`，沿用原来的 `root` 和 `dataDir` 后重启。旧插件默认传输目录是 `$DSH_HOME/storages/dsh-wechat-native`，迁移时请显式填写其绝对路径。

开发检查运行 `node --test`。项目采用 [MIT 许可](LICENSE)，SDK 来源见[第三方声明](THIRD-PARTY-NOTICES.md)。
