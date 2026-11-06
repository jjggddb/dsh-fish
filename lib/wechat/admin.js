import { randomUUID } from 'node:crypto'
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
      return { id, name: g.displayName || g.name || '' }
    }
    const c = await client.contact(account, id)
    if (c.username !== id || c.relation === 'blocked' || c.relation === 'deleted')
      throw Error('联系人身份无效')
    return { id, name: c.remark || c.displayName || c.nickname || '' }
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
        scheduledSending: config.scheduledSending === true,
      }
    },
    async detect(kind, row) {
      if (!(await identity())) throw Error('请先登录微信')
      return resolveTarget(kind, row)
    },
    async save(input) {
      if (saving) throw Error('另一份名单正在保存，请重试')
      saving = true
      try {
        if (!Array.isArray(input.groups) || !Array.isArray(input.contacts))
          throw Error('群聊和私聊名单均需提供')
        const next = targets(input.groups, input.contacts, config.selfId)
        const online = await identity()
        if (online)
          for (const kind of ['groups', 'contacts']) {
            for (const row of next[kind]) {
              const actual = await resolveTarget(kind, row)
              if (row.name && row.name !== actual.name)
                throw Error('名称与微信不一致，请检测后保存')
            }
          }
        for (const key of ['sending', 'scheduledSending']) {
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
