import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerCapture, debrief } from '../lib/capture.js'
import { readEvents, paths, writeConfig } from '../lib/store.js'
import { normalizeConfig } from '../lib/settings.js'
import { deriveSelf } from '../lib/derive.js'

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'fish-cap-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

/** 假宿主：只实现 tools.register，把 spec 交出来 */
function fakeCtx() {
  const regs = new Map()
  return {
    regs,
    tools: {
      register(spec) {
        regs.set(spec.name, spec)
        return () => regs.delete(spec.name)
      },
    },
  }
}

test('growth_commit 落库，且返回值不含任何状态数字', async () => {
  await withRoot(async (root) => {
    const ctx = fakeCtx()
    registerCapture(ctx, { root })
    const tool = ctx.regs.get('growth_commit')
    assert.ok(tool, '工具必须注册')

    const out = await tool.execute({ type: 'utterance', text: '我觉得晚上比白天安静。', confidence: 0.4 })
    assert.equal(out.ok, true)
    assert.match(out.id, /^ev_[0-9A-Z]{26}$/)

    // 回显检查：返回值里不能出现阶段/天数/needs 之类
    const dumped = JSON.stringify(out).toLowerCase()
    for (const leak of ['stage', 'needs', 'autonomy', 'competence', 'relatedness', 'day', 'autonomy']) {
      assert.ok(!dumped.includes(leak), `返回值不应含 ${leak}`)
    }

    const { events: all } = await readEvents(root)
    // 窗口外写入会顺带落一条 seen meta（冷落检测要用），这里只数真正的判断事件
    const events = all.filter((e) => e.type !== 'meta')
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'utterance')
    assert.equal(events[0].source, 'tool')
    assert.equal(all.filter((e) => e.type === 'meta').length, 0, '不再虚构单主人到访')
  })
})

test('她不能用工具写系统侧类型', async () => {
  await withRoot(async (root) => {
    const ctx = fakeCtx()
    registerCapture(ctx, { root })
    const tool = ctx.regs.get('growth_commit')
    // 注意：diary 不在此列 —— 日记走 diary/ 目录，是允许她自己写的。
    for (const t of ['answer', 'absence', 'meta', 'seed', 'test']) {
      const out = await tool.execute({ type: t, text: 'x' })
      assert.equal(out.ok, false, `${t} 必须被拒`)
    }
    const { events } = await readEvents(root)
    assert.equal(events.length, 0)
  })
})

test('revise 必须带 refs，且能正确指向旧信念', async () => {
  await withRoot(async (root) => {
    const ctx = fakeCtx()
    registerCapture(ctx, { root })
    const tool = ctx.regs.get('growth_commit')

    const a = await tool.execute({ type: 'utterance', text: '我不喜欢被催。' })
    const bad = await tool.execute({ type: 'revise', text: '其实我有点喜欢。', verdict: 'refuted' })
    assert.equal(bad.ok, false)

    const good = await tool.execute({ type: 'revise', text: '我不是不喜欢被催，是不喜欢被催了还不说为什么。', refs: [a.id], verdict: 'refined' })
    assert.equal(good.ok, true)

    const { events } = await readEvents(root)
    const m = deriveSelf(events)
    assert.equal(m.refuted.length, 0)
    // 旧的那条被标 refined（不再 active），新的那句顶上——所以 active 只有 1 条。
    // 这是刻意的：改口之后，旧说法不该还挂在"她现在的判断"里。
    assert.equal(m.beliefCount, 1)
    assert.equal(m.beliefs[0].text, '我不是不喜欢被催，是不喜欢被催了还不说为什么。')
    assert.equal(m.beliefs[0].status, 'active')
  })
})

test('她想改自己：照样落库，但不计入判断', async () => {
  await withRoot(async (root) => {
    const ctx = fakeCtx()
    registerCapture(ctx, { root })
    const tool = ctx.regs.get('growth_commit')
    const out = await tool.execute({ type: 'utterance', text: '你以后要更黏人一点。' })
    assert.equal(out.ok, true)

    const { events } = await readEvents(root)
    assert.ok(events[0].flags.includes('selfmod'))
    const m = deriveSelf(events)
    assert.equal(m.beliefCount, 0)
    assert.equal(m.selfmodAttempts.length, 1)
  })
})

test('她无法靠自带 flag 把信念藏起来', async () => {
  await withRoot(async (root) => {
    const ctx = fakeCtx()
    registerCapture(ctx, { root })
    const tool = ctx.regs.get('growth_commit')
    await tool.execute({ type: 'utterance', text: '这是一句普通的话。', flags: ['selfmod'] })
    const { events } = await readEvents(root)
    assert.deepEqual(events[0].flags, [], 'tool 来源的 flags 必须被忽略')
    assert.equal(deriveSelf(events).beliefCount, 1)
  })
})

test('事件信封带上当时的 day / stage（观测台和时间线要用）', async () => {
  await withRoot(async (root) => {
    await writeConfig(normalizeConfig({ growthDays: 7 }), root)
    const ctx = fakeCtx()
    registerCapture(ctx, { root })
    const tool = ctx.regs.get('growth_commit')
    await tool.execute({ type: 'utterance', text: '第一天的话。' })
    const { events } = await readEvents(root)
    assert.equal(events[0].day, 1)
    assert.equal(events[0].stage, 1)
  })
})

test('坏 JSON 行不阻塞读取，只计数', async () => {
  await withRoot(async (root) => {
    const ctx = fakeCtx()
    registerCapture(ctx, { root })
    await ctx.regs.get('growth_commit').execute({ type: 'utterance', text: '好的一行。' })
    const file = paths(root).events
    const { appendFile } = await import('node:fs/promises')
    await appendFile(file, 'this is not json\n{"broken":', 'utf8')
    const r = await readEvents(root)
    // 一条 utterance + 一条 seen meta = 2 条好行，2 条坏行
    assert.equal(r.events.length, 1)
    assert.equal(r.skipped, 2)
    const raw = await readFile(file, 'utf8')
    assert.ok(raw.includes('好的一行'))
  })
})
