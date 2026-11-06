/** Fish settings in the original DSH settings-section layout. */
window.__ModuleLoader__.load({
  id: 'dsh-fish',
  factory: (require) => {
    const { createElement: h, useState, useEffect, useRef } = require('react')
    const API = new URL('./dsh-fish', document.baseURI).pathname.replace(/\/$/, '')
    const CSS_TAG = 'dsh-fish/section.css'
    const CSS = [
      '.dfish{color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}',
      '.dfish h2{margin:0;font-size:16px;font-weight:500;line-height:24px}',
      '.dfish .sub{color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:19px;margin:0}',
      '.dfish .card{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px}',
      '.dfish .card>h3{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase}',
      '.dfish .kv{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:13px;line-height:19px}',
      '.dfish .kv b{color:var(--dsw-alias-label-tertiary);font-weight:400}',
      '.dfish ul{margin:0;padding-left:17px;font-size:13px;line-height:20px}',
      '.dfish li{margin:3px 0}',
      '.dfish .tag{display:inline-block;padding:0 6px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-tertiary);margin-left:6px}',
      '.dfish .chips{display:flex;flex-wrap:wrap;gap:6px;margin:5px 0 0}',
      '.dfish .chip{background:transparent;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary));font-size:11.5px;height:22px;padding:0 9px;cursor:pointer;white-space:nowrap}',
      '.dfish .chip:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
      '.dfish .chip.on{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:rgba(128,128,128,.10)}',
      '.dfish .chip.her{cursor:default;opacity:.8}',
      '.dfish .chip.blk{border-style:dashed}',
      '.dfish .grouphd{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary);margin:11px 0 0}',
      '.dfish .famhd{display:flex;align-items:center;gap:6px;width:100%;height:24px;text-align:left;background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary));font-size:12px;line-height:18px;padding:0 4px;margin:3px 0 0;cursor:pointer}',
      '.dfish .famhd:hover:not(:disabled){background:rgba(128,128,128,.10);color:var(--dsw-alias-label-primary)}',
      '.dfish .famhd .famcaret{flex:none;width:9px;font-size:10px;opacity:.7}',
      '.dfish .famhd .famname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace}',
      '.dfish .famhd .famcnt{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.dfish .famhd.open .famname{color:var(--dsw-alias-label-primary)}',
      '.dfish .chipsnote{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary);background:rgba(128,128,128,.07);border-radius:6px;padding:6px 8px;margin:0 0 4px}',
      '.dfish pre{margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);font-family:ui-monospace,Consolas,monospace}',
      '.dfish .empty{color:var(--dsw-alias-label-tertiary);font-size:13px;margin:0}',
      '.dfish .dim{color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.dfish .err{color:#e5484d;font-size:12.5px;white-space:pre-wrap}',
      '.dfish .ok{color:#30a46c;font-size:12.5px;white-space:pre-wrap}',
      '.dfish .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
      '.dfish .card>.form+button,.dfish .card>.chips+button,.dfish .card>.hint+button{margin-top:12px}',
      '.dfish .fish-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}',
      '.dfish .card>.chips{margin-top:10px;margin-bottom:6px}',
      '.dfish .form{display:flex;flex-direction:column;gap:9px;font-size:13px}',
      '.dfish .form label{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.dfish input[type=number]{width:62px;background:transparent;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:26px;padding:0 7px;outline:none}',
      '.dfish input[type=text]{flex:1;min-width:200px;background:transparent;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:26px;padding:0 7px;outline:none}',
      '.dfish button{background:transparent;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:28px;padding:0 12px;cursor:pointer}',
      '.dfish button:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
      '.dfish button:disabled{opacity:.5;cursor:default}',
      '.dfish textarea{width:100%;box-sizing:border-box;min-height:66px;resize:vertical;background:transparent;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:8px 10px;outline:none}',
      '.dfish .said{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:21px;border-left:2px solid var(--dsw-alias-border-l2);padding-left:10px;margin:6px 0}',
      '.dfish .badge{display:inline-block;min-width:16px;text-align:center;padding:0 5px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted,#fff);font-size:10.5px;line-height:16px;margin-left:6px}',
      '.dfish .tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:5px;background:rgba(128,128,128,.06)}',
      '.dfish .tab{background:transparent;border:.5px solid transparent;border-radius:7px;height:28px;padding:0 11px;font-size:12.5px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary));cursor:pointer}',
      '.dfish .tab:hover{color:var(--dsw-alias-label-primary);background:rgba(128,128,128,.12)}',
      '.dfish .tab.on{background:rgba(128,128,128,.18);border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-state-business-primary);font-weight:500}',
      '.dfish .tab.on:hover{color:var(--dsw-alias-state-business-primary);background:rgba(128,128,128,.24)}',
      '.dfish .tabs .grow{flex:1}',
      '.dfish .tabhint{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin:-6px 0 0}',
      '.dfish .page{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;align-items:start}',
      '.dfish .page>.card{min-width:0}',
      '.dfish .card.full{grid-column:1 / -1}',
      '.dfish .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 18px}',
      '.dfish .fld{display:flex;flex-direction:column;gap:5px;min-width:0}',
      '.dfish .fl{display:flex;flex-direction:column;gap:2px}',
      '.dfish .flabel{font-size:13px;line-height:19px}',
      '.dfish .fhint{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.dfish .hint{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary);margin:0}',
      '.dfish .warn{font-size:12px;line-height:18px;color:#b8860b;margin:6px 0}',
      '.dfish select{height:28px;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;background-color:var(--dsw-alias-bg-layer-1,Field);color:var(--dsw-alias-label-primary,CanvasText);color-scheme:inherit;font-size:12.5px;padding:0 8px;outline:none;cursor:pointer;max-width:240px}',
      '.dfish select option{background-color:var(--dsw-alias-bg-layer-1,Field);color:var(--dsw-alias-label-primary,CanvasText)}',
      '.dfish input[type=time]{height:28px;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;background-color:var(--dsw-alias-bg-layer-1,Field);color:var(--dsw-alias-label-primary,CanvasText);color-scheme:inherit;font-size:12.5px;padding:0 6px;outline:none}',
      '.dfish .step{width:26px;height:26px;padding:0;border-radius:6px;font-size:14px;line-height:1}',
      '.dfish .pager{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 8px}',
      '.dfish .pager button{height:24px;padding:0 10px;font-size:12px;border-radius:6px}',
      '.dfish .pager .dim{font-size:12px;font-variant-numeric:tabular-nums}',
      '.dfish .sw{position:relative;width:40px;height:22px;padding:0;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);background:rgba(128,128,128,.18);cursor:pointer;transition:background .15s}',
      '.dfish .sw .knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s}',
      '.dfish .sw.on{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.dfish .sw.on .knob{left:20px}',
      '.dfish .savebar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:4px}',
      '.dfish button.primary{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.dfish button.primary:hover:not(:disabled){opacity:.9;color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.dfish .ghlink{display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);text-decoration:none;border-radius:6px;padding:2px 4px;margin-left:-4px}',
      '.dfish .ghlink:hover{color:var(--dsw-alias-state-business-primary);background:rgba(128,128,128,.1)}',
      '.dfish .ghlink svg{flex:0 0 auto}',
      '.dfish .qrovl{position:fixed;inset:0;z-index:91;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.62)}',
      '.dfish .qrcard{width:min(340px,92vw);box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,Canvas);color:var(--dsw-alias-label-primary,CanvasText);border:.5px solid var(--dsw-alias-border-l3);border-radius:14px;padding:18px 18px 14px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.45)}',
      '.dfish .qrcard h4{margin:0 0 12px;font-size:13.5px;font-weight:600;line-height:20px}',
      '.dfish .qrpic{display:block;width:100%;max-width:252px;margin:0 auto;border-radius:8px;background:#fff}',
      '.dfish .qrph{display:flex;align-items:center;justify-content:center;width:100%;max-width:252px;height:252px;margin:0 auto;box-sizing:border-box;border:.5px dashed var(--dsw-alias-border-l2);border-radius:8px;background:rgba(128,128,128,.06);color:var(--dsw-alias-label-tertiary);font-size:12.5px}',
      '.dfish .qrwho{margin:4px 0 6px;font-size:14px;line-height:20px}',
      '.dfish .qrstat{margin:10px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary))}',
      '.dfish .qrerr{margin:6px 0 0;font-size:12px;line-height:18px;color:#e5484d}',
      '.dfish .qrbtns{display:flex;gap:8px;justify-content:center;margin-top:14px}',
      '.dfish .qrbtns button{height:30px;padding:0 14px;font-size:13px;border-radius:8px}',
      '.dfish .qrbtns button.go{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.dfish .qrbtns button.go:hover:not(:disabled){opacity:.9;color:var(--dsw-alias-label-primary-inverted,#fff);border-color:var(--dsw-alias-state-business-primary)}',
      '@media(max-width:420px){.dfish .page{grid-template-columns:minmax(0,1fr)}.dfish .tab{padding:0 8px}.dfish input[type=text]{min-width:100px}}',
    ].join('\n')
    function useStyleOnce() {
      useEffect(() => {
        if (document.querySelector(`style[data-tag="${CSS_TAG}"]`)) return
        const el = document.createElement('style')
        el.setAttribute('data-tag', CSS_TAG)
        el.textContent = CSS
        document.head.appendChild(el)
      }, [])
    }

    function q2(v) {
      const n = typeof v === 'number' ? v : Number(v && v.score)
      return Number.isFinite(n) ? n.toFixed(2) : '—'
    }

    /**
     * 「判断漂移」那一行的值：样本不够时不准印 0.00。
     *
     * 2026-10-26（用户 m05785「为什么剩下两个全是0」）：三个指标在样本不足时给的
     * 默认值原本被直接当成结果显示——没有判断时稳定 0.00、说话不足两条时一致 1.00、
     * 没有七天前的老话时新鲜 0.00。三个数里有两个是"还没法测"，不是"她很差"。
     * 现在把这种情况写成一句人话，数字只在真的能测时才印。
     */
    function bandOf(v) {
      return typeof v === 'string' ? v.trim() : ''
    }
    function qStability(v) {
      if (!v) return '—'
      const band = bandOf(v && v.band)
      // 2026-10-27（用户 m06350）：能测出来的时候，数字和判读一起给——只印那句
      // 「长在这些事上，抽掉一条少一块」，用户看不出到底是多少，以为没测。
      // 样本不够时才只给判读：那种 0.00 是默认值，不是测量结果，不能当数字印。
      if (!Number(v.sample ?? 0) || !Number(v.beliefs ?? 0)) return band || '还没攒到判断，测不出来'
      const n = Number(v.score)
      const num = Number.isFinite(n) ? n.toFixed(2) : '—'
      return band ? `${num} · ${band}` : num
    }
    function qConsistency(v) {
      if (!v) return '—'
      const pairs = Number(v.pairs ?? 0)
      if (!pairs) return '还没有跨阶段的话可比'
      const n = Number(v.score)
      return Number.isFinite(n) ? n.toFixed(2) : '—'
    }
    function qNovelty(v) {
      if (!v) return '—'
      const recent = Number(v.recent ?? 0)
      const older = Number(v.older ?? 0)
      if (!recent) return '最近一周没说过话'
      if (!older) return '还没有七天前的老话可比'
      const n = Number(v.score)
      return Number.isFinite(n) ? n.toFixed(2) : '—'
    }

    async function jget(path) {
      const r = await fetch(API + path, { headers: { accept: 'application/json' } })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        const hint =
          r.status === 401 || r.status === 403 ? '（被信任栅栏拒绝：请在 App 内打开这一页）' : ''
        throw new Error(`HTTP ${r.status}${hint} ${j.error || ''}`.trim())
      }
      return j
    }

    async function jpost(path, body) {
      const r = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body == null ? {} : body),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      return j
    }

    const TABS = [
      ['now', '状态'],
      ['grow', '成长'],
      ['home', '住所'],
      ['wechat', '微信'],
      ['memory', '记忆'],
      ['env', '插件'],
      ['principle', '原理'],
      ['data', '数据'],
      ['feedback', '反馈'],
    ]
    const card = (title, ...children) =>
      h('section', { className: 'card full' }, h('h3', null, title), ...children)
    const hint = (text) => h('p', { className: 'hint' }, text)
    const action = (label, fn, disabled = false) =>
      h('button', { type: 'button', onClick: fn, disabled }, label)
    const rows = (pairs) =>
      h(
        'div',
        { className: 'kv' },
        ...pairs.flatMap(([label, value]) => [
          h('b', { key: label }, label),
          h('span', { key: label + ':value' }, value ?? '—'),
        ]),
      )
    const time = (s) => (s ? new Date(s).toLocaleString() : '—')
    const outcomes = {
      silent: '旁听',
      accepted: '已发送',
      quiet: '静默时段',
      turn_budget: '旁听额度已用完',
      direct_budget: '直接对话额度已用完',
      reply_budget: '发送额度已用完',
      send_blocked: '本轮未发送',
      failed: '回合失败',
      manual_observed: '已完成观察',
      unavailable: '尚未就绪',
    }

    function SettingNumber({ label, value, min, max, save, disabled }) {
      const [draft, setDraft] = useState(String(value))
      useEffect(() => setDraft(String(value)), [value])
      return h(
        'label',
        { className: 'row' },
        label,
        h('input', {
          type: 'number',
          min,
          max,
          disabled,
          value: draft,
          onChange: (e) => setDraft(e.target.value),
          onBlur: () => {
            const n = Number(draft)
            if (draft === '' || !Number.isInteger(n) || n < min || n > max) {
              setDraft(String(value))
              return
            }
            if (n !== value) save(n)
          },
          onKeyDown: (e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          },
        }),
      )
    }
    const toggle = (label, checked, onChange, disabled) =>
      h(
        'label',
        { className: 'row' },
        h('input', {
          type: 'checkbox',
          checked,
          disabled,
          onChange: (e) => onChange(e.target.checked),
        }),
        label,
      )

    function Diary({ rooms, visible }) {
      const [channel, setChannel] = useState(''),
        [date, setDate] = useState(''),
        [diary, setDiary] = useState(null),
        [error, setError] = useState('')
      useEffect(() => {
        let live = true
        setDiary(null)
        setError('')
        if (visible)
          jget('/diary?' + new URLSearchParams({ channel, date }))
            .then((d) => {
              if (live) setDiary(d)
            })
            .catch((e) => {
              if (live) setError(e.message)
            })
        return () => {
          live = false
        }
      }, [visible, channel, date])
      return card(
        '日记',
        visible
          ? h(
              'div',
              { className: 'form' },
              h(
                'label',
                null,
                '会话',
                h(
                  'select',
                  {
                    value: channel,
                    onChange: (e) => {
                      setChannel(e.target.value)
                      setDate('')
                    },
                  },
                  h('option', { value: '' }, '早期日记'),
                  ...rooms.map((r) => h('option', { key: r.key, value: r.key }, r.title)),
                ),
              ),
              diary?.dates.length
                ? h(
                    'select',
                    {
                      value: diary.date,
                      onChange: (e) => setDate(e.target.value),
                      'aria-label': '日期',
                    },
                    ...diary.dates.map((d) => h('option', { key: d }, d)),
                  )
                : null,
              h('pre', null, error || diary?.text || (diary ? '暂无日记' : '读取中…')),
            )
          : hint('开启「在设置中查看日记」后可按会话阅读。'),
      )
    }

    let rowSequence = 0
    const makeRow = (row = {}) => ({ id: '', name: '', ...row, key: ++rowSequence, result: '' })
    function WechatPage({ rhythm, refreshStatus }) {
      const [info, setInfo] = useState(null),
        [flags, setFlags] = useState(null),
        [lists, setLists] = useState({ groups: [], contacts: [] })
      const [login, setLogin] = useState(null),
        [note, setNote] = useState(''),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false)
      const [attempt, setAttempt] = useState(0)
      const mounted = useRef(false)
      useEffect(() => {
        mounted.current = true
        jget('/wechat/settings')
          .then((s) => {
            if (!mounted.current) return
            setInfo(s)
            setFlags({
              sending: s.sending,
              scheduledSending: s.scheduledSending,
              maxMessageAgeMs: s.maxMessageAgeMs,
            })
            setLists({ groups: s.groups.map(makeRow), contacts: s.contacts.map(makeRow) })
            if (!s.loggedIn)
              void jpost('/wechat/login', {})
                .then((l) => {
                  if (mounted.current) {
                    setLogin(l)
                    setAttempt((x) => x + 1)
                  }
                })
                .catch((e) => {
                  if (mounted.current) setError(e.message)
                })
          })
          .catch((e) => {
            if (mounted.current) setError(e.message)
          })
        return () => {
          mounted.current = false
        }
      }, [])
      useEffect(() => {
        if (!info || info.loggedIn) return
        let live = true,
          timer
        async function poll() {
          try {
            const l = await jget('/wechat/login')
            if (!live) return
            setLogin(l)
            if (l.state === 'authenticated') {
              const s = await jget('/wechat/settings')
              if (live) {
                setInfo(s)
                refreshStatus()
              }
              return
            }
          } catch (e) {
            if (live) setError(e.message)
          }
          if (live) timer = setTimeout(poll, 2500)
        }
        void poll()
        return () => {
          live = false
          clearTimeout(timer)
        }
      }, [info?.loggedIn, attempt])
      useEffect(() => {
        if (!info?.loggedIn) return
        let live = true
        const timer = setInterval(async () => {
          try {
            const next = await jget('/wechat/settings')
            if (live && !next.loggedIn) {
              setInfo(next)
              const l = await jpost('/wechat/login', {})
              if (live) {
                setLogin(l)
                setAttempt((x) => x + 1)
              }
            }
          } catch (e) {
            if (live) setError(e.message)
          }
        }, 15000)
        return () => {
          live = false
          clearInterval(timer)
        }
      }, [info?.loggedIn])
      async function perform(fn) {
        setBusy(true)
        setError('')
        setNote('')
        try {
          await fn()
        } catch (e) {
          if (mounted.current) setError(e.message)
        } finally {
          if (mounted.current) setBusy(false)
        }
      }
      function change(kind, key, patch) {
        setLists((old) => ({
          ...old,
          [kind]: old[kind].map((r) => (r.key === key ? { ...r, ...patch } : r)),
        }))
      }
      const list = (kind, title, placeholder) =>
        card(
          title,
          h(
            'div',
            { className: 'form' },
            ...lists[kind].map((r) =>
              h(
                'div',
                { className: 'row', key: r.key },
                h('input', {
                  type: 'text',
                  value: r.name,
                  placeholder,
                  'aria-label': title + '名称',
                  disabled: busy,
                  onChange: (e) =>
                    change(kind, r.key, {
                      id: '',
                      name: e.target.value,
                      result: '',
                      candidates: [],
                    }),
                }),
                action(
                  '检测',
                  () =>
                    perform(async () => {
                      try {
                        const actual = await jpost('/wechat/detect', {
                          kind,
                          row: { name: r.name.trim() },
                        })
                        change(
                          kind,
                          r.key,
                          actual.candidates
                            ? { id: '', candidates: actual.candidates, result: '发现同名，请选择' }
                            : { ...actual, candidates: [], result: '检测通过' },
                        )
                      } catch (e) {
                        change(kind, r.key, {
                          id: '',
                          candidates: [],
                          result: '检测失败：' + e.message,
                        })
                      }
                    }),
                  busy || !r.name.trim(),
                ),
                action(
                  '删除',
                  () =>
                    setLists((old) => ({
                      ...old,
                      [kind]: old[kind].filter((x) => x.key !== r.key),
                    })),
                  busy,
                ),
                r.candidates?.length
                  ? h(
                      'select',
                      {
                        'aria-label': '选择同名' + title,
                        disabled: busy,
                        value: '',
                        onChange: (e) => {
                          const option = r.candidates.find((c) => c.id === e.target.value)
                          if (option)
                            perform(async () => {
                              const target = await jpost('/wechat/detect', {
                                kind,
                                row: { id: option.id },
                              })
                              change(kind, r.key, { ...target, candidates: [], result: '检测通过' })
                            })
                        },
                      },
                      h('option', { value: '' }, '选择微信中的对象'),
                      ...r.candidates.map((c) =>
                        h(
                          'option',
                          { key: c.id, value: c.id },
                          [c.name, c.detail].filter(Boolean).join(' · '),
                        ),
                      ),
                    )
                  : null,
                r.result ? h('small', null, r.result) : null,
              ),
            ),
          ),
          h(
            'div',
            { className: 'fish-actions' },
            action(
              '添加一条',
              () => setLists((old) => ({ ...old, [kind]: [...old[kind], makeRow()] })),
              busy || !info,
            ),
          ),
        )
      const loginNames = {
        idle: '等待登录',
        pending: '准备中',
        running: '登录中',
        awaiting_scan: '等待扫码',
        awaiting_approval: '请在手机上确认',
        expired: '二维码已过期',
        failed: '登录失败',
        cancelled: '已取消',
        succeeded: '登录成功',
      }
      const active =
        login &&
        ![
          'idle',
          'failed',
          'expired',
          'succeeded',
          'cancelled',
          'canceled',
          'timed_out',
          'authenticated',
        ].includes(login.state)
      return h(
        'div',
        { className: 'page' },
        card(
          '微信登录',
          info
            ? rows([
                ['服务地址', info.baseUrl],
                ['账号', info.accountId],
                ['机器人', info.selfId],
                [
                  '状态',
                  info.loggedIn ? '已登录' : loginNames[login?.state] || login?.state || '等待登录',
                ],
              ])
            : hint(error || '读取中…'),
          info && !info.loggedIn
            ? h(
                'div',
                { className: 'form' },
                action(
                  '生成登录二维码',
                  () =>
                    perform(async () => {
                      setLogin(await jpost('/wechat/login', {}))
                      setAttempt((x) => x + 1)
                    }),
                  busy || active,
                ),
                login?.available && login.generation
                  ? h('img', {
                      src:
                        API + '/wechat/qr?generation=' + login.generation + '&attempt=' + attempt,
                      alt: '用微信扫描登录',
                      style: { width: 210, maxWidth: '100%' },
                    })
                  : null,
              )
            : null,
        ),
        flags
          ? card(
              '微信收发',
              h(
                'div',
                { className: 'form' },
                toggle(
                  '允许发送回复',
                  flags.sending,
                  (v) => setFlags((f) => ({ ...f, sending: v })),
                  busy,
                ),
                toggle(
                  '允许定时发送到授权群',
                  flags.scheduledSending,
                  (v) => setFlags((f) => ({ ...f, scheduledSending: v })),
                  busy,
                ),
                h(SettingNumber, {
                  label: '消息有效期（秒）',
                  value: flags.maxMessageAgeMs / 1000,
                  min: 1,
                  max: 3600,
                  save: (v) => setFlags((f) => ({ ...f, maxMessageAgeMs: v * 1000 })),
                  disabled: busy,
                }),
              ),
            )
          : null,
        list('groups', '微信群', '输入微信群名称'),
        list('contacts', '私聊名单', '输入联系人昵称或备注'),
        h(
          'div',
          { className: 'row card full' },
          action(
            '保存微信设置',
            () =>
              perform(async () => {
                if (Object.values(lists).some((rows) => rows.some((r) => !r.id)))
                  throw Error('请先检测每一行名称，并选择同名结果，或删除空行')
                const value = Object.fromEntries(
                  Object.entries(lists).map(([k, v]) => [
                    k,
                    v.map(({ id, name }) => ({ id: id.trim(), name })),
                  ]),
                )
                const s = await jpost('/wechat/settings', { ...value, ...flags })
                setLists({ groups: s.groups.map(makeRow), contacts: s.contacts.map(makeRow) })
                setNote('微信设置已保存并生效')
                refreshStatus()
              }),
            busy || !info,
          ),
          hint('删除后保存即可撤销该会话的授权。'),
        ),
        error ? h('p', { className: 'err', role: 'alert' }, error) : null,
        note ? h('p', { className: 'ok' }, note) : null,
        rhythm,
      )
    }
    function FishSection() {
      useStyleOnce()
      const [tab, setTab] = useState('now'),
        [state, setState] = useState(null),
        [status, setStatus] = useState(null)
      const [config, setConfig] = useState(null),
        [events, setEvents] = useState([]),
        [catalog, setCatalog] = useState([])
      const [selected, setSelected] = useState([]),
        [target, setTarget] = useState(''),
        [note, setNote] = useState(''),
        [error, setError] = useState('')
      const [busy, setBusy] = useState(false),
        [filter, setFilter] = useState('')
      const [configText, setConfigText] = useState(null)
      const serial = useRef(Promise.resolve()),
        file = useRef(null),
        live = useRef(false)
      async function refreshStatus() {
        const [s, st, ev] = await Promise.all([jget('/state'), jget('/status'), jget('/events')])
        if (live.current) {
          setState(s)
          setStatus(st)
          setEvents(ev.events)
        }
      }
      useEffect(() => {
        live.current = true
        Promise.all([refreshStatus(), jget('/config'), jget('/tools')])
          .then(([, c, t]) => {
            if (live.current) {
              setConfig(c)
              setCatalog(t.tools)
              setSelected(c.tools.allow)
            }
          })
          .catch((e) => {
            if (live.current) setError(e.message)
          })
        return () => {
          live.current = false
        }
      }, [])
      useEffect(() => {
        if (tab !== 'now') return
        const timer = setInterval(
          () =>
            refreshStatus().catch((e) => {
              if (live.current) setError(e.message)
            }),
          15000,
        )
        return () => clearInterval(timer)
      }, [tab])
      function save(patch) {
        const task = async () => {
          setBusy(true)
          setError('')
          try {
            const c = await jpost('/config', patch)
            if (live.current) {
              setConfig(c)
              setNote(
                '已保存 ' +
                  new Date().toLocaleTimeString() +
                  (patch.tools ? '，工具授权在宿主重启后生效' : ''),
              )
              await refreshStatus()
            }
          } catch (e) {
            if (live.current) setError(e.message)
          } finally {
            if (live.current) setBusy(false)
          }
        }
        serial.current = serial.current.then(task, task)
      }
      async function perform(fn) {
        setError('')
        setBusy(true)
        try {
          await fn()
          await refreshStatus()
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy(false)
        }
      }
      function num(label, key, min, max, section) {
        return h(SettingNumber, {
          label,
          value: section ? config[section][key] : config[key],
          min,
          max,
          disabled: busy,
          save: (n) => save(section ? { [section]: { [key]: n } } : { [key]: n }),
        })
      }
      const rooms = status?.rooms || [],
        groups = status?.transport?.groups || [],
        contacts = status?.transport?.contacts || []
      const destinations = [...groups, ...contacts],
        targetId = destinations.some((g) => g.id === target) ? target : destinations[0]?.id
      const tabs = h(
        'div',
        { className: 'tabs', role: 'tablist', 'aria-label': '大肥鱼设置' },
        ...TABS.map(([id, label]) =>
          h(
            'button',
            {
              type: 'button',
              key: id,
              role: 'tab',
              id: 'fish-tab-' + id,
              'aria-selected': tab === id,
              className: 'tab' + (tab === id ? ' on' : ''),
              onClick: () => setTab(id),
            },
            label,
          ),
        ),
      )
      const recent = status?.activity?.recent || []
      function statusPage() {
        const m = state,
          connected = status?.transport?.connected
        if (!m) return hint('读取中…')
        return [
          h(
            'div',
            { className: 'card full', key: 'fish' },
            h(
              'div',
              { className: 'row' },
              h(
                'div',
                {
                  style: {
                    width: 46,
                    height: 46,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    background: 'rgba(127,127,127,.14)',
                    display: 'grid',
                    placeItems: 'center',
                  },
                },
                m.avatar.present
                  ? h('img', {
                      alt: '大肥鱼头像',
                      src: API + '/avatar?v=' + encodeURIComponent(m.avatar.at),
                      style: { width: '100%', height: '100%', objectFit: 'cover' },
                    })
                  : '鱼',
              ),
              h(
                'div',
                { style: { flex: 1 } },
                h('strong', null, connected ? '● 正在旁听' : '○ 微信未连接'),
                h(
                  'div',
                  { className: 'row' },
                  action('换头像', () => file.current?.click(), busy),
                  m.avatar.present
                    ? action(
                        '移除',
                        () =>
                          perform(async () => {
                            await jpost('/avatar', { remove: true })
                            setNote('头像已移除')
                          }),
                        busy,
                      )
                    : null,
                ),
              ),
              destinations.length > 1
                ? h(
                    'select',
                    {
                      'aria-label': '唤醒会话',
                      value: targetId,
                      onChange: (e) => setTarget(e.target.value),
                    },
                    ...destinations.map((g) =>
                      h('option', { key: g.id, value: g.id }, g.name || g.id),
                    ),
                  )
                : null,
              action(
                '现在叫醒大肥鱼',
                () =>
                  perform(async () => {
                    const r = await jpost('/wake', { id: targetId })
                    setNote(outcomes[r.status] || r.status)
                  }),
                busy || !connected || !targetId,
              ),
              h('input', {
                type: 'file',
                hidden: true,
                ref: file,
                accept: 'image/png,image/jpeg,image/webp,image/gif',
                onChange: (e) => {
                  const image = e.target.files?.[0]
                  e.target.value = ''
                  if (!image) return
                  perform(async () => {
                    if (image.size > 2097152) throw Error('头像上限为 2 MB')
                    const data = await new Promise((resolve, reject) => {
                      const reader = new FileReader()
                      reader.onload = () => resolve(reader.result)
                      reader.onerror = reject
                      reader.readAsDataURL(image)
                    })
                    await jpost('/avatar', { data, mime: image.type })
                    setNote('头像已保存')
                  })
                },
              }),
            ),
            hint(
              recent.length
                ? '最近动静：' +
                    time(recent.at(-1).at) +
                    ' · ' +
                    (outcomes[recent.at(-1).status] || recent.at(-1).status)
                : '今天还没有动静。',
            ),
          ),
          card(
            '状态',
            hint('这些数字都是从她的事件流里算出来的，她看不见自己这些数。'),
            rows([
              ['已成长天数', m.day + ' / ' + m.growthDays + ' 天'],
              ['当前阶段', m.stage + ' · ' + m.stageName],
              [
                '下一个成长瓶颈',
                { trust: '信任', autonomy: '自主', competence: '主动' }[m.pendingGate] || '已完成',
              ],
              ['最近的判断', m.beliefs.length + ' 条'],
              ['认知矛盾', m.tensions || '没有'],
              ['没想通的事', m.scars || '没有'],
              ['立场', m.stanceReady ? m.stances + ' 条' : '还没开始'],
              ['最近的称呼', m.name || '还没想好'],
              [
                '互动计数',
                '说 ' +
                  m.counts.utterance +
                  ' · 改口 ' +
                  m.counts.revise +
                  ' · 拒绝 ' +
                  m.counts.refusal +
                  ' · 重聚 ' +
                  m.counts.reunion,
              ],
              ['判断漂移', '三个诊断值'],
              ['稳定', qStability(m.quality.stability)],
              ['一致', qConsistency(m.quality.consistency)],
              ['新鲜', qNovelty(m.quality.novelty)],
            ]),
          ),
        ]
      }
      function rhythm() {
        return card(
          '参与节奏',
          h(
            'div',
            { className: 'form' },
            toggle(
              '允许定时观察',
              config.proactive.enabled,
              (v) => save({ proactive: { enabled: v } }),
              busy,
            ),
            num('观察间隔（分钟）', 'intervalMinutes', 15, 1440, 'proactive'),
            num('每天主动观察上限', 'maxPerDay', 0, 12, 'proactive'),
            num('最短空闲时间（分钟）', 'minIdleMinutes', 5, 1440, 'proactive'),
            num('每小时直接对话上限', 'maxDirectTurnsPerHour', 1, 240, 'group'),
            num('每小时旁听上限', 'maxTurnsPerHour', 1, 240, 'group'),
            num('每分钟发送上限', 'maxRepliesPerMinute', 1, 6, 'group'),
            num('合并窗口（毫秒，重启后生效）', 'batchMs', 50, 5000, 'group'),
            ...['静默开始（时）', '静默结束（时）'].map((label, i) =>
              h(SettingNumber, {
                key: label,
                label,
                value: config.group.quietHours[i],
                min: 0,
                max: 23,
                disabled: busy,
                save: (v) =>
                  save({
                    group: {
                      quietHours: config.group.quietHours.map((old, j) => (i === j ? v : old)),
                    },
                  }),
              }),
            ),
            hint('时区 ' + config.group.timezone + '。定时外发还需开启部署配置 scheduledSending。'),
          ),
        )
      }
      function page() {
        if (tab === 'now') return statusPage()
        if (!state || !config) return hint('读取中…')
        switch (tab) {
          case 'grow':
            return [
              card(
                '成长节奏',
                h(
                  'div',
                  { className: 'form' },
                  num('成长周期（天）', 'growthDays', 7, 180),
                  hint('当前阶段：' + state.stageName),
                ),
              ),
              card('人格起点', h('p', { className: 'said' }, state.seed)),
              card(
                '最近的判断',
                state.beliefs.length
                  ? h(
                      'ul',
                      null,
                      ...state.beliefs.slice(0, 12).map((b) => h('li', { key: b.id }, b.text)),
                    )
                  : hint('还没有留下判断。'),
              ),
            ]
          case 'home':
            return [
              card(
                '大肥鱼的家',
                rows([
                  ['住所', state.paths.home],
                  ['数据目录', state.paths.root],
                ]),
              ),
              card(
                '会话',
                rooms.length
                  ? h(
                      'ul',
                      null,
                      ...rooms.map((r) =>
                        h('li', { key: r.key }, r.title + ' · ' + r.turns + ' 轮'),
                      ),
                    )
                  : hint('尚未建立微信会话。'),
              ),
            ]
          case 'wechat':
            return h(WechatPage, {
              rhythm: rhythm(),
              refreshStatus: () => refreshStatus().catch((e) => setError(e.message)),
            })
          case 'memory':
            return [
              card(
                '记忆与日记',
                h(
                  'div',
                  { className: 'form' },
                  num('人格文档预算（字）', 'docBudget', 2000, 16000, 'memory'),
                  num('展示的判断数', 'beliefsShown', 1, 12, 'memory'),
                  toggle(
                    '允许写日记',
                    config.diary.enabled,
                    (v) => save({ diary: { enabled: v } }),
                    busy,
                  ),
                  toggle(
                    '在设置中查看日记',
                    config.diary.visible,
                    (v) => save({ diary: { visible: v } }),
                    busy,
                  ),
                ),
              ),
              h(Diary, { rooms, visible: config.diary.visible }),
              card(
                '最近记忆',
                h('input', {
                  type: 'text',
                  placeholder: '筛选记忆',
                  'aria-label': '筛选记忆',
                  value: filter,
                  onChange: (e) => setFilter(e.target.value),
                }),
                h(
                  'ul',
                  null,
                  ...events
                    .filter((e) => e.text.includes(filter))
                    .slice()
                    .reverse()
                    .map((e) =>
                      h(
                        'li',
                        { key: e.id },
                        h('small', null, e.groupId || e.personId || '早期记忆'),
                        ' · ' + e.text,
                      ),
                    ),
                ),
              ),
            ]
          case 'env':
            return [
              card(
                '工具授权',
                hint('选择大肥鱼可以使用的 DSH 工具。保存后重启宿主生效。'),
                h(
                  'div',
                  { className: 'chips' },
                  ...catalog
                    .filter((t) => !t.core)
                    .map((t) =>
                      h(
                        'button',
                        {
                          key: t.name,
                          type: 'button',
                          className: 'chip' + (selected.includes(t.name) ? ' on' : ''),
                          title: t.description,
                          'aria-pressed': selected.includes(t.name),
                          disabled: busy,
                          onClick: () =>
                            setSelected((v) =>
                              v.includes(t.name) ? v.filter((x) => x !== t.name) : [...v, t.name],
                            ),
                        },
                        t.name,
                      ),
                    ),
                ),
                ...selected
                  .filter((n) => !catalog.some((t) => t.name === n))
                  .map((n) =>
                    action(
                      n + '（当前未注册，点击移除）',
                      () => setSelected((v) => v.filter((x) => x !== n)),
                      busy,
                    ),
                  ),
                h(
                  'div',
                  { className: 'fish-actions' },
                  action('保存工具授权', () => save({ tools: { allow: selected } }), busy),
                ),
              ),
              card(
                '内置工具',
                hint(
                  catalog
                    .filter((t) => t.core)
                    .map((t) => t.name)
                    .join('、'),
                ),
              ),
            ]
          case 'principle':
            return [
              card(
                '认知是怎么长出来的',
                h('p', { className: 'said' }, '表态 → 遇到不同经历 → 发现矛盾 → 修正判断 → 回顾'),
                hint('每条新判断都保留出处。修正会引用旧记录，下次回忆能看到她为什么改口。'),
              ),
              card(
                '群聊与私聊记忆',
                hint('人格起点共享。每个群和每个联系人各有自己的会话、回忆、日记和便条。'),
              ),
            ]
          case 'data':
            return [
              card(
                '数据',
                rows([
                  ['数据文件夹', state.paths.root],
                  ['配置文件', state.paths.config],
                  ['经历记录', state.counts.all + ' 条'],
                  ['无法读取的记录', state.skipped],
                ]),
                h('a', { href: API + '/backup', download: 'fish-backup.json' }, '导出备份'),
                hint('迁移时请停服，另行备份微信传输目录。'),
              ),
              card(
                '最近活动',
                recent.length
                  ? h(
                      'ul',
                      null,
                      ...recent
                        .slice(-20)
                        .reverse()
                        .map((r, i) =>
                          h(
                            'li',
                            { key: i },
                            time(r.at) +
                              ' · ' +
                              r.groupId +
                              ' · ' +
                              (outcomes[r.status] || r.status),
                          ),
                        ),
                    )
                  : hint('尚无活动。'),
              ),
            ]
          case 'feedback':
            return [
              card(
                '反馈问题',
                h(
                  'a',
                  {
                    href: 'https://github.com/jjggddb/dsh-fish/issues',
                    target: '_blank',
                    rel: 'noreferrer',
                  },
                  '向微信群版项目反馈',
                ),
                hint('当前版本 ' + status.version + '。反馈时请隐去账号、聊天内容和登录凭据。'),
              ),
            ]
        }
      }
      return h(
        'section',
        { className: 'dfish', 'aria-label': '大肥鱼' },
        h(
          'div',
          { className: 'row' },
          h('h2', { style: { flex: 1 } }, '大肥鱼'),
          action(
            configText === null ? '打开配置文件' : '收起配置文件',
            () => setConfigText(configText === null ? JSON.stringify(config, null, 2) : null),
            !config || busy,
          ),
        ),
        h(
          'p',
          { className: 'sub' },
          state
            ? '第 ' +
                state.day +
                ' / ' +
                state.growthDays +
                ' 天 · ' +
                state.stageName +
                ' · 她记下 ' +
                state.counts.real +
                ' 条，另有 ' +
                state.counts.meta +
                ' 条系统记录'
            : '读取中…',
        ),
        error ? h('p', { className: 'err', role: 'alert' }, error) : null,
        note ? h('p', { className: 'ok', role: 'status' }, note) : null,
        configText !== null
          ? card(
              '运行配置',
              hint(state?.paths.config),
              h('textarea', {
                rows: 14,
                value: configText,
                'aria-label': '运行配置 JSON',
                onChange: (e) => setConfigText(e.target.value),
              }),
              action(
                '保存配置文件',
                () =>
                  perform(async () => {
                    const patch = JSON.parse(configText)
                    if (!patch || Array.isArray(patch) || typeof patch !== 'object')
                      throw Error('配置必须是 JSON 对象')
                    const c = await jpost('/config', patch)
                    setConfig(c)
                    setSelected(c.tools.allow)
                    setConfigText(JSON.stringify(c, null, 2))
                    setNote('已保存 ' + new Date().toLocaleTimeString())
                  }),
                busy,
              ),
            )
          : null,
        tabs,
        h(
          'div',
          {
            className: tab === 'wechat' ? '' : 'page',
            role: 'tabpanel',
            'aria-labelledby': 'fish-tab-' + tab,
          },
          page(),
        ),
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
