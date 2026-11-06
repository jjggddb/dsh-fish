import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {setTimeout as delay} from 'node:timers/promises'
import {NativeWeChatClient} from '../lib/wechat/sdk/native-client.js'
import {Store} from '../lib/wechat/store.js'
import {NativeTransport} from '../lib/wechat/transport.js'

function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'native-test-')),store=new Store(dir),abort=new AbortController()
  const config={accountId:'account-test',selfId:'bot',groups:[{id:'123@chatroom',name:'Test group'}],sending:true,maxMessageAgeMs:300000}
  const messages=new Map(),receipts=new Map();let submitted=0
  const client={
    account:async()=>({ownUsername:'bot',authenticated:true}),group:async()=>({roomId:'123@chatroom',displayName:'Test group',isInGroup:true}),
    message:async(_a,id)=>messages.get(id),groupMember:async(_a,groupId,username)=>({groupId,username,member:{username,mentionName:'User'}}),
    sendByKey:async(_a,key)=>{if(!receipts.has(key))throw Object.assign(Error('not found'),{status:404});return receipts.get(key)},
    sendText:async(accountId,destination,text,key)=>{submitted++;const receipt={id:'send-'+submitted,accountId,destination,state:'accepted',text};receipts.set(key,receipt);return receipt},
    upload:async(_a,bytes)=>({id:'source-image',sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length}),
    sendMedia:async(accountId,input,key)=>{submitted++;const receipt={id:'image-'+submitted,accountId,...input,state:'accepted'};receipts.set(key,receipt);return receipt},
  }
  const transport=new NativeTransport({client,store,config,signal:abort.signal})
  const message=(id='message-1',extra={})=>{const m={id,accountId:config.accountId,threadId:'123@chatroom',senderId:'person',body:'普通闲聊',direction:'incoming',createdAt:new Date().toISOString(),type:1,mentions:{self:false,userIds:[]},...extra};messages.set(id,m);return m}
  const event=(m,cursor='1')=>({accountId:config.accountId,cursor,kind:'message.committed',data:{messageId:m.id,threadId:m.threadId,origin:'live'}})
  t.after(async()=>{abort.abort();await transport.settle();store.close();rmSync(dir,{recursive:true,force:true})})
  return {dir,store,abort,config,client,transport,message,event,receipts,submitted:()=>submitted}
}
test('every authorized live group message is delivered without @ or persona policy',async t=>{
  const f=fixture(t),seen=[];await f.transport.verify();f.transport.subscribe(async m=>seen.push(m.id))
  const a=f.message();await f.transport.ingest(f.event(a));await f.transport.draining
  await f.transport.ingest(f.event(a,'2'));await f.transport.draining
  assert.deepEqual(seen,[a.id]);assert.equal(f.store.cursor(),'2');assert.deepEqual(f.store.stats(),{done:1})
})
test('wrong account and wrong group cannot become an outbound destination',async t=>{
  const f=fixture(t);f.client.account=async()=>({ownUsername:'someone-else',authenticated:true})
  await assert.rejects(f.transport.verify(),/account_not_ready/);assert.equal(f.transport.verified,false)
  f.client.account=async()=>({ownUsername:'bot',authenticated:true});await f.transport.verify()
  const m=f.message('other',{threadId:'456@chatroom'});await f.transport.ingest(f.event(m));assert.equal(f.store.message(m.id),null)
  await assert.rejects(f.transport.sendText(m.id,'hello'),/Unknown authorized/);assert.equal(f.submitted(),0)
})
test('mismatched Native projection does not advance the durable cursor',async t=>{
  const f=fixture(t);await f.transport.verify();const m=f.message();f.client.message=async()=>({...m,threadId:'456@chatroom'})
  await assert.rejects(f.transport.ingest(f.event(m)),/message_identity/);assert.equal(f.store.cursor(),'0')
})
test('self, stale, and historical messages advance cursor without becoming pending replies',async t=>{
  const f=fixture(t);await f.transport.verify()
  for(const [index,extra] of [{senderId:'bot'},{createdAt:'2000-01-01T00:00:00Z'},{direction:'outgoing'}].entries()){const m=f.message('m'+index,extra);await f.transport.ingest(f.event(m,String(index+1)))}
  const m=f.message('historical');const e=f.event(m,'4');e.data.origin='history';await f.transport.ingest(e)
  assert.deepEqual(f.store.stats(),{});assert.equal(f.store.cursor(),'4')
})
test('parallel retries submit once, refuse changed payload, and survive restart state',async t=>{
  const f=fixture(t);await f.transport.verify();const m=f.message();await f.transport.ingest(f.event(m))
  const replies=await Promise.all([f.transport.sendText(m.id,'hello'),f.transport.sendText(m.id,'hello')])
  assert.equal(f.submitted(),1);assert.equal(replies[0].id,replies[1].id)
  await assert.rejects(f.transport.sendText(m.id,'different'),/different payload/)
  const reopened=new Store(f.dir);t.after(()=>reopened.close());assert.equal(reopened.cursor(),'1');assert.ok(reopened.message(m.id))
})
test('ambiguous submission recovers the same key without sending again',async t=>{
  const f=fixture(t),send=f.client.sendText;await f.transport.verify();const m=f.message();await f.transport.ingest(f.event(m))
  f.client.sendText=async(...args)=>{await send(...args);throw Error('network lost after acceptance')}
  const reply=await f.transport.sendText(m.id,'hello');assert.equal(reply.state,'accepted');assert.equal(f.submitted(),1)
})
test('recalled source, disabled sending, and foreign quote fail before submission',async t=>{
  const f=fixture(t);await f.transport.verify();const m=f.message();await f.transport.ingest(f.event(m))
  f.transport.setSending(false);await assert.rejects(f.transport.sendText(m.id,'hello'),/disabled/)
  f.transport.setSending(true);m.recall={state:'recalled'};await assert.rejects(f.transport.sendText(m.id,'hello'),/unavailable/)
  delete m.recall;f.message('foreign',{threadId:'456@chatroom',serverId:'123'})
  await assert.rejects(f.transport.sendText(m.id,'hello',{quoteMessageId:'foreign'}),/Quote/);assert.equal(f.submitted(),0)
})
test('image retries retain uploaded source and verify destination receipts',async t=>{
  const f=fixture(t);await f.transport.verify();const m=f.message();await f.transport.ingest(f.event(m))
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l0cAAAAASUVORK5CYII=','base64')
  await f.transport.sendImage(m.id,png);await f.transport.sendImage(m.id,png);assert.equal(f.submitted(),1)
  f.client.sendText=async()=>({id:'evil',accountId:f.config.accountId,destination:'456@chatroom',state:'accepted'})
  await assert.rejects(f.transport.sendText(m.id,'hello'),/Receipt identity/)
})
test('pending state persists, interrupted work is not automatically replayed, account binding is enforced',async t=>{
  const f=fixture(t);await f.transport.verify();const m=f.message();await f.transport.ingest(f.event(m,'90071992547409930'));f.store.mark(m.id,'processing')
  const reopened=new Store(f.dir);try{assert.equal(reopened.cursor(),'90071992547409930');assert.equal(reopened.next(),undefined);assert.deepEqual(reopened.stats(),{interrupted:1});assert.throws(()=>reopened.bind('other','bot'),/different account/)}finally{reopened.close()}
})
test('real SDK SSE reconnect resumes the committed cursor and abort closes the stream',async t=>{
  const f=fixture(t),m=f.message(),requests=[],received=[]
  const server=createServer((request,response)=>{
    assert.equal(request.headers.authorization,'Bearer test-token')
    const cursor=new URL(request.url,'http://localhost').searchParams.get('after');requests.push(cursor)
    response.writeHead(200,{'content-type':'text/event-stream'})
    if(requests.length===1){const frame='id: 1\r\nevent: message.committed\r\ndata: '+JSON.stringify(f.event(m))+'\r\n\r\n';response.write(frame.slice(0,23));response.end(frame.slice(23))}
    else response.write(': connected\n\n')
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>{server.closeAllConnections();server.close()})
  const sdk=new NativeWeChatClient({baseUrl:`http://127.0.0.1:${server.address().port}/`,token:'test-token'})
  f.client.watch=sdk.watch.bind(sdk);f.transport.subscribe(async value=>received.push(value.id));f.transport.start()
  const deadline=Date.now()+6000
  while(requests.length<2&&Date.now()<deadline)await delay(20)
  f.abort.abort();await f.transport.settle()
  assert.deepEqual(requests,['0','1']);assert.deepEqual(received,[m.id]);assert.equal(f.store.cursor(),'1')
})
test('second consumer is rejected and unsubscribed messages remain durable',async t=>{
  const f=fixture(t);await f.transport.verify();const off=f.transport.subscribe(async()=>{})
  assert.throws(()=>f.transport.subscribe(async()=>{}),/one response consumer/)
  off();const m=f.message();await f.transport.ingest(f.event(m));assert.equal(f.store.next().id,m.id)
})
test('bounded concurrent delivery lets Fish merge messages but only acknowledges completed consumers',async t=>{
 const f=fixture(t);await f.transport.verify()
 for(let i=1;i<=20;i++){const m=f.message('m'+i);await f.transport.ingest(f.event(m,String(i)))}
 let release;const gate=new Promise(r=>release=r),seen=[]
 f.transport.subscribe(async m=>{seen.push(m.id);await gate})
 await delay(10);assert.equal(seen.length,16);assert.equal(f.store.stats().processing,16)
 release();await f.transport.draining
 assert.equal(seen.length,20);assert.deepEqual(f.store.stats(),{done:20})
})
test('a new mention reaches Fish while sixteen ordinary inbox callbacks are still pending',async t=>{
 const f=fixture(t);await f.transport.verify()
 for(let i=1;i<=16;i++)await f.transport.ingest(f.event(f.message('casual'+i),String(i)))
 let release;const gate=new Promise(r=>release=r),seen=[]
 f.transport.subscribe(async m=>{seen.push(m.id);if(m.id!=='direct')await gate})
 const m=f.message('direct',{mentions:{self:true,userIds:['bot']}})
 try {
   await f.transport.ingest(f.event(m,'17'))
   for(let i=0;i<30&&!seen.includes('direct');i++)await delay(5)
   assert.ok(seen.includes('direct'))
 } finally {release();await f.transport.draining}
})
test('new input between preparing a reply and submission prevents the external send',async t=>{
 const f=fixture(t);await f.transport.verify()
 const first=f.message('question');await f.transport.ingest(f.event(first,'1'))
 const lookup=f.client.sendByKey
 f.client.sendByKey=async(...args)=>{
   const newer=f.message('clarification');await f.transport.ingest(f.event(newer,'2'))
   return lookup(...args)
 }
 await assert.rejects(f.transport.sendText(first.id,'obsolete',{beforeSubmit:()=>!f.transport.newerInput(first.threadId,[first.id],{pendingOnly:true})}),e=>e.code==='STALE_REPLY')
 assert.equal(f.submitted(),0)
})
test('Native 1.5.1 quote sidecars and original images without previews produce real attachment bytes',async t=>{
 const f=fixture(t);await f.transport.verify()
 for(const [i,quoted] of [false,true].entries()){
  const m=f.message('pic'+i,quoted?{type:49,quote:{embeddedImage:true,type:3,serverId:'12'}}:{type:3})
  await f.transport.ingest(f.event(m,String(i+1)))
  f.client.mediaAssets=async()=>({items:[{id:'asset',messageId:m.id,accountId:m.accountId,kind:'image',state:'available',variant:'original'}]})
  f.client.mediaContent=async(_a,_id,o)=>{assert.equal(o.representation,'original');return {bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l0cAAAAASUVORK5CYII=','base64')}}
  const r=await f.transport.readImage(m.id,{quoted});assert.equal(r.mimeType,'image/png')
 }
})
