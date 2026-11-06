# 大肥鱼 · 微信群版

基于 [ssamurias/dsh-fish](https://github.com/ssamurias/dsh-fish) 二次开发。大肥鱼在微信群里旁听、记忆和回复。各群共享同一个人格起点，具体经历和会话按账号与群隔离。

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

## 表情库

在「大肥鱼 → 表情库」上传 PNG 或 JPEG（每张最多 4 MiB，最多 100 张），并填写简短备注，例如“大笑”或“傲慢”。管理员可以修改备注、停用、重新启用或删除。图库保存在 Fish 的持久目录，供已授权的群聊和私聊共用。Agent 先判断是否回复，需要表情时才提供描述语气的短词，可单独回图或配文字。回合成功后，Fish 用短词在已启用图片的备注中匹配；没有匹配项就跳过图片。日常观察提示不附带图库清单。图片经 Native 以普通微信图片发送。

## 群提醒

在「插件 → DSH 工具授权」勾选 `wechat_reminder` 并重载 Fish。群友可以说「大肥鱼，十分钟后提醒我喝水」「把我的提醒改到下午三点」「查看我的提醒」或「取消提醒 #2」。每条提醒只属于发起人和原群。Fish 创建成功后会回报编号和当地时间，DSH 到点后由 Fish 在原群 @ 本人。断线或免打扰期间暂缓投递，恢复后按同一编号补发。

## 图片与人格关系

微信原图和引用图使用当前消息窗口的短编号读取。本地图片用已授权的 DSH `read_image` 读取，`wechat_send_image` 通过本轮编号暂存图片，`fish_decide` 确认回复后才向原会话投递。在「表情库」管理 PNG/JPEG 和备注，鱼可从已启用的表情中选图回复。

在「成长 → 人格关系」输入微信昵称或备注，点「检测」，遇到同名联系人时从候选中选择。检测通过后填写称呼并绑定，可逐人修改或解除。例如「老爸」对应父亲，「老妈」对应母亲；自定义称呼按原样使用。鱼在群聊和已授权私聊中按实际发件人识别关系。

## 小红书只读活动

Fish 可以自己选择看首页、搜索、打开笔记或休息。主人在评论区真实 @ 鱼时，Fish 优先打开原帖，根据平台通知里的作者 ID、笔记 ID 和评论 ID 定位你的评论。读取范围是笔记可用的标题与正文；私信、公开回复、发布和视频理解留待后续版本。

部分真实 @ 会被平台归入普通评论通知。对于这类通知，Fish 只处理来自主人 ID、开头点名当前登录鱼昵称的评论，还会在原帖详情中核对评论 ID、作者和点名文字。详情未返回目标评论时保留待核对。平台只提供纯文本时，Fish 无法区分手输同名和从 @ 候选中选中鱼。

1. 单独运行支持通知列表和登录用户 ID 的 [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) 服务，为它登录鱼的专用账号。Fish 调用同一服务的只读 HTTP API。服务启用 Bearer 鉴权时，把凭据放在 DSH 宿主的 `FISH_XHS_TOKEN` 环境变量。
2. 打开 DSH「设置 → 大肥鱼 → 小红书」，填写只读服务地址、鱼和主人的主页用户 ID、自主浏览间隔，再勾选启用并保存。两个 ID 取自各自的主页链接；非本机服务须使用 HTTPS。
3. 在同页查看 `xhs_read` 的授权状态。首次授权时，点「去工具授权」，勾选 `xhs_read`，保存并重启宿主。已有授权时，小红书设置保存即生效；保存本身不会发起浏览，关闭后停止轮询。

已有部署首次打开会沿用 profile 的 `config.xhs`。在面板保存后，Fish 使用持久目录内的 `xhs-settings.json`。Bearer 凭据继续由宿主管理，并绑定 profile 的 `config.xhs.baseUrl`（缺省为本机服务）。登录态由小红书服务管理。

默认每 15 分钟给 Fish 一次自主浏览机会，每两分钟检查最近可见的评论和 @ 通知并优先处理一条（可用活动时段遵循已开启的免打扰设置）。重启后继续处理已发现的待办。平台只返回当前可见的通知窗口；离线太久或通知已删除时无法保证补齐。工具调用与通知均无对外发送路径。

Fish 自己决定是否记忆。记忆追加到 `events.jsonl`，来源绑定本轮实际读到的笔记或评论；下一轮可用 `her_recall` 检索。小红书账号与微信群、微信私聊各自隔离。通知处理记录保存在 `root/xhs/` 下，迁移时停服备份该目录。

## 工具与记忆

在「DSH 工具授权」中勾选宿主已注册的工具，保存并重启 DSH Host 生效。默认授权 `web_search` 和 `web_fetch`。

`root` 保存人格、记忆和群会话，`dataDir` 保存微信消息队列、游标和发送记录。两者都应使用持久目录。

**从双插件升级**时，先停服，备份上述两个目录。将旧 `dsh-wechat-native` 的配置移到 Fish 的 `config.wechat`，移除旧插件及 `config.nativeChannel`，沿用原来的 `root` 和 `dataDir` 后重启。旧插件默认传输目录是 `$DSH_HOME/storages/dsh-wechat-native`，迁移时请显式填写其绝对路径。

开发检查运行 `node --test`。项目采用 [MIT 许可](LICENSE)，SDK 来源见[第三方声明](THIRD-PARTY-NOTICES.md)。
