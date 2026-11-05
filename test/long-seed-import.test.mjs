import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEvent } from '../lib/schema.js'

test('system seed imports match the 6000-character handover limit', () => {
  const text = '鲸'.repeat(6000)
  const event = validateEvent({type: 'seed', text}, {day: 1, stage: 1, source: 'system'})
  assert.equal(event.text, text)
  assert.throws(() => validateEvent({type: 'seed', text: text + '鲸'}, {source: 'system'}), e => e.code === 'TOO_LONG')
})

test('long import allowance does not grant agent seed access or larger memory writes', () => {
  assert.throws(() => validateEvent({type: 'seed', text: '鲸'.repeat(3000)}, {source: 'tool'}), e => e.code === 'NOT_HER_TYPE')
  for (const source of ['tool', 'system']) {
    assert.throws(() => validateEvent({type: 'utterance', text: '鲸'.repeat(2001)}, {source}), e => e.code === 'TOO_LONG')
  }
})
