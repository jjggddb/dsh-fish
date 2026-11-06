import { directlyAddressed } from './priority.js'
import {createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'

export class NativeTransport {
  constructor({client,store,config,signal,log=()=>{}}){
    Object.assign(this,{client,store,config,signal,log})
    store.bind(config.accountId,config.selfId)
    const saved = store.targets?.()
    this.requireGroupNames = !saved
    this.replaceTargets(saved || { groups: config.groups, contacts: config.contacts || [] });this.verified=false;this.sending=config.sending===true
    this.consumer=null;this.draining=null;this.running=null;this.locks=new Map();this.lastError=null
  }
  replaceTargets(lists) {
    Object.assign(this.config, lists)
    this.groups = new Set(lists.groups.map(g => g.id))
    this.contacts = new Set(lists.contacts.map(c => c.id))
    this.reachable = new Set()
    this.memberDirectories = new Map()
  }
  permits(id) { return this.reachable.has(id) && (this.groups.has(id) || this.contacts.has(id)) }
  scene(id) { return this.contacts.has(id) ? 'private' : 'group' }
  async verify(){
    this.verified=false
    const account=await this.client.account(this.config.accountId)
    if(account.ownUsername!==this.config.selfId||account.authenticated!==true)throw Error('account_not_ready')
    const current = this.config.groups
    const valid = new Set()
    let problem
    for (const expected of this.config.groups) {
      try {
        const g = await this.client.group(this.config.accountId, expected.id, this.signal)
        if (g.roomId !== expected.id || g.isInGroup === false) throw Error('group_identity_mismatch')
        if (this.requireGroupNames && expected.name && g.displayName !== expected.name && g.name !== expected.name) throw Error('group_name_mismatch')
        valid.add(expected.id)
      } catch (error) { problem = error }
    }
    for (const expected of this.config.contacts || []) {
      try {
        const c = await this.client.contact(this.config.accountId, expected.id)
        if (c.username !== expected.id || ['blocked','deleted'].includes(c.relation)) throw Error('contact_identity_mismatch')
        valid.add(expected.id)
      } catch (error) { problem = error }
    }
    if (this.config.groups !== current) throw Error('targets_changed')
    this.reachable = valid
    if (!valid.size && problem) throw problem
    this.verified=true;this.lastError=null
  }
  start(){if(!this.running)this.running=this.loop();return this.running}
  async loop(){
    while(!this.signal.aborted){
      try{
        await this.verify();this.drain()
        for await(const event of this.client.watch(this.config.accountId,this.store.cursor(),this.signal))await this.ingest(event)
      }catch(error){if(!this.signal.aborted){this.lastError=error.code||(['account_not_ready','group_identity_mismatch','group_name_mismatch'].includes(error.message)?error.message:'connection_unavailable');this.log(this.lastError)}}
      this.verified=false
      try{await delay(3000,undefined,{signal:this.signal})}catch{break}
    }
  }
  async ingest(event){
    if(!this.verified||this.signal.aborted)throw Error('Transport not ready')
    if(event.accountId&&event.accountId!==this.config.accountId)throw Error('event_account_mismatch')
    let message=null
    if(event.kind==='message.committed'&&event.data?.messageId&&this.permits(event.data.threadId)){
      const candidate=await this.client.message(this.config.accountId,event.data.messageId)
      if(candidate.id!==event.data.messageId||candidate.accountId!==this.config.accountId||candidate.threadId!==event.data.threadId)throw Error('message_identity_mismatch')
      const age=Date.now()-Date.parse(candidate.createdAt)
      if(!candidate.recall && (!this.contacts.has(candidate.threadId)||candidate.senderId===candidate.threadId)&&this.permits(candidate.threadId)&&candidate.direction==='incoming'&&candidate.senderId&&candidate.senderId!==this.config.selfId&&event.data.origin==='live'&&age>=-60000&&age<=this.config.maxMessageAgeMs)message=candidate
    }
    this.store.commitEvent(event.cursor,message,!!message && (this.priority?.(message) || directlyAddressed(message,this.config.selfId)));this.drain()
  }
  subscribe(consumer, priority){
    if(this.consumer)throw Error('Only one response consumer is allowed')
    this.consumer=consumer;this.priority=priority;this.drain()
    return ()=>{if(this.consumer===consumer){this.consumer=null;this.priority=null}}
  }
  drain(){
    if(this.draining){this.wakeDrain?.();return this.draining}
    if(!this.consumer||!this.verified||this.signal.aborted)return this.draining
    this.draining=this.process().finally(()=>{this.draining=null;if(this.consumer&&this.verified&&!this.signal.aborted&&this.store.next())this.drain()})
    return this.draining
  }
  async process(){
    const active = new Set()
    const handle = async (row, consume) => {
      try {
        const message=JSON.parse(row.message)
        if(!this.permits(message.threadId)){this.store.mark(row.id,'revoked');return}
        await consume(message)
        this.store.mark(row.id,this.signal.aborted?'interrupted':'done')
      } catch {this.store.mark(row.id,this.signal.aborted?'interrupted':'failed');this.log('consumer_failed')}
    }
    try {
      while(this.consumer && this.verified && !this.signal.aborted){
        const ordinarySlots=Math.max(0,16-active.size)
        // Four receive slots remain available to addressed messages while ordinary callbacks wait.
        const rows=this.store.pending(ordinarySlots || Math.max(0,20-active.size), !ordinarySlots)
        for(const row of rows){
          this.store.mark(row.id,'processing')
          const job=handle(row,this.consumer).finally(()=>{active.delete(job);this.wakeDrain?.()})
          active.add(job)
        }
        if(!active.size)return
        if(rows.length && active.size<20)continue
        await new Promise(resolve=>{this.wakeDrain=resolve})
        this.wakeDrain=null
      }
    } finally {this.wakeDrain=null;await Promise.allSettled([...active])}
  }
  status(){return {connected:this.verified,sending:this.sending,cursor:this.store.cursor(),counts:this.store.stats(),error:this.lastError}}
  identity(){return {accountId:this.config.accountId,selfId:this.config.selfId}}
  authorizedGroups(){return this.config.groups.map(g=>({...g}))}
  setSending(value){this.sending=value===true}
  async source(messageId){
    if(this.signal.aborted||!this.verified||!this.sending)throw Error('Sending disabled')
    const stored=this.store.message(messageId)
    if(!stored||!this.permits(stored.threadId)||stored.accountId!==this.config.accountId)throw Error('Unknown authorized source message')
    const live=await this.client.message(this.config.accountId,messageId)
    if(!this.permits(stored.threadId)||live.id!==stored.id||live.accountId!==stored.accountId||live.threadId!==stored.threadId||(live.recall?.state==='recalled'||live.recall?.recalledAt||live.recall?.observedAt))throw Error('Source message unavailable')
    return live
  }
  async member(groupId,userId){
    if(this.contacts.has(groupId)&&groupId===userId){const c=await this.client.contact(this.config.accountId,userId);if(c.username!==userId)throw Error('Contact identity mismatch');return {displayName:c.remark||c.displayName||c.nickname}}
    if(!this.groups.has(groupId))throw Error('Group not allowed')
    const result=await this.client.groupMember(this.config.accountId,groupId,userId,this.signal)
    if(result.groupId!==groupId||result.username!==userId)throw Error('Member identity mismatch')
    if (result.state && result.state !== 'present') return null
    if (result.member && result.member.username !== userId) throw Error('Member identity mismatch')
    return result.member
  }
  async groupDirectory(groupId) {
    if (!this.groups.has(groupId) || !this.permits(groupId)) throw Error('Group not allowed')
    const cached = this.memberDirectories.get(groupId)
    if (cached && Date.now() - cached.at < 60000) return cached.members
    const members = new Map(), cursors = new Set()
    let cursor
    do {
      const page = await this.client.groupMembers(this.config.accountId,groupId,{limit:100,cursor},this.signal)
      for (const member of page.items) if (member?.username) members.set(member.username, member)
      cursor = page.nextCursor
      if (cursor && cursors.has(cursor)) throw Error('Incomplete member directory')
      cursors.add(cursor)
    } while (cursor)
    if (!this.permits(groupId)) throw Error('Group no longer allowed')
    this.memberDirectories.set(groupId,{at:Date.now(),members})
    return members
  }
  follows(id,prior){return this.store.follows(id,prior)}
  newerInput(group,ids,options){return this.store.newerInput(group,ids,options)}
  recent(groupId,limit=40){if(!this.permits(groupId))throw Error('Group not allowed');return this.store.recent(groupId,limit)}
  async serialized(messageId,part,task){
    if(typeof part!=='string'||!part||part.length>80)throw Error('Stable response part required')
    const key='dsh-native-'+createHash('sha256').update(`${this.config.accountId}|${messageId}|${part}`).digest('hex')
    const previous=this.locks.get(key)||Promise.resolve()
    const result=previous.catch(()=>{}).then(()=>task(key));this.locks.set(key,result)
    try{return await result}finally{if(this.locks.get(key)===result)this.locks.delete(key)}
  }
  async recoverOrSubmit(key,submit){
    try{return await this.client.sendByKey(this.config.accountId,key)}
    catch(error){if(error.status!==404)throw Error('Send status unavailable')}
    try{return await submit()}catch(error){ if(error.code==='STALE_REPLY'||error.code==='SEND_BLOCKED')throw error; return this.client.sendByKey(this.config.accountId,key) }
  }
  async awaitReceipt(key,value,threadId,sourceId){
    const sendId=value.id,deadline=Date.now()+75000
    while(true){
      if(!sendId||value.id!==sendId||value.accountId!==this.config.accountId||(sourceId?value.threadId!==threadId||value.sourceId!==sourceId:value.destination!==threadId))throw Error('Receipt identity mismatch')
      this.store.saveReceipt(key,value)
      if(value.state==='accepted')return value
      if(!['queued','running','submitting'].includes(value.state)||Date.now()>deadline)throw Error('Send requires inspection')
      await delay(500,undefined,{signal:this.signal})
      value=await(sourceId?this.client.job(this.config.accountId,sendId,this.signal):this.client.send(this.config.accountId,sendId,this.signal))
    }
  }
  async sendText(messageId,text,{part='text:final',mentions=[],mentionPositions,quoteMessageId,beforeSubmit}={}){
    if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>16384)throw Error('Invalid bounded text')
    return this.serialized(messageId,part,async key=>{
      const source=await this.source(messageId),options={}
      if(mentions.length){
        if(!this.groups.has(source.threadId))throw Error('Mentions require a group')
        if(mentions.length>20||new Set(mentions).size!==mentions.length)throw Error('Invalid mentions')
        for(const id of mentions){const member=await this.member(source.threadId,id);if(!member?.mentionName)throw Error('Mention metadata unavailable')}
        options.mentions={userIds:mentions,...(mentionPositions && {positions:mentionPositions})}
      }
      if(quoteMessageId){const quote=await this.client.message(this.config.accountId,quoteMessageId);if(quote.accountId!==source.accountId||quote.threadId!==source.threadId||!quote.serverId||quote.recall?.state==='recalled')throw Error('Quote not available in this group');options.quote={messageId:quote.id,serverId:quote.serverId}}
      const payload={kind:'text',threadId:source.threadId,text,options};const old=this.store.outgoing(key,payload)
      if(old.receipt&&old.status==='accepted')return JSON.parse(old.receipt)
      const value=await this.recoverOrSubmit(key,async()=>{await this.source(messageId);if(beforeSubmit && !beforeSubmit())throw Object.assign(Error('Conversation changed'),{code:'STALE_REPLY'});return this.client.sendText(this.config.accountId,source.threadId,text,key,options)})
      return this.awaitReceipt(key,value,source.threadId)
    })
  }
  async sendImage(messageId,bytes,{part='image:0',beforeSubmit}={}){
    const data=Buffer.from(bytes),mime=imageType(data)
    if(!mime||data.length>4*1024*1024)throw Error('Only bounded PNG or JPEG images are supported')
    return this.serialized(messageId,part,async key=>{
      const message=await this.source(messageId),sha256=createHash('sha256').update(data).digest('hex')
      const old=this.store.outgoing(key,{kind:'image',threadId:message.threadId,sha256})
      if(old.receipt&&old.status==='accepted')return JSON.parse(old.receipt)
      let sourceId=old.source_id
      if(!sourceId){
        const uploaded=await this.client.upload(this.config.accountId,data,mime==='image/png'?'image.png':'image.jpg',mime,this.signal)
        if(!uploaded.id||uploaded.sha256!==sha256||uploaded.byteLength!==data.length)throw Error('Upload identity mismatch')
        sourceId=uploaded.id;this.store.saveSource(key,sourceId)
      }
      const value=await this.recoverOrSubmit(key,async()=>{await this.source(messageId);if(beforeSubmit && !beforeSubmit())throw Object.assign(Error('Conversation changed'),{code:'STALE_REPLY'});return this.client.sendMedia(this.config.accountId,{threadId:message.threadId,kind:'image',sourceId},key)})
      return this.awaitReceipt(key,value,message.threadId,sourceId)
    })
  }
  async readImage(messageId,{quoted=false}={}){
    const source=this.store.message(messageId)
    if(!source||source.accountId!==this.config.accountId||!this.permits(source.threadId))throw Error('Unknown image source')
    const live=await this.client.message(this.config.accountId,messageId)
    if(live.id!==source.id||live.accountId!==source.accountId||live.threadId!==source.threadId||live.recall)throw Error('Image source unavailable')
    if (quoted) {
      const q = live.quote
      if (!q || q.state==='recalled' || !(q.embeddedImage || q.type===3)) throw Error('No quoted image on this message')
      // Native 1.5.1 exposes embedded quote assets on the outer message, without a source field.
      // A reference without embedded bytes must resolve to the exact original in the same room.
      if(!q.embeddedImage || live.link || q.embeddedLink){
        const original=this.store.quotedSource(source.threadId,q.serverId)
        if(!original || original.id===messageId || original.type!==3 ||
          original.accountId!==source.accountId || (q.senderId && original.senderId!==q.senderId))
          throw Error('Quoted original unavailable in this conversation')
        return this.readImage(original.id)
      }
    }
    let assets=(await this.client.mediaAssets(this.config.accountId,messageId,this.signal)).items
    assets=assets.filter(a=>a.accountId===source.accountId&&a.messageId===messageId&&a.kind==='image')
    assets.sort((a,b)=>['original','standard','thumbnail'].indexOf(a.variant)-['original','standard','thumbnail'].indexOf(b.variant))
    if(!assets.length)throw Error('Image asset unavailable')
    let asset=assets.find(a=>a.state==='available')||assets[0]
    if(asset.state!=='available'){
      let job=await this.client.transferMedia(this.config.accountId,{messageId,assetId:asset.id,quality:asset.variant})
      const jobId=job.id,deadline=Date.now()+60000
      while(job.state!=='succeeded'){
        if(job.accountId!==this.config.accountId||job.id!==jobId||!['queued','running'].includes(job.state)||Date.now()>deadline)throw Error('Image transfer unavailable')
        await delay(500,undefined,{signal:this.signal});job=await this.client.job(this.config.accountId,jobId,this.signal)
      }
      if(job.accountId!==this.config.accountId || job.id!==jobId || (job.assetId && job.assetId!==asset.id)) throw Error('Image transfer mismatch')
      asset=await this.client.mediaAsset(this.config.accountId,asset.id)
    }
    if(asset.accountId!==this.config.accountId||asset.messageId!==messageId||asset.state!=='available')throw Error('Image asset mismatch')
    const options={maxBytes:10*1024*1024,signal:this.signal}
    let content
    if(asset.preview) {
      try{content=await this.client.mediaContent(source.accountId,asset.id,{...options,representation:'preview'})}
      catch(error){if(error.code!=='media_preview_unavailable')throw error}
    }
    content ??= await this.client.mediaContent(source.accountId,asset.id,{...options,representation:'original'})
    const bytes=Buffer.from(content.bytes)
    const mimeType=imageType(bytes) || (bytes.length>=12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP' ? 'image/webp' :
      /^GIF8[79]a$/.test(bytes.toString('ascii',0,6)) ? 'image/gif' : null)
    if(!mimeType || !this.permits(source.threadId))throw Error('Unsupported or unauthorized image')
    return {data:bytes.toString('base64'),mimeType}
  }
  async settle(){await Promise.allSettled([this.running,this.draining,...this.locks.values()])}
}
export function imageType(data){
  if(data.length>24&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png'
  if(data.length>3&&data[0]===255&&data[1]===216&&data[2]===255)return 'image/jpeg'
  return null
}
