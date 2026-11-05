/** Compact host settings panel; all data remains behind DSH authentication. */
window.__ModuleLoader__.load({
  id: 'dsh-fish',
  factory: (require) => {
    const React = require('react'),
      { createElement: h, useState, useEffect } = React
    const API = new URL('./dsh-fish/', document.baseURI).pathname
    async function api(path, options) {
      const r = await fetch(API + path, options)
      if (!r.ok) throw Error('读取或保存失败（' + r.status + '）')
      return r.json()
    }
    function FishSection() {
      const [status, setStatus] = useState(null),
        [config, setConfig] = useState(null),
        [events, setEvents] = useState([]),
        [error, setError] = useState(''),
        [saving, setSaving] = useState(false)
      const refresh = async () => {
        try {
          const [s, c, e] = await Promise.all([api('status'), api('config'), api('events')])
          setStatus(s)
          setConfig(c)
          setEvents(e.events)
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
