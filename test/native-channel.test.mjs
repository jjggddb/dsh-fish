import {test} from 'node:test'
import assert from 'node:assert/strict'
import {directedAtFish,quietAt} from '../lib/native-channel.js'
test('Native channel policy recognizes true mentions, aliases, and replies to the fish',()=>{
  assert.equal(directedAtFish({body:'普通闲聊',mentions:{self:false}},'bot'),false)
  assert.equal(directedAtFish({body:'在吗',mentions:{self:true}},'bot'),true)
  assert.equal(directedAtFish({body:'大肥鱼在吗'},'bot'),true)
  assert.equal(directedAtFish({body:'为什么',quote:{senderId:'bot'}},'bot'),true)
  assert.equal(directedAtFish({body:'为什么',quote:{senderId:'other'}},'bot'),false)
})
test('quiet hours remain China midnight to 08:00',()=>{
  assert.equal(quietAt(new Date('2026-11-05T16:00:00Z')),true)
  assert.equal(quietAt(new Date('2026-11-05T23:59:00Z')),true)
  assert.equal(quietAt(new Date('2026-11-06T00:00:00Z')),false)
})
