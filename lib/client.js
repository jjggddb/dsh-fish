/** Compact host settings panel; all data remains behind DSH authentication. */
window.__ModuleLoader__.load({
  id: 'dsh-fish',
  factory: (require) => {
    const React = require('react'),
      { createElement: h, useState, useEffect } = React
    const API = new URL('./dsh-fish/', document.baseURI).pathname
    async function api(path, options) {
      const r = await fetch(API + path, options)
      const value = await r.json()
      if (!r.ok) throw Error(value.error || '读取或保存失败（' + r.status + '）')
      return value
    }
    function FishSection() {
      const [status, setStatus] = useState(null),
        [config, setConfig] = useState(null),
        [events, setEvents] = useState([]),
        [tools, setTools] = useState([]),
        [selectedTools, setSelectedTools] = useState([]),
        [saved, setSaved] = useState(''),
        [error, setError] = useState(''),
        [saving, setSaving] = useState(false)
      const refresh = async () => {
        try {
          const [s, c, e, t] = await Promise.all([api('status'), api('config'), api('events'), api('tools')])
          setStatus(s)
          setConfig(c)
          setEvents(e.events)
          setTools(t.tools)
          setSelectedTools(c.tools.allow)
          setError('')
        } catch (e) {
          setError(e.message)
        }
      }
      useEffect(() => {
        void refresh()
      }, [])
      const save = async (patch) => {
        setSaving(true)
        try {
          setConfig(
            await api('config', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(patch),
            }),
          )
          setError('')
          setSaved(patch.tools ? '工具授权已保存，重启 DSH Host 后生效。' : '已保存。')
        } catch (e) {
          setError(e.message)
        } finally {
          setSaving(false)
        }
      }
      const box = {
        padding: '16px',
        marginBottom: '16px',
        border: '1px solid var(--dsw-alias-border-primary, #8885)',
        borderRadius: '10px',
      }
      return h(
        'section',
        { 'aria-label': '大肥鱼' },
        h('h2', null, '大肥鱼 · 群聊与记忆'),
        h('p', null, '共享人格起点，分别记住每个群里发生的事。旁听、记忆和发言由大肥鱼自己选择。'),
        error ? h('p', { role: 'alert' }, error) : null,
        saved ? h('p', { role: 'status' }, saved) : null,
        h(
          'div',
          { style: box },
          h('strong', null, status?.writable ? '运行中' : '尚未就绪'),
          h(
            'p',
            null,
            'Native：' +
              (status?.transport?.connected ? '已连接' : '未连接') +
              ' · 发送：' +
              (status?.transport?.sending ? '已开启' : '已关闭'),
          ),
          h('button', { onClick: refresh }, '刷新状态'),
          status?.transport?.accountId ? h('p', null, '账号：' + status.transport.accountId) : null,
          status?.transport?.groups ? h('p', null, '授权群：' + status.transport.groups.map((g) => (g.name ? g.name + ' · ' : '') + g.id).join('；')) : null,
          h('p', null, '微信接入与发送开关在 Fish 的 wechat 部署配置中统一设置。'),
        ),
        config
          ? h(
              'div',
              { style: box },
              h('h3', null, '参与节奏'),
              h(
                'label',
                null,
                h('input', {
                  type: 'checkbox',
                  checked: config.proactive.enabled,
                  disabled: saving,
                  onChange: (e) => save({ proactive: { enabled: e.target.checked } }),
                }),
                '允许定时观察（是否发言仍由大肥鱼决定）',
              ),
              h(
                'p',
                null,
                '定时观察间隔：' +
                  config.proactive.intervalMinutes +
                  ' 分钟；每天最多 ' +
                  config.proactive.maxPerDay +
                  ' 次。',
              ),
              h(
                'p',
                null,
                '静默时段：' +
                  config.group.quietHours.join('—') +
                  ' 时（' +
                  config.group.timezone +
                  '）。',
              ),
              h(
                'p',
                null,
                '每群每小时最多观察 ' +
                  config.group.maxTurnsPerHour +
                  ' 轮，每分钟最多发送 ' +
                  config.group.maxRepliesPerMinute +
                  ' 条。',
              ),
              h(
                'p',
                null,
                '发送开关及授权群由部署配置管理；批量窗口及工具名单调整后重启 DSH Host 生效。',
              ),
            )
          : null,
        config ? h(
          'div',
          { style: box },
          h('h3', null, 'DSH 工具授权'),
          h('p', null, '选择大肥鱼可以使用的宿主工具。模型决定何时调用，由 DSH 执行；新增工具需先在 DSH 中加载。'),
          h('p', null, '授权会应用到大肥鱼的所有群会话。请只选择适合这些群使用的工具。'),
          ...tools.filter((t) => !t.core).map((tool) => h(
            'label',
            { key: tool.name, style: { display: 'block', marginBottom: '8px' }, title: tool.description },
            h('input', {
              type: 'checkbox',
              checked: selectedTools.includes(tool.name),
              disabled: saving,
              onChange: (e) => setSelectedTools((current) => e.target.checked
                ? [...new Set([...current, tool.name])]
                : current.filter((n) => n !== tool.name)),
            }),
            ' ' + tool.name,
            tool.description ? h('small', null, ' · ' + tool.description.slice(0, 140)) : null,
          )),
          ...selectedTools.filter((n) => !tools.some((t) => t.name === n)).map((name) => h(
            'p', { key: name },
            name + '（当前未注册，不可调用） ',
            h('button', { disabled: saving, onClick: () => setSelectedTools((s) => s.filter((n) => n !== name)) }, '移除'),
          )),
          h('p', null, '人格、记忆和当前群消息工具由 Fish 内置提供。工具授权变更在重启 DSH Host 后生效。'),
          h('button', { disabled: saving, onClick: () => save({ tools: { allow: selectedTools } }) }, saving ? '保存中…' : '保存工具授权'),
        ) : null,
        h(
          'div',
          { style: box },
          h('h3', null, '最近活动'),
          h(
            'ul',
            null,
            ...(status?.activity?.recent || [])
              .slice(-12)
              .reverse()
              .map((r, i) =>
                h(
                  'li',
                  { key: i },
                  new Date(r.at).toLocaleString() +
                    ' · ' +
                    r.groupId +
                    ' · ' +
                    ({
                      accepted: '已发送',
                      silent: '旁听',
                      quiet: '静默时段',
                      turn_budget: '观察额度已用完',
                      reply_budget: '发送额度已用完',
                      send_blocked: '本轮未发送',
                      failed: '回合失败',
                    }[r.status] || r.status),
                ),
              ),
          ),
        ),
        h(
          'div',
          { style: box },
          h('h3', null, '最近记忆'),
          h(
            'ul',
            null,
            ...events
              .slice(-12)
              .reverse()
              .map((e) =>
                h(
                  'li',
                  { key: e.id },
                  h('small', null, e.groupId || '早期或本地记忆'),
                  ' · ',
                  e.text,
                ),
              ),
          ),
        ),
        h('a', { href: API + 'backup', download: 'fish-backup.json' }, '导出备份'),
      )
    }
    return {
      inject: ['slots'],
      FishSection,
      apply(ctx) {
        ctx.effect(() =>
          ctx.slots.inject(
            'settings.section',
            () =>
              ctx.slots.register(
                { name: 'settings.section', id: 'fish', order: 7, label: () => '大肥鱼' },
                FishSection,
              ),
            'dsh-fish settings',
          ),
        )
      },
    }
  },
})
