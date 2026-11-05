/** WeChat-focused fork. Native transports; Fish observes, remembers and decides. */
import { rootDir, readEvents, appendEvent, ensureHer } from './store.js'
import { loadConfig } from './settings.js'
import { registerCapture } from './capture.js'
import { registerRecall } from './recall.js'
import { registerHerDiary } from './herdiary.js'
import { registerNote } from './note.js'
import { registerIdentity } from './identity.js'
import { registerToolRestrict } from './restrict.js'
import { registerObserve } from './observe.js'
import { claimRoot, beatRoot, releaseRoot, HEARTBEAT_MS } from './tenant.js'
import { makeLogger } from './log.js'
import * as nativeChannel from './native-channel.js'
export const name = 'dsh-fish',
  VERSION = '0.9.0'
export const inject = ['sessionController', 'tools', 'webServer', 'connection']
export function apply(ctx, baseConfig = {}) {
  const root = baseConfig.root || process.env.DSH_FISH_HOME || rootDir(),
    logger = makeLogger(ctx, root),
    disposers = []
  const tenancy = { root, herDir: '', tenant: { ok: false, why: 'Starting' } }
  let heartbeat,
    disposed = false
  const ready = (async () => {
    tenancy.herDir = await ensureHer(root)
    tenancy.tenant = await claimRoot(root, { version: VERSION })
    if (!tenancy.tenant.ok) throw Error('Fish data already owned by another instance')
    if (disposed) {
      await releaseRoot(root, tenancy.tenant.instanceId)
      return
    }
    heartbeat = setInterval(() => {
      void beatRoot(root, tenancy.tenant.instanceId)
        .then((ok) => {
          if (!ok) tenancy.tenant = { ...tenancy.tenant, ok: false, why: 'Lease lost' }
        })
        .catch(() => {
          tenancy.tenant.ok = false
        })
    }, HEARTBEAT_MS)
    heartbeat.unref?.()
    const { events, skipped } = await readEvents(root)
    // Existing seed is authoritative. No reseed, reset or event rewriting on upgrade.
    if (!events.some((e) => e.type === 'seed') && (events.length || skipped))
      throw Error('Existing memory has no readable seed; restore from backup before starting')
    if (!events.some((e) => e.type === 'seed'))
      await appendEvent(
        {
          type: 'seed',
          text:
            baseConfig.seed ||
            '你的名字是大肥鱼。你在群聊中认识不同的人，经历和自己留下的话会慢慢改变你。',
        },
        { day: 1, stage: 1, source: 'system' },
        root,
      )
    const { config } = await loadConfig(root)
    for (const register of [registerCapture, registerRecall, registerHerDiary, registerNote]) {
      const off = register(ctx, { root, tenant: tenancy })
      if (typeof off === 'function') disposers.push(off)
    }
    disposers.push(registerToolRestrict(ctx, { herDir: tenancy.herDir, extra: config.tools.allow }))
    disposers.push(registerIdentity(ctx, { root, herDir: tenancy.herDir }))
    logger.info('[dsh-fish] ready', VERSION)
  })()
  ready.catch((error) => logger.error('[dsh-fish] startup failed', error.message))
  if (baseConfig.nativeChannel?.enabled === true)
    ctx.plugin(nativeChannel, { root, ready, tenant: tenancy, config: baseConfig.nativeChannel })
  const observer = registerObserve(ctx, { root, version: VERSION, tenancy })
  disposers.push(() => observer.dispose())
  async function shutdown() {
    if (disposed) return
    disposed = true
    clearInterval(heartbeat)
    await ready.catch(() => {})
    tenancy.tenant.ok = false
    for (const stop of disposers.reverse())
      if (typeof stop === 'function')
        try {
          stop()
        } catch {}
    if (tenancy.tenant.instanceId) await releaseRoot(root, tenancy.tenant.instanceId)
  }
  ctx.on('dispose', shutdown)
  return { dispose: shutdown }
}
