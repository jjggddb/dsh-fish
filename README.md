# 大肥鱼 · 微信群版

基于 [ssamurias/dsh-fish](https://github.com/ssamurias/dsh-fish) 的二次开发，面向微信群里的长期陪伴与自然参与。本仓库保留上游的核心思路：**事件只追加，通过真实经历、回忆和修正形成持续变化的人格**。这不是训练或微调模型权重。

这是独立 fork，由 [jjggddb/dsh-fish](https://github.com/jjggddb/dsh-fish) 维护；不代表上游、DeepSeek、腾讯或 agent-wechat 官方项目。

## 本版范围

- 人格起点保存在 `seed` 事件中，已有起点不会被更新覆盖。`growth_commit` 自主记忆，`revise` 引用旧记录修正判断，`her_recall` 检索过去。
- 普通群消息与 @ 消息都进入观察队列；默认约 1.2 秒合并一个窗口，最多 16 条。同一个群串行，不同群可独立处理。
- Agent 可以旁听、只记忆或发言。`fish_decide` 明确选择 `silent` / `reply`，只有关联的 DSH 回合成功完成后，发送选择中的文字；推理文本和普通最终输出不会直接发群。
- 每群独立会话、近期上下文、日记和便条；共享同一份人格起点和事件存储。具体经历按账号及群隔离，人物使用稳定 ID，昵称仅供显示。
- 群会话默认 40 轮续接，保留旧会话，携带当前群最近 6 轮的有限原话。失败或超时的回合不会发送，并在下一轮换新会话。
- 定时主动观察不依赖 `.dev`，不掷随机骰子。需要 Fish 与 Native 两侧显式开启；代码只设置资源与发送上限，Agent 决定是否开口。
- 保留已有 PNG/JPEG 收发、引用图片读取和真正的群成员 @ 能力。图片读取要求 DSH 当前模型支持图像。
- 管理面板展示连接、观察/发送状态和近期记忆，支持配置参与节奏和导出备份。

本版已删除 B 站浏览/登录/评论/视频、出门工作、请神、纪念品、桌面通知、插件内自行下载安装更新，以及单主人冷落剧情、固定阶段的表达限制和对应界面。历史事件类型仍兼容读取。小红书、表情库、语音不在本版范围内。

## DSH → Native → Fish 完整链路

三个项目各司其职，实际数据流是：

```text
微信群
  │ 消息、成员资料、媒体
  ▼
agent-wechat Native（上游 Rust 服务）
  │ HTTP API + SSE 实时事件
  ▼
dsh-wechat-native（DSH 内的 JavaScript / Cordis 插件）
  │ 校验账号与精确群 ID，持久 inbox，重连游标
  ▼
dsh-fish（本仓库，运行在同一个 DSH Host 内）
  │ 合并观察窗口 → 当前群会话 → 经历派生人格 / 有范围的记忆
  ▼
DSH Agent + 模型
  │ growth_commit / her_recall / her_note / fish_decide
  ▼
Fish 检查回合完成、静默时段、发送额度与外发内容
  │ 绑定已接收消息，或宿主签发的定时回合能力
  ▼
dsh-wechat-native → Native HTTP → 微信群
```

| 层 | 职责 | 不负责 |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 模型调用、Agent 会话、工具执行、附件、Web 管理与认证 | 微信协议 |
| [agent-wechat](https://github.com/thisnick/agent-wechat) Native | 微信登录、消息与成员、媒体、发送回执 | 人格与发言选择 |
| [dsh-wechat-native](https://github.com/jjggddb/dsh-wechat-native) | SSE 游标、持久消息队列、精确目标校验、幂等发送 | 随机插话、记忆筛选、模型编排 |
| 本仓库 | 经历驱动人格、观察、记忆、分群上下文、参与决策 | 微信登录、任意工作区操作 |

**无需另加 WebSocket、Python 适配器或另一条桥接 Agent。** Native 的 SSE 已提供实时事件；所有群会话由同一个 DSH Host 内的 Fish 管理。

## 安装与连接

集成基线：Node.js ≥ 22.19、DSH `0.2.1-rc.5`、Native `1.5.1`、`dsh-wechat-native` ≥ `0.3.0`。本轮 fork 的自动化验证不代替目标机器上 DSH/微信客户端的集成验收。

1. 按 DSH 与 Native 各自项目说明准备服务。Native 只暴露给同一受控环境内的 DSH，并启用 API token。通过 Native 的实际账号、群成员查询取得精确 ID，不按模糊群名选择目标。
2. 在同一个 DSH profile 安装两个 JavaScript 插件：

   ```sh
   dsh plugin --profile my-profile add git+https://github.com/jjggddb/dsh-wechat-native.git
   dsh plugin --profile my-profile add git+https://github.com/jjggddb/dsh-fish.git#wechat-deployment
   ```

   本 fork 目前位于 `wechat-deployment` 分支，安装时须带分支后缀，不能省略成上游同步的 main。正式部署应使用自己验证过的完整提交 SHA 固定 Git 来源。插件不会在运行时自行更新代码。
3. 配置 profile 的 `cordis.patch.yml`，并通过宿主环境提供 `WECHAT_NATIVE_TOKEN`。以下全部为占位示例，必须替换为自己的真实查询结果：

   ```yaml
   - insert:
       - id: dsh-wechat-native
         name: dsh-wechat-native
         config:
           enabled: true
           baseUrl: http://127.0.0.1:6174/
           tokenEnv: WECHAT_NATIVE_TOKEN
           accountId: YOUR_NATIVE_ACCOUNT_ID
           selfId: YOUR_BOT_WECHAT_ID
           groups:
             - id: '123456@chatroom'
               name: '你的测试群'
           dataDir: /data/wechat-transport
           sending: false
           scheduledSending: false
       - id: dsh-fish
         name: dsh-fish
         config:
           root: /data/fish
           nativeChannel:
             enabled: true
   ```

   若安装命令已生成对应插件节点，修改现有节点，勿重复插入。`root` 与 `dataDir` 应为持久目录，彼此独立。DSH 与 Native 分容器部署时，`127.0.0.1` 要换成受控服务地址，不能把 Native API 公开到互联网。
4. 重载 profile，确认管理面板的连接和账号/精确目标群，再在 Native 插件配置中启用 `sending: true`。没有发送开关的授权，观察也不会产生外发。
5. 如需定时主动参与，同时设置 Native 的 `scheduledSending: true` 与 Fish 配置 `proactive.enabled: true`。定时器只遍历 Native 已授权群；Agent 不接收任意目标群参数。

DSH 需要可用的 `workspaceRegistry`、`sessionController`、`agents`、`tools`、`systemPrompt`、`webServer`、`connection` 服务；图片读取还需要 `attachments` 和支持图像的模型。`web_search` / `web_fetch` 由宿主提供，可从 Fish 的工具配置中移除。

## 环境参数

Fish 在数据目录读取 `config.json`，未设置的项自动补默认值。可以从 DSH 已认证的 `/dsh-fish/config` GET/POST 读取/更新，或停服后编辑文件；未知的旧功能配置不再生效。

```json
{
  "group": {
    "batchMs": 1200,
    "maxBatch": 16,
    "maxTurnsPerHour": 60,
    "maxRepliesPerMinute": 3,
    "quietHours": [0, 8],
    "timezone": "Asia/Shanghai"
  },
  "proactive": {
    "enabled": false,
    "intervalMinutes": 120,
    "maxPerDay": 2,
    "minIdleMinutes": 30
  },
  "chat": {"rotateAfter": 40, "replyChars": 1500},
  "memory": {"docBudget": 8000, "beliefsShown": 8},
  "diary": {"enabled": true, "visible": false},
  "tools": {"allow": ["web_search", "web_fetch"]}
}
```

- 上限均按群计算。定时额度限制的是**观察次数**，包含选择沉默或失败的回合；不保证每天一定发言。
- 静默时段和额度限制会跳过当前观察窗口并记录原因；不积攒延迟回复。Native 仍保存已接收消息，近期消息工具可以在后续合法回合查看。
- 每分钟检查一次定时机会。进程重启不补发错过的时段，已预留的观察次数持久保存，避免重启重复触发。
- 批量窗口、工具名单需要重启 DSH Host 生效；静默时段、额度、记忆与轮换参数在后续回合读取。
- 不提供人格滑条、好感度数字或直接覆盖 seed 的编辑器。人格文档优先保留完整 seed，特别长的历史 seed 可能超过文档预算。

## 记忆与升级

`events.jsonl` 是唯一的长期经历来源，只能追加。新事件在原 v1 信封上增加可选的 `scene / accountId / groupId / personId / messageId / turnId`，没有改写旧字段语义，不需要重写旧事件。

- **已有 seed 和事件不会重置或重新播种。** `deriveSelf`、引用修正、显著性排序和冲突检测继续用于人格生成。
- 旧事件若带有可确认的 DSH 群会话 ID，会在读取时归属到该群；轮换保留旧会话 ID 映射。这个归属只在内存中做，不修改原始日志。
- 无法确认来源的旧记录保留在备份和管理员记忆视图中，不猜测属于哪个群，也不跨群向 Agent 暴露。
- 新日记和便条按账号及群保存到 `groups/<scope-hash>/`。旧的私人日记、便条原样保留，不自动共享进群。
- `channels.json` 记录会话及轮次；`talk-recent.json` 保存各群续接片段；`group-state.json` 保存限额与最多 80 条运行摘要。这些与人格事件分离。
- 使用管理面板导出私有备份；恢复工具会先封存旧目录。恢复只能停服后由管理员执行，不给 Agent 开放。备份包含私人记忆，不能提交到仓库。

升级前备份数据及当前提交 SHA；升级两个插件时保留原数据卷。回滚代码不能恢复已丢失的会话/限额元数据，务必同时留备份。旧发布历史在 Git 中可查。

## 权限与可靠性

Fish 的同一份工具名单同时约束展示和执行；shell、通用文件读写、任意工作区、子代理、技能执行均不开放。网页文本、群消息、昵称及引用统一经 `guard.js` 清洗并标为外部资料；这不能把任意第三方内容变成可信指令，仍需部署边界配合。

- 容器不挂宿主目录、Docker socket 或其他项目的数据卷；业务进程使用非 root 用户，按部署环境阻断宿主、私网及云元数据访问，仅保留确实需要的服务出口。
- Native API token 和模型凭据只留在私有配置或环境中。Web 管理必须保留 DSH 的认证；认证服务缺失时 API 拒绝访问。
- 发送绑定精确账号和群。主动发送使用宿主签发、限时有效的回合能力及持久幂等键；不接受模型自行指定群地址。
- Native `accepted` 表示服务接受发送，并不等于手机已阅读。发送结果不明时检查原幂等键，不盲目换键重发。
- 传输 inbox 的处理中任务在重启后标为 `interrupted`，不自动重放以免重复发言；pending 消息仍受时效限制。
- 插件工具权限不是操作系统沙箱。网络隔离、进程用户和卷挂载由部署负责，不由此 JavaScript 插件提升或放宽。

## 开发

```sh
node --test
```

保持零 npm 依赖。保留核心事件、派生、存储、日记、锁和安全检查的测试；删除只针对已移除上游功能的测试，并补充分群隔离、旁听记忆、批处理、会话续接、失败不发送、定时限额等回归测试。Native 插件在它自己的仓库运行测试。

公开仓库只保存源码、测试和通用示例。真实服务器、账号、群 ID、登录信息、模型 key、用户提供的人设原文与运行备份均不入库。

## 来源与许可

核心代码派生自 [ssamurias/dsh-fish](https://github.com/ssamurias/dsh-fish)，保留 MIT 许可与原版权声明；二次开发说明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。Native/DSH 的代码及发布物由各自仓库许可约束，本仓库不附带微信账号、登录态或 Native 二进制。
