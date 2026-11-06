import { randomUUID } from 'node:crypto'
import { checkedTitle, relationshipRole } from '../family.js'
import { targets } from './targets.js'

export function wechatAdmin(native) {
  const { client, config, signal } = native
  const account = config.accountId
  let { operationId, loginKey } = native.store.loginState()
  let starting,
    saving = false
  async function identity() {
    const a = await client.account(account)
    if (a.authenticated === true && a.ownUsername !== config.selfId)
      throw Error('登录微信与配置的机器人身份不一致')
    return a.authenticated === true
  }
  async function resolveTarget(kind, row) {
    if (!['groups', 'contacts'].includes(kind)) throw Error('未知名单类型')
    const inputs = targets(
      kind === 'groups' ? [row] : [],
      kind === 'contacts' ? [row] : [],
      config.selfId,
    )
    const { id } = inputs[kind][0]
    if (kind === 'groups') {
      const g = await client.group(account, id, signal)
      if (g.roomId !== id || g.isInGroup === false) throw Error('机器人不在此群')
      return { id, name: g.displayName || g.name || g.remark || '' }
    }
    const c = await client.contact(account, id)
    if (c.username !== id || c.deleted || c.relation === 'blocked' || c.relation === 'deleted')
      throw Error('联系人身份无效')
    return { id, name: c.remark || c.displayName || c.nickname || c.alias || '' }
  }
  async function byName(kind, input) {
    if (!['groups', 'contacts'].includes(kind)) throw Error('未知名单类型')
    const name = typeof input === 'string' ? input.trim() : ''
    if (!name || name.length > 128) throw Error('请输入有效的微信名称')
    const matches = new Map()
    const cursors = new Set()
    let cursor
    do {
      const page = await client[kind](account, { query: name, limit: 200, cursor })
      for (const v of page.items) {
        if (v.deleted) continue
        const group = kind === 'groups'
        const id = group ? v.roomId : v.username
        if (
          !id ||
          id === config.selfId ||
          v.isInGroup === false ||
          ['blocked', 'deleted'].includes(v.relation)
        )
          continue
        const labels = group
          ? [v.displayName, v.name, v.remark]
          : [v.remark, v.displayName, v.nickname, v.alias]
        if (!labels.some((l) => typeof l === 'string' && l.trim() === name)) continue
        matches.set(id, {
          id,
          name: labels.find(Boolean) || name,
          detail: [...new Set(labels.filter((l) => l && l !== name))].join(' · '),
        })
      }
      cursor = page.nextCursor
      if (cursor && (cursors.has(cursor) || cursors.size >= 100))
        throw Error('微信目录未读完整，请稍后重试')
      cursors.add(cursor)
    } while (cursor)
    if (!matches.size)
      throw Error(
        '没有找到同名的' + (kind === 'groups' ? '微信群' : '联系人') + '，请核对微信中的名称或备注',
      )
    if (matches.size > 1) {
      const candidates = [...matches.values()]
      if (kind === 'groups') {
        for (const c of candidates) {
          const g = await client.group(account, c.id, signal)
          if (g.roomId !== c.id || g.isInGroup === false) continue
          let owner
          if (g.ownerId) {
            try {
              owner = await client.contact(account, g.ownerId)
            } catch {}
          }
          const ownerName = owner?.remark || owner?.displayName || owner?.nickname
          c.detail = [
            ...new Set(
              [c.detail, g.remark, g.name, ownerName && '群主：' + ownerName].filter(
                (x) => x && x !== c.name,
              ),
            ),
          ].join(' · ')
        }
      }
      const labels = candidates.map((c) => [c.name, c.detail].filter(Boolean).join(' · '))
      if (new Set(labels).size !== labels.length)
        throw Error('有同名对象且微信资料不足以区分，请先修改群名或联系人备注，再检测')
      return { candidates }
    }
    return resolveTarget(kind, matches.values().next().value)
  }
  const listRelationships = (rows = native.store.relationships()) =>
    rows.map(row => ({ ...row, role: relationshipRole(row.title) }))
  function legacyFather(rows) {
    const matches = rows.filter(person => relationshipRole(person.title) === '父亲')
    if (matches.length > 1) throw Error('已绑定多位爸爸，请使用新的人格关系设置')
    if (!matches.length) return null
    const { id, name } = matches[0]
    return { id, name }
  }
  function checkedOperation(op) {
    if (
      !op?.id ||
      op.kind !== 'login' ||
      op.accountId !== account ||
      (operationId && op.id !== operationId)
    )
      throw Error('登录操作身份不匹配')
    return op
  }
  function summary(op) {
    return {
      state: op.state,
      generation: op.result?.qrGeneration ?? 0,
      available: op.result?.qrAvailable === true,
      expiresAt: op.result?.expiresAt || null,
    }
  }
  async function login() {
    if (await identity()) return { state: 'authenticated' }
    if (operationId) {
      let op
      try {
        op = checkedOperation(await client.operation(account, operationId, signal))
      } catch (error) {
        if (error.status !== 404) throw error
      }
      if (
        op &&
        !['succeeded', 'failed', 'cancelled', 'canceled', 'expired', 'timed_out'].includes(op.state)
      )
        return summary(op)
      operationId = undefined
      loginKey = undefined
    }
    loginKey ??= randomUUID()
    native.store.saveLogin({ loginKey })
    const op = checkedOperation(
      await client.login(account, { strategy: 'qr', allowQr: true, forceQr: true }, loginKey),
    )
    operationId = op.id
    native.store.saveLogin({ loginKey, operationId })
    return summary(op)
  }
  return {
    async info() {
      return {
        accountId: account,
        selfId: config.selfId,
        groups: config.groups,
        contacts: config.contacts || [],
        loggedIn: await identity(),
        baseUrl: config.baseUrl,
        tokenEnv: config.tokenEnv,
        maxMessageAgeMs: config.maxMessageAgeMs,
        connected: native.verified,
        sending: native.sending,
      }
    },
    relationships: listRelationships,
    async changeRelationship({ action, id, title }) {
      if (typeof id !== 'string' || !id || id !== id.trim()) throw Error('请先检测微信联系人')
      const remove = action === 'remove'
      if (!remove && action !== 'add' && action !== 'rename') throw Error('未知的人格关系操作')
      const label = remove ? '' : checkedTitle(title)
      let contact
      if (action === 'add') {
        if (!(await identity())) throw Error('请先登录微信')
        contact = await resolveTarget('contacts', { id })
      }
      const updated = native.store.updateRelationships(rows => {
        const exists = rows.some(person => person.id === id)
        if (contact) {
          if (exists) throw Error('这位联系人已绑定，请修改已有称呼')
          return [...rows, { ...contact, title: label }]
        }
        if (!exists) throw Error('这位联系人的绑定已解除，请刷新')
        return remove ? rows.filter(person => person.id !== id)
          : rows.map(person => person.id === id ? { ...person, title: label } : person)
      })
      return listRelationships(updated)
    },
    // Older settings pages manage only their single 爸爸 entry.
    father() { return legacyFather(native.store.relationships()) },
    async setFather(input) {
      let next = null
      if (input.remove !== true) {
        if (!(await identity())) throw Error('请先登录微信')
        next = input.id ? await resolveTarget('contacts', { id: input.id }) : await byName('contacts', input.name)
        if (next.candidates) return { candidates: next.candidates }
      }
      native.store.updateRelationships(rows => {
        const old = legacyFather(rows)
        const others = rows.filter(person => person.id !== old?.id)
        if (next && others.some(person => person.id === next.id)) throw Error('这位联系人已有其他称呼')
        return next ? [...others, { ...next, title: '爸爸' }] : others
      })
      return { father: next }
    },
    async detect(kind, row) {
      if (!(await identity())) throw Error('请先登录微信')
      return row?.id ? resolveTarget(kind, row) : byName(kind, row?.name)
    },
    async save(input) {
      if (saving) throw Error('另一份名单正在保存，请重试')
      saving = true
      try {
        if (!Array.isArray(input.groups) || !Array.isArray(input.contacts))
          throw Error('群聊和私聊名单均需提供')
        const next = targets(input.groups, input.contacts, config.selfId)
        const online = await identity()
        for (const kind of ['groups', 'contacts']) {
          for (const row of next[kind]) {
            if (online) row.name = (await resolveTarget(kind, row)).name
            else if (!(config[kind] || []).some((r) => r.id === row.id))
              throw Error('请先登录微信并检测新增名称')
          }
        }
        for (const key of ['sending']) {
          if (input[key] !== undefined && typeof input[key] !== 'boolean')
            throw Error('发送开关格式无效')
          next[key] = input[key] ?? config[key] === true
        }
        const age = input.maxMessageAgeMs ?? config.maxMessageAgeMs
        if (!Number.isInteger(age) || age < 1000 || age > 3600000)
          throw Error('消息有效期应为 1 至 3600 秒')
        next.maxMessageAgeMs = age
        native.store.setTargets(next)
        native.replaceTargets(next)
        native.requireGroupNames = false
        native.setSending(next.sending)
        if (online) native.reachable = new Set([...next.groups, ...next.contacts].map((r) => r.id))
        else native.verified = false
        return next
      } finally {
        saving = false
      }
    },
    startLogin() {
      return (starting ??= login().finally(() => {
        starting = undefined
      }))
    },
    async pollLogin() {
      if (await identity()) return { state: 'authenticated' }
      return operationId
        ? summary(checkedOperation(await client.operation(account, operationId, signal)))
        : { state: 'idle' }
    },
    async qr(generation) {
      if (!operationId || !Number.isSafeInteger(generation) || generation < 1)
        throw Error('二维码尚未就绪')
      const op = summary(checkedOperation(await client.operation(account, operationId, signal)))
      if (!op.available || op.generation !== generation) throw Error('二维码已更新')
      return client.qr(account, operationId, generation)
    },
  }
}
