// Profile settings seed the panel until the administrator saves a local override.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeAtomic } from '../store.js'
import { actionNames, xhsSettings, serviceOrigin } from './config.js'
import { createXhs } from './index.js'

export async function openXhsSettings(ctx, profile, deps) {
  const file = join(deps.root, 'xhs-settings.json')
  let settings, worker, closed = false, tail = Promise.resolve()
  const credentialOrigin = serviceOrigin(profile?.baseUrl)
  try {
    settings = xhsSettings(JSON.parse(await readFile(file, 'utf8')))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    settings = xhsSettings(profile ?? {})
  }
  function create(config) {
    return config.enabled ? createXhs(ctx, { ...config, credentialOrigin }, deps) : null
  }
  worker = create(settings)
  worker?.start()
  const groups = () => {
    const native = deps.native?.()
    return (native?.authorizedGroups() || []).map(({ id, name }) => ({ accountId: native.identity().accountId, groupId: id, name }))
  }
  const info = () => ({ config: settings, authorized: deps.allow.includes('xhs_read'),
    grants: actionNames.filter(name => deps.allow.includes(name)), groups: groups(), usedMinutes: worker?.usedMinutes() ?? null, recentActions: worker?.recentActions() || [] })
  function save(input) {
    const change = async () => {
      if (closed || !deps.tenancy.tenant.ok) throw Error('Fish 已停止')
      if (!input || !['enabled', 'baseUrl', 'accountId', 'ownerId', 'intervalMs'].every(key => Object.hasOwn(input, key)) ||
          Object.keys(input).some(key => !Object.hasOwn(settings, key))) throw new RangeError('小红书设置字段无效')
      const next = xhsSettings({ ...settings, ...input })
      if (next.enabled && process.env.FISH_XHS_TOKEN && next.baseUrl !== credentialOrigin)
        throw new RangeError('服务凭据绑定到 DSH profile 的地址，请先更新 profile 中的 baseUrl')
      if (JSON.stringify(next) === JSON.stringify(settings)) {
        await writeAtomic(file, JSON.stringify(next, null, 2), 0o600)
        return info()
      }
      await worker?.dispose()
      worker = null
      try {
        worker = create(next)
        await writeAtomic(file, JSON.stringify(next, null, 2), 0o600)
      } catch (error) {
        await worker?.dispose()
        worker = create(settings)
        worker?.start({ immediate: false })
        throw error
      }
      settings = next
      if (!worker) deps.catalog?.delete('xhs_read')
      for (const name of actionNames) if (!worker) deps.catalog?.delete(name)
      worker?.start({ immediate: false })
      return info()
    }
    const result = tail.then(change)
    tail = result.catch(() => {})
    return result
  }
  return { config:()=>settings, info, save, async dispose() {
    closed = true
    await tail
    await worker?.dispose()
  } }
}
