/** Fish-owned Native connection. No separately installed Cordis service. */
import { join, isAbsolute } from 'node:path'
import { NativeWeChatClient } from './sdk/native-client.js'
import { Store } from './store.js'
import { NativeTransport } from './transport.js'

export function normalizeWechat(raw = {}, root) {
  const config = {
    enabled: false,
    baseUrl: 'http://127.0.0.1:6174/',
    tokenEnv: 'WECHAT_NATIVE_TOKEN',
    accountId: '',
    selfId: '',
    groups: [],
    dataDir: join(root, 'wechat'),
    initialCursor: '0',
    sending: false,
    scheduledSending: false,
    maxMessageAgeMs: 300000,
    ...raw,
  }
  if (config.enabled !== true) return { ...config, enabled: false }
  if (
    !config.accountId || !config.selfId || !Array.isArray(config.groups) ||
    !config.groups.length || config.groups.some((g) => !/^\d+@chatroom$/.test(g?.id)) ||
    new Set(config.groups.map((g) => g.id)).size !== config.groups.length
  ) throw Error('Explicit Native account, identity and unique group IDs required')
  if (!Number.isInteger(config.maxMessageAgeMs) || config.maxMessageAgeMs < 1000 || config.maxMessageAgeMs > 3600000)
    throw Error('Invalid message lifetime')
  if (!isAbsolute(config.dataDir)) throw Error('wechat.dataDir must be absolute')
  return config
}

export function createWechat(raw, { root, log = () => {} }) {
  const config = normalizeWechat(raw, root)
  if (!config.enabled) return null
  const abort = new AbortController()
  const client = new NativeWeChatClient({
    baseUrl: config.baseUrl,
    token: process.env[config.tokenEnv],
    mediaTimeoutMs: 90000,
    fetch: (url, init = {}) => fetch(url, {
      ...init,
      signal: init.signal ? AbortSignal.any([abort.signal, init.signal]) : abort.signal,
    }),
  })
  const store = new Store(config.dataDir, config.initialCursor)
  let transport
  try {
    transport = new NativeTransport({ client, store, config, signal: abort.signal, log })
  } catch (error) {
    store.close()
    throw error
  }
  let closing
  return {
    native: transport,
    start: () => transport.start(),
    abort: () => abort.abort(),
    close() {
      abort.abort()
      return closing ??= transport.settle().finally(() => store.close())
    },
  }
}
