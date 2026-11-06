import { readEvents, paths, listDiary, readDaily } from './store.js'
import { loadConfig } from './settings.js'
import { deriveSelf, consistency, novelty } from './derive.js'
import { countEvents } from './meta.js'
import { buildStances, gatesDone } from './stance.js'
import { stability, stabilityBand } from './quality.js'
import { scopeRoot } from './scope.js'
import { readChannels } from './channels.js'
import { avatarInfo } from './avatar.js'

export async function settingsState(root) {
  const [{ events, skipped }, { config }] = await Promise.all([readEvents(root), loadConfig(root)])
  const opts = { growthDays: config.growthDays }
  const m = deriveSelf(events, opts)
  const stable = stability(events, opts, {
    shown: config.memory.beliefsShown,
    budget: config.memory.docBudget,
  })
  const counts = countEvents(events)
  for (const name of ['utterance', 'revise', 'refusal', 'reunion'])
    counts[name] = events.filter((e) => e.type === name).length
  return {
    day: m.day,
    growthDays: m.growthDays,
    stage: m.stage,
    stageName: m.stageName,
    pendingGate: m.stageGate.pending,
    name: m.name,
    counts,
    skipped,
    seed: m.seed,
    beliefs: m.ranked.map(({ id, text }) => ({ id, text })),
    tensions: m.tensions.length,
    scars: m.scarCount,
    stances: buildStances(m).length,
    stanceReady: gatesDone(m),
    avatar: avatarInfo(root),
    quality: {
      stability: { ...stable, band: stabilityBand(stable) },
      consistency: consistency(events),
      novelty: novelty(events),
    },
    paths: { root, home: paths(root).herDir, config: paths(root).config },
  }
}

export async function settingsDiary(root, params) {
  const { config } = await loadConfig(root)
  if (!config.diary.visible) return { visible: false, dates: [] }
  let directory = root
  const key = params.get('channel')
  if (key) {
    const room = (await readChannels(root)).find((r) => r.key === key && r.accountId && (r.groupId || r.scene === 'xhs'))
    if (!room) throw Error('会话不存在')
    directory = scopeRoot(root, room)
  }
  const dates = await listDiary(directory)
  const date = params.get('date') || dates[0]
  return {
    visible: true,
    dates,
    date,
    text: dates.includes(date) ? await readDaily('diaryDir', date, directory) : '',
  }
}
