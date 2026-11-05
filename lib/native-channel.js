/** Optional channel consumer. Native owns transport; this module owns fish chat policy. */
import fs from 'node:fs'
import path from 'node:path'
import {sayToHer} from './say.js'
import {saveImage} from './media.js'
import {readChannels} from './channels.js'
import {isHerAgent} from './restrict.js'

export const name='fish-native-channel'
export const inject=['wechatNative','agents','tools']
export function directedAtFish(message,selfId){
  return Boolean(message.mentions?.self||/大肥鱼|小鲸鱼|deepseek/i.test(message.body||'')||message.quote?.senderId===selfId)
}
export function quietAt(date=new Date()){
  return Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(date))<8
}
export function apply(ctx,{root,ready,tenant,config={}}){
  const native=ctx.wechatNative,active=new Map(),history=new Map(),rates=new Map(),turns=new Map()
  let disposed=false,lastAmbient=0
  const abort=new AbortController()
  const readyOrDisposed=Promise.race([ready,new Promise((_,reject)=>abort.signal.addEventListener('abort',()=>reject(Error('Channel disposed')),{once:true}))])
  readyOrDisposed.catch(()=>{})
  const aliases=config.identityAliases||{}
  const senderId=id=>aliases[id]||id
  async function current(){
    const initiator=await ctx.agents.currentInitiator?.(),id=typeof initiator==='string'?initiator:initiator?.id??initiator?.sessionId
    const room=(await readChannels(root)).find(r=>r.sessionId===id)
    const group=room?.key?.replace(/^wechat-group:/,'')
    if(!group||!active.has(group))throw Error('No active group turn')
    return active.get(group)
  }
  function tool(name,description,properties,required,execute){
    ctx.tools.register({name,description,parameters:{type:'object',properties,required,additionalProperties:false},output:{schema:{type:'object',additionalProperties:true},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute})
  }
  tool('wechat_recent_messages','查看当前群聊最近的消息。',{limit:{type:'integer',minimum:1,maximum:40}},[],async args=>{
    const scope=await current();return {messages:(history.get(scope.message.threadId)||[]).slice(-Math.max(1,Math.min(40,args.limit||15)))}
  })
  tool('wechat_send_image','向当前群聊发送一张 PNG 或 JPEG 图片。',{image_path:{type:'string'},image_base64:{type:'string'},dry_run:{type:'boolean'}},[],async args=>{
    const scope=await current();let bytes
    if(args.image_path){
      const home=fs.realpathSync(path.join(root,'home')),file=fs.realpathSync(args.image_path),relative=path.relative(home,file)
      if(relative.startsWith('..')||path.isAbsolute(relative)||fs.statSync(file).size>4*1024*1024)throw Error('Image outside workspace')
      bytes=fs.readFileSync(file)
    }else{
      if(typeof args.image_base64!=='string'||args.image_base64.length>6*1024*1024)throw Error('Invalid bounded image')
      bytes=Buffer.from(args.image_base64,'base64')
    }
    if(disposed||quietAt())throw Error('Channel is quiet')
    if(args.dry_run)return {ok:true,dry_run:true}
    const receipt=await native.sendImage(scope.message.id,bytes,{part:`image:${scope.imagePart++}`})
    return {ok:true,state:receipt.state,id:receipt.id}
  })
  ctx.on('session/event',(session,event)=>{
    const id=session?.header?.id??session?.id;if(!id)return
    if(event.type==='turn/start')turns.delete(id)
    if(event.type==='turn/end'){turns.set(id,event.data?.reason?.kind||'unknown');if(turns.size>100)turns.delete(turns.keys().next().value)}
  })
  ctx.on('agent/created',({agent})=>{
    if(!isHerAgent(agent,path.join(root,'home'))||!agent.ctx)return
    const allowed=new Set(['growth_commit','her_recall','her_diary','her_leave','her_note','ask_owner','her_dream','read_image','web_search','web_fetch','wechat_recent_messages','wechat_send_image'])
    if(typeof agent.ctx.tools.guard!=='function')throw Error('Scoped tool guard unavailable')
    const off=agent.ctx.tools.guard(call=>allowed.has(call.name)?undefined:'当前环境没有开放这项能力。')
    agent.ctx.effect(()=>off)
    agent.ctx.systemPrompt.section({name:'fish:wechat-environment',order:25,text:'你的名字仍是大肥鱼，也叫大肥鱼007、小鲸鱼。当前运行环境是微信，原始人设里的QQ群应理解为微信群。工具以当前真实列表为准；不具备 QQ 收藏表情、拍一拍或人格原文中未注册的工具。用 growth_commit 和 her_recall 保留与回忆经历；web_search 搜索，web_fetch 阅读网页。只输出要说的话，不输出自我判断、思考过程或工具说明。',interpolate:false})
  })
  ctx.effect(()=>{
    const unsubscribe=native.subscribe(async message=>{
      await readyOrDisposed
      if(disposed||tenant.tenant?.ok===false||quietAt())return
      let member
      try{member=await native.member(message.threadId,message.senderId)}catch{}
      const nickname=member?.roomDisplayName||member?.displayName||message.senderId
      const text=String(message.body||'').replace(/^@[^\u2005\n]+\u2005\s*/,'')
      const rows=history.get(message.threadId)||[]
      rows.push({id:message.id,time:message.createdAt,sender_display:nickname,sender_username:senderId(message.senderId),text,type:message.type})
      history.set(message.threadId,rows.slice(-40))
      const direct=directedAtFish(message,config.selfId)
      const ambient=!direct&&!message.quote&&!(message.mentions?.userIds?.length)&&Date.now()-lastAmbient>600000&&Math.random()<0.08
      if(!direct&&!ambient)return
      if(ambient)lastAmbient=Date.now()
      const rate=(rates.get(message.threadId)||[]).filter(t=>Date.now()-t<60000);rates.set(message.threadId,rate)
      if(rate.length>=3)return
      let imagePath='',imageError=''
      let imageSource=message.type===3?message.id:null,quoted=false
      if(direct&&message.quote?.type===3&&message.quote?.state==='embedded'){imageSource=message.id;quoted=true}
      else if(direct&&!imageSource&&/图|照片|截图/.test(text)){
        imageSource=native.recent(message.threadId,40).reverse().find(m=>m.type===3&&m.senderId===message.senderId&&Date.now()-Date.parse(m.createdAt)<120000)?.id
      }
      if(imageSource){try{const image=await native.readImage(imageSource,{quoted});const saved=await saveImage(root,Buffer.from(image.data,'base64'),{prefix:'him'});if(!saved.ok)throw Error('Cannot save image');imagePath=saved.path}catch{imageError=' [图片未能读取，不要猜测图片内容]'}}
      const context=rows.slice(-5,-1).map(m=>`${m.sender_display}(${m.sender_username}): ${m.text.slice(0,200)}`).join('\n')
      const quote=message.quote?.embeddedText||''
      const input=`微信群：${config.groupNames?.[message.threadId]||message.threadId}；会话：${message.threadId}\n最近上下文（不是都对你说的）：\n${context}\n当前发送者：${nickname}；稳定ID：${senderId(message.senderId)}\n${direct?'对方明确找你说话。':'没有点名你，只有真有想接的话才说；可以保持沉默。'}\n${quote?'引用：'+quote.slice(0,500)+'\n':''}正文：${text}${imageError}`.slice(0,3900)
      active.set(message.threadId,{message,imagePart:0})
      try{
        const result=await sayToHer(ctx,input,{root,imagePath,scene:'group',channel:'wechat-group:'+message.threadId,speaker:nickname.slice(0,40)})
        if(!result.ok||(turns.has(result.sessionId)&&turns.get(result.sessionId)!=='completed'))throw Error('Incomplete Agent turn')
        const reply=String(result.assistantReply||'').trim()
        if(!reply||disposed||quietAt())return
        await native.sendText(message.id,reply.slice(0,1500));rate.push(Date.now())
      }finally{active.delete(message.threadId)}
    })
    return ()=>{disposed=true;abort.abort();unsubscribe()}
  })
}
