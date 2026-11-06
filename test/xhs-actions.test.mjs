import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { xhsSettings, actionNames } from '../lib/xhs/config.js'
import { registerGallery } from '../lib/gallery-tools.js'
import { changeGallery } from '../lib/gallery.js'
import { xhsClient } from '../lib/xhs/provider.js'
import { createXhs } from '../lib/xhs/index.js'
import { reserveTime } from '../lib/xhs/policy.js'
import { NativeTransport } from '../lib/wechat/transport.js'
import { writeConfig } from '../lib/store.js'
import { Store } from '../lib/wechat/store.js'
import { scopeRoot } from '../lib/scope.js'

const target = { accountId:'wechat-account',groupId:'123@chatroom',name:'读书群',scene:'group' }
const raw={accountId:'fish',ownerId:'owner',enabled:true}
const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l0cAAAAASUVORK5CYII='
const notice = { id: 'notification1', type: 'mention/comment', from: {user_id:'owner'}, feed_id: 'post1',
  comment_id: 'comment1', feed_xsec_token: 'private-handle', comment_text: '看看' }

test('content policy handles ambiguous previews, blocked searches, and real note kinds before model projection', async () => {
  let detail, reads = 0
  const feeds = [
    { id:'vid', xsecToken:'v', noteCard:{type:'video',displayTitle:'影片'} },
    { id:'amb', xsecToken:'a', noteCard:{type:'normal',displayTitle:'未确认的标题'} },
    { id:'no', xsecToken:'n', noteCard:{type:'text',displayTitle:'藏着ＡＤ'} },
    { id:'ok', xsecToken:'o', noteCard:{type:'text',displayTitle:'随笔'} },
  ]
  const req = async (url) => {
    if (url.pathname.endsWith('/status')) return Response.json({success:true,data:{is_logged_in:true,user_id:'fish'}})
    reads++
    const data=url.pathname.endsWith('/detail') ? {feed_id:'amb',data:{note:detail}} : {feeds}
    return Response.json({success:true,data})
  }
  const client=xhsClient({...raw,allowedTypes:['text'],blockedWords:['ad']},new AbortController().signal,req)
  await assert.rejects(client.list('Ａd'),/过滤/)
  assert.equal(reads,0)
  assert.deepEqual((await client.list()).map(i=>i.title), ['待读取核实类型','随笔'])
  detail={noteId:'amb',type:'normal',imageList:[{}],desc:'图文'}
  await assert.rejects(client.read('amb','handle'),e=>e.code==='XHS_FILTERED')
  detail.imageList=[]; detail.desc='纯文 AD'
  await assert.rejects(client.read('amb','handle'),e=>e.code==='XHS_FILTERED')
  detail.desc='纯文正文';assert.equal((await client.read('amb','handle')).text,'纯文正文')
  delete detail.imageList
  await assert.rejects(client.read('amb','handle'),e=>e.code==='XHS_FILTERED')
})

test('daily time is reserved durably, refunded only for actual completion and split at local midnight', async t => {
  const root=await mkdtemp(join(tmpdir(),'fish-budget-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const file=join(root,'usage.sqlite'), now=Date.parse('2026-11-06T23:59:55+08:00')
  let db=new DatabaseSync(file)
  db.exec('CREATE TABLE browsing_time(day TEXT PRIMARY KEY,ms INTEGER NOT NULL)')
  const first=reserveTime(db,1,'Asia/Shanghai',now)
  assert.equal(first.duration,5000)
  first.finish(now+1200)
  assert.equal(db.prepare('SELECT ms FROM browsing_time').get().ms,1200)
  const midnight=now+5000
  assert.equal(reserveTime(db,1,'Asia/Shanghai',midnight).duration,60000)
  db.close(); db=new DatabaseSync(file)
  assert.equal(reserveTime(db,1,'Asia/Shanghai',midnight+1000),null)
  assert.equal(reserveTime(db,0,'Asia/Shanghai',midnight+86400000),null)
  db.close()
})

async function runFixture(t, {reason='completed', publishUnknown=false, grant=actionNames, overrides={}}={}) {
  const root=await mkdtemp(join(tmpdir(),'fish-actions-'))
  t.after(()=>rm(root,{force:true,recursive:true}))
  await changeGallery(root,{action:'upload',description:'游记配图',data})
  await writeConfig({tools:{allow:['xhs_read',...grant]}},root)
  const tools=new Map(), listeners=new Set(), writes=[], shares=[]
  const config=xhsSettings({...raw,...overrides})
  let prompts=0, promptFailure, ended=false, incoming=notice
  const req=async(url,opts)=>{
    const path=url.pathname.replace('/api/v1/',''), body=opts.body && JSON.parse(opts.body)
    let data
    if(path==='login/status')data={is_logged_in:true,user_id:raw.accountId}
    else if(path==='notifications/list')data={data:{tab:'mentions',items:[incoming]}}
    else if(path==='feeds/detail')data={feed_id:'post1',data:{note:{noteId:'post1',title:'游记',desc:'正文',type:'normal',imageList:[{}]}}}
    else {
      assert.equal(ended,true,'external write before turn/end')
      writes.push([path,body])
      if(path==='fish/publish'&&publishUnknown)throw Error('lost response')
      data=path==='fish/publish'?{status:'发布完成',title:body.title,images:1}:{success:true,feed_id:'post1',target_comment_id:incoming.comment_id}
    }
    return Response.json({success:true,data})
  }
  const ctx={
    tools:{register(tool){tools.set(tool.name,tool);return ()=>tools.delete(tool.name)}},
    get:()=>({list:()=>[],create:async()=>({id:'home'})}),
    on(_name,fn){listeners.add(fn);return ()=>listeners.delete(fn)},
    sessionController:{
      create:async()=>({sessionId:'fish-session'}),
      async prompt(req) {
        prompts++
        const exec={agent:{session:{id:req.sessionId,cwd:join(root,'home')}}}
        const emit=(type,data)=>{for(const f of listeners)f({id:req.sessionId},{type,data:{turn:prompts,...data}})}
        emit('turn/start',{});emit('user/message',{source:{rpcId:req.requestId}})
        try {
          const priorWrites=writes.length
          const call=(name,args)=>tools.get(name).execute(args,exec)
          assert.throws(()=>call('xhs_comment',{feedId:'invented',text:'无效'}))
          assert.throws(()=>call('xhs_comment',{feedId:'post1',commentId:'other',text:'无效'}))
          assert.deepEqual(call('xhs_comment',{feedId:'post1',commentId:incoming.comment_id,text:'谢谢分享'}),{staged:true})
          const list=await call('fish_gallery',{action:'search',query:'游记'})
          assert.equal(list.images[0].galleryNo,1)
          assert.throws(()=>call('xhs_publish',{title:'选择配图',text:'一段正文',galleryNos:[9]}))
          if(grant.includes('xhs_publish'))call('xhs_publish',{title:'观察笔记',text:'今天读到一段游记。',galleryNos:[1]})
          else assert.throws(()=>call('xhs_publish',{title:'a',text:'b',galleryNos:[1]}),/授权/)
          assert.equal(call('xhs_share',{action:'targets'}).targets[0].targetNo,1)
          call('xhs_share',{action:'send',targetNo:1,feedId:'post1'})
          assert.equal(writes.length,priorWrites)
        } catch(e){promptFailure=e}
        ended=true;emit('turn/end',{reason:{kind:reason}})
      },
    },
  }
  registerGallery(ctx,{root,tenant:{root,tenant:{ok:true}}})
  const fixture={
    root,writes,shares,nextMention() { incoming={...notice,id:'notice2',comment_id:'comment2'} },open() {
      return createXhs(ctx,config,{root,allow:['xhs_read',...grant],tenancy:{root,tenant:{ok:true}},request:req,
        native:()=>({shareTargets:()=>[target],canShareXhs:t=>t.groupId===target.groupId,shareXhs:(dest,id,_key,live)=>{
          assert.ok(ended&&live());shares.push({dest,id})
        }})})
    },check(){if(promptFailure)throw promptFailure},get prompts(){return prompts}
  }
  return fixture
}

test('external operations execute after completion, bind the verified targets and suppress replay after an unknown publish', async t=>{
  const f=await runFixture(t,{publishUnknown:true})
  const r=f.open()
  try {
    await r.tick();f.check()
    assert.deepEqual(f.writes,[
      ['feeds/comment/reply',{feed_id:'post1',xsec_token:'private-handle',comment_id:'comment1',content:'谢谢分享'}],
      ['fish/publish',{title:'观察笔记',content:'今天读到一段游记。',images:[{mime:'image/png',data}]}],
    ])
    assert.deepEqual(f.shares,[{dest:target,id:'post1'}])
    assert.deepEqual(r.recentActions().map(a=>a.status),['accepted','unknown','accepted'])
  } finally {await r.dispose()}
  const file=join(scopeRoot(f.root,{scene:'xhs',accountId:'fish'}),'activity.sqlite')
  const db=new DatabaseSync(file)
  // Simulate a crash between dispatching actions and acknowledging the notification.
  db.prepare('UPDATE mentions SET payload=?').run(JSON.stringify({id:'notification1',feedId:'post1',commentId:'comment1',
    text:'看看',token:'private-handle',senderId:'owner'}));db.close()
  const again=f.open()
  try {await again.tick();f.check();assert.equal(f.writes.length,2);assert.equal(f.shares.length,1)}finally{await again.dispose()}
})

test('incomplete turns send nothing; missing individual grant denies the corresponding tool',async t=>{
  const f=await runFixture(t,{reason:'aborted',grant:['xhs_comment','xhs_share']})
  const r=f.open()
  try {await assert.rejects(r.tick(),/did not complete/);f.check();assert.equal(f.writes.length,0);assert.equal(f.shares.length,0)}
  finally {await r.dispose()}
})

test('zero daily budget does not poll, prompt or submit', async t=>{
  const f=await runFixture(t,{overrides:{dailyMinutes:0}}),r=f.open()
  try {await r.tick();assert.equal(f.prompts,0);assert.equal(f.writes.length,0)}finally{await r.dispose()}
})

test('Native link sharing pins account and group, checks revocation at submission, and reconciles the exact receipt',async t=>{
  const root=await mkdtemp(join(tmpdir(),'fish-share-'));const store=new Store(root)
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true})})
  let revoke=false;const sent=[]
  const native=new NativeTransport({config:{accountId:target.accountId,selfId:'bot',sending:true,
    groups:[{id:target.groupId}],contacts:[]},store,signal:new AbortController().signal,client:{
      account:async()=>({ownUsername:'bot',authenticated:true}), group:async()=>({roomId:target.groupId,isInGroup:true}),
      sendByKey:async()=>{if(revoke)native.setSending(false);throw Object.assign(Error(),{status:404})},
      sendText:async(accountId,destination,text)=>{sent.push(text);return {id:'receipt',accountId,destination,state:'accepted'}}
    }})
  native.verified=true;native.reachable.add(target.groupId)
  for(const invalid of [{...target,groupId:'contact'},{...target,accountId:'other'}])
    await assert.rejects(native.shareXhs(invalid,'post','turn1',()=>true))
  await native.shareXhs(target,'post','turn1',()=>true)
  await native.shareXhs(target,'post','turn1',()=>true)
  revoke=true;await assert.rejects(native.shareXhs(target,'another','turn2',()=>true))
  assert.deepEqual(sent,['https://www.xiaohongshu.com/explore/post'])
})

test('legacy action limits no longer prevent a new decision on a different notification', async t=>{
  const f=await runFixture(t,{overrides:{dailyActionLimit:1}})
  const r=f.open()
  try {await r.tick();f.check()}finally{await r.dispose()}
  f.nextMention()
  const second=f.open()
  try {
    await second.tick();f.check()
    assert.equal(f.writes.length,4);assert.equal(f.shares.length,2)
    assert.deepEqual(second.recentActions().slice(0,3).map(a=>a.status),['accepted','accepted','accepted'])
  }finally{await second.dispose()}
})

test('plain comment requires a verified account and matching API receipt',async()=>{
  let account='different', result, submitted=0
  const client=xhsClient(raw,new AbortController().signal,async(url,opts)=>{
    if(url.pathname.endsWith('/status'))return Response.json({success:true,data:{is_logged_in:true,user_id:account}})
    assert.ok(url.pathname.endsWith('/feeds/comment'))
    assert.deepEqual(JSON.parse(opts.body),{feed_id:'post1',xsec_token:'signed-handle',content:'读过了'})
    return Response.json({success:true,data:result})
  })
  const plan={feedId:'post1',token:'signed-handle',text:'读过了'}
  const reserve=()=>{submitted++}
  await assert.rejects(client.comment(plan,reserve),/identity/)
  assert.equal(submitted,0)
  account=raw.accountId;result={feed_id:'other',success:true}
  await assert.rejects(client.comment(plan,reserve),/需核对/)
  result.feed_id='post1';await client.comment(plan,reserve);assert.equal(submitted,2)
})
