/** Runtime limits only. Persona lives in the append-only event stream. */
import { readConfig, writeConfig } from './store.js'
export const DEFAULTS = {
  growthDays: 30,
  diary: { enabled: true, visible: false },
  memory: { docBudget: 8000, beliefsShown: 8 },
  chat: { rotateAfter: 40, replyChars: 1500 },
  tools: { preset: '', restrict: true, allow: ['web_search', 'web_fetch'] },
  group: {
    batchMs: 1200,
    maxBatch: 16,
    maxTurnsPerHour: 60,
    maxRepliesPerMinute: 3,
    quietHours: [0, 8],
    timezone: 'Asia/Shanghai',
  },
  proactive: { enabled: false, intervalMinutes: 120, maxPerDay: 2, minIdleMinutes: 30 },
}
const n = (v, min, max, fallback) =>
  Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : fallback
export function normalizeConfig(raw = {}) {
  const d = DEFAULTS
  let timezone = String(raw.group?.timezone || d.group.timezone)
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
  } catch {
    timezone = d.group.timezone
  }
  return {
    growthDays: n(raw.growthDays, 7, 180, 30),
    diary: { enabled: raw.diary?.enabled !== false, visible: raw.diary?.visible === true },
    memory: {
      docBudget: n(raw.memory?.docBudget, 2000, 16000, 8000),
      beliefsShown: n(raw.memory?.beliefsShown, 1, 12, 8),
    },
    chat: {
      rotateAfter: n(raw.chat?.rotateAfter, 5, 100, 40),
      replyChars: n(raw.chat?.replyChars || 1500, 100, 3000, 1500),
    },
    tools: {
      preset: String(raw.tools?.preset || ''),
      restrict: true,
      allow: parseToolNames(raw.tools?.allow ?? d.tools.allow).filter((x) =>
        ['web_search', 'web_fetch'].includes(x),
      ),
    },
    group: {
      batchMs: n(raw.group?.batchMs, 50, 5000, 1200),
      maxBatch: n(raw.group?.maxBatch, 1, 16, 16),
      maxTurnsPerHour: n(raw.group?.maxTurnsPerHour, 1, 240, 60),
      maxRepliesPerMinute: n(raw.group?.maxRepliesPerMinute, 1, 6, 3),
      quietHours:
        Array.isArray(raw.group?.quietHours) && raw.group.quietHours.length === 2
          ? raw.group.quietHours.map((x) => n(x, 0, 23, 0))
          : [0, 8],
      timezone,
    },
    proactive: {
      enabled: raw.proactive?.enabled === true,
      intervalMinutes: n(raw.proactive?.intervalMinutes, 15, 1440, 120),
      maxPerDay: n(raw.proactive?.maxPerDay, 0, 12, 2),
      minIdleMinutes: n(raw.proactive?.minIdleMinutes, 5, 1440, 30),
    },
  }
}
export function parseToolNames(input) {
  return [
    ...new Set(
      (Array.isArray(input) ? input : [input])
        .flatMap((x) => String(x ?? '').split(/[,，\s]+/))
        .filter((x) => /^[a-z][a-z0-9_-]*$/.test(x)),
    ),
  ]
}
export async function loadConfig(root) {
  const raw = await readConfig(root)
  return { config: normalizeConfig(raw || {}), fresh: raw === null }
}
export async function updateConfig(patch, root) {
  const { config } = await loadConfig(root)
  const next = { ...config }
  for (const [k, v] of Object.entries(patch || {}))
    if (k in DEFAULTS)
      next[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...config[k], ...v } : v
  const normalized = normalizeConfig(next)
  await writeConfig(normalized, root)
  return normalized
}
export function dateKey(d = new Date(), timeZone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}
export function quietAt(date = new Date(), group = DEFAULTS.group) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: group.timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(date),
  )
  const [start, end] = group.quietHours
  return start === end
    ? false
    : start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end
}
