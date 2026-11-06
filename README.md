# 大肥鱼 · 微信群版

基于 [ssamurias/dsh-fish](https://github.com/ssamurias/dsh-fish) 二次开发。大肥鱼在微信里聊天，也会逛小红书、收藏图片，或把过几天想起来的图分享给熟人。各群共享同一个人格起点，具体经历和会话按账号与群隔离。

**DSH 只需安装 Fish 一个业务插件。** 微信群消息经 [agent-wechat Native](https://github.com/thisnick/agent-wechat) 的 HTTP/SSE 接口进入 Fish。Fish 合并同群消息，附上人格与记忆，交给 [DSH Agent](https://github.com/deepseek-ai/deepseek-harness) 推理。DSH 按授权执行工具；回合成功完成且 Agent 选择回复时，Fish 通过 Native 发回原群。

## 安装

线上使用 Node.js ≥ 22.19、DSH `0.2.1-rc.5` 和 Native `1.5.1`。先启动 Native，取得账号和机器人身份，再安装 Fish。

```sh
dsh plugin --profile my-profile add git+https://github.com/jjggddb/dsh-fish.git#wechat-deployment
```

在 DSH 宿主环境设置 `WECHAT_NATIVE_TOKEN`，在 profile 的 `cordis.patch.yml` 中配置已安装的 Fish 节点。填入 Native 的账号和机器人身份；会话名单随后在设置页按名称添加。

```yaml
- id: dsh-fish
  config:
    root: /data/fish
    wechat:
      enabled: true
      baseUrl: http://127.0.0.1:6174/
      accountId: YOUR_NATIVE_ACCOUNT_ID
      selfId: YOUR_BOT_WECHAT_ID
      groups: []
      dataDir: /data/wechat-transport
      sending: false
```

重载 profile，打开「大肥鱼 → 微信」。未登录时可扫码登录。输入微信群名称、联系人昵称或备注，点「检测」并保存；同名需选择，名单可逐条增删，勾选「允许发送回复」后保存即可生效。首次使用 profile 中的名单，此后以面板保存的设置为准。跨容器连接 Native 时使用 HTTPS。

有新消息才观察。私聊、@、明确点名、引用和正在接鱼话的群友优先。普通群聊按消息间隔合并（默认 1.5–6 秒），每条新消息只进入一次上下文。鱼可以记住一件事而不开口；鱼已决定回复后，普通群消息排入下一轮。同一发言人明确纠正或取消时，会结合原问题和未发送的草稿重新判断。免打扰默认关闭，可在微信页显式开启。

## 鱼的图库

Fish 可以为看过的图写备注、收藏、重看、改名或删除。它可以今天在小红书看到有趣的图，记下「打瞌睡的海豹，二哥会喜欢」，几天后在群里聊到海豹时按备注找到原图，核实二哥在这个群，再决定是否配一句话、@ 他并发图。收藏和长期记忆各自独立。群里没人说话时，收藏本身不会触发发言。

「大肥鱼 → 图库」可查看图片、来源和鱼的备注。图库支持 PNG、JPEG、GIF、WebP，每张最多 10 MiB。决定收藏、改备注和删除的是鱼。升级会将原 `root/stickers` 移至 `root/gallery`，保留原文件、标识、备注及启停状态。微信来源的收藏默认仅原会话可见；鱼明确选为跨会话素材时，可在同一微信账号的其他授权会话及关联的小红书账号使用。图库按原格式保存，微信和图文发帖需要时转换为静态图片。

## 群提醒

在「插件 → DSH 工具授权」勾选 `wechat_reminder` 并重载 Fish。群友可以说「大肥鱼，十分钟后提醒我喝水」「把我的提醒改到下午三点」「查看我的提醒」或「取消提醒 #2」。每条提醒只属于发起人和原群。Fish 创建成功后会回报编号和当地时间，DSH 到点后由 Fish 在原群 @ 本人。断线或免打扰期间暂缓投递，恢复后按同一编号补发。

## 图片与人格关系

微信原图和引用图使用当前消息窗口的短编号读取。本地图片用已授权的 DSH `read_image` 读取，鱼可凭本轮编号收藏。`wechat_send_image` 通过本轮编号暂存图片，`fish_decide` 确认回复后才向原会话投递。也可用 `fish_gallery` 查找已有收藏，再用 `fish_decide` 选图。

在「成长 → 人格关系」按微信昵称或备注检测联系人，填写你希望鱼使用的称呼。Fish 把称呼作为起始备注，也可以在聊天中给每个人写自己的短备注。例如爸爸说「艾特一下你二哥」，鱼能从本群联系人备注中认出二哥，核实成员后在微信里真正 @ 他。备注保存在 Fish 内，微信通讯录由你管理。

## 小红书活动

Fish 自己选择浏览首页、搜索、打开群友分享的笔记或休息。图文可按序号看原图，视频可选时间点看画面、有原字幕时可读字幕。主人在评论区点名时，Fish 优先核实通知、账号、原帖和评论。管理员在「大肥鱼 → 小红书」设置 **可看的类型、屏蔽关键词和每日最多浏览分钟数**。留空表示不限，填 0 暂停浏览。微信内打开小红书与自主浏览共用时长，按微信设置的时区结算。鱼自行决定是否收藏、写记忆、评论、分享或发帖。

**接入步骤**

1. 为鱼的专用账号启动并登录独立的 [xiaohongshu-mcp 服务](https://github.com/xpzouying/xiaohongshu-mcp)。Fish 通过随仓的 [媒体网关](tools/xhs-gateway.mjs) 访问服务。网关运行在后端同一网络命名空间，使用 `AUTH_TOKEN` 调用本机后端。将网关和后端的同一临时目录挂到 `/fish-media-exchange`，后端只需读权限。网关在 `/run/xhs-read/reader.sock` 监听，由 Fish 所在容器的私有回环代理转发。DSH 宿主安装 FFmpeg，使用支持图像输入的模型和附件服务。部署时可参考[示例](docs/xhs-gateway.md)。
2. 在小红书设置填服务地址、鱼和主人的主页 ID，启用活动。已有部署沿用 profile 的 `config.xhs`，在设置页保存后使用 `root/xhs-settings.json`。宿主凭据 `FISH_XHS_TOKEN` 仅可发往 profile 绑定的服务地址。
3. 在「插件 → DSH 工具授权」勾选 `xhs_read`、`xhs_comment`、`xhs_share` 和 `xhs_publish`，保存并重启宿主。Fish 从已读原帖评论，从图库选图发布图文，并从当时可达的授权微信群或私聊里选择分享对象。发布文件走内部临时目录，无需公开图片 URL。

外发在对应回合成功后执行。发送前复核账号、目标、授权、素材和免打扰状态，结果不明的操作保留记录，避免重复发布。群聊、私聊及小红书的具体记忆按来源隔离。迁移部署时停服备份 `root`（含图库、小红书通知和用时记录）与微信 `dataDir`。

## 工具与记忆

在「DSH 工具授权」中勾选宿主已注册的工具，保存并重启 DSH Host 生效。默认授权 `web_search` 和 `web_fetch`。

`root` 保存人格、记忆和群会话，`dataDir` 保存微信消息队列、游标和发送记录。两者都应使用持久目录。

**从双插件升级**时，先停服，备份上述两个目录。将旧 `dsh-wechat-native` 的配置移到 Fish 的 `config.wechat`，移除旧插件及 `config.nativeChannel`，沿用原来的 `root` 和 `dataDir` 后重启。旧插件默认传输目录是 `$DSH_HOME/storages/dsh-wechat-native`，迁移时请显式填写其绝对路径。

开发检查运行 `node --test`。项目采用 [MIT 许可](LICENSE)，SDK 来源见[第三方声明](THIRD-PARTY-NOTICES.md)。
