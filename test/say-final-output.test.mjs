import {test} from 'node:test'
import assert from 'node:assert/strict'
import {beginTurnWait} from '../lib/say.js'

test('reply belongs to the requested turn and excludes reasoning and tool chatter',async()=>{
  let listener
  const ctx={on(_name,fn){listener=fn;return()=>{listener=null}}}
  const w=beginTurnWait(ctx,'room',1000,'request-2')
  const emit=(type,data)=>listener?.({header:{id:'room'}},{type,data})
  emit('turn/start',{turn:1})
  emit('user/message',{source:{rpcId:'unrelated'}})
  emit('assistant/message',{turn:1,message:{content:[{type:'text',text:'wrong room wake'}]}})
  emit('turn/end',{turn:1})
  assert.ok(listener)
  emit('turn/start',{turn:2})
  emit('user/message',{source:{rpcId:'request-2'}})
  emit('assistant/message',{turn:2,message:{content:[{type:'text',text:'checking'},{type:'tool-call',name:'web_search'}]}})
  emit('assistant/message',{turn:2,message:{content:[{type:'reasoning',text:'private thought'},{type:'text',text:'本鲸爱吃白饭。'}]}})
  emit('turn/end',{turn:2})
  await w.wait()
  assert.equal(w.reply(),'本鲸爱吃白饭。')
  assert.equal(listener,null)
})

test('a completed silent turn has no outbound text',async()=>{
  let listener
  const ctx={on(_name,fn){listener=fn;return()=>{}}}
  const w=beginTurnWait(ctx,'room',1000,'request')
  for(const [type,data] of [['turn/start',{turn:1}],['user/message',{source:{rpcId:'request'}}],['turn/end',{turn:1}]]) listener({id:'room'},{type,data})
  await w.wait();assert.equal(w.reply(),'')
})
