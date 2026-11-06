import { relationshipRole } from '../family.js'
import { directlyAddressed } from './priority.js'
import {DatabaseSync} from 'node:sqlite'
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'

/** Transport state only. No persona, conversation generation, or memory policy. */
export class Store {
  constructor(directory,initialCursor='0'){
    if(!/^\d+$/.test(initialCursor))throw Error('Invalid initial cursor')
    mkdirSync(directory,{recursive:true,mode:0o700})
    this.db=new DatabaseSync(join(directory,'native.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS state(k TEXT PRIMARY KEY,v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY,message TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS direct_inbox(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS outbox(k TEXT PRIMARY KEY,payload TEXT NOT NULL,source_id TEXT,receipt TEXT,status TEXT NOT NULL);
      UPDATE inbox SET status='interrupted' WHERE status='processing';`)
    this.db.prepare("INSERT OR IGNORE INTO state VALUES('cursor',?)").run(initialCursor)
  }
  relationships() {
    const row = this.db.prepare("SELECT v FROM state WHERE k='relationships'").get()
    if (row) return JSON.parse(row.v)
    const old = this.db.prepare("SELECT v FROM state WHERE k='father'").get()
    return old ? [{ ...JSON.parse(old.v), title: '爸爸' }] : []
  }
  updateRelationships(change) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const rows = change(this.relationships())
      if (rows.length > 100) throw Error('人格关系最多绑定 100 位联系人')
      const put = this.db.prepare('INSERT OR REPLACE INTO state(k,v) VALUES(?,?)')
      put.run('relationships', JSON.stringify(rows))
      // Keep a single unambiguous father readable by a 0.14 host after rollback.
      const fathers = rows.filter(row => relationshipRole(row.title) === '父亲')
      if (fathers.length === 1) {
        const { id, name } = fathers[0]
        put.run('father', JSON.stringify({ id, name }))
      } else this.db.prepare("DELETE FROM state WHERE k='father'").run()
      this.db.exec('COMMIT')
      return rows
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  loginState(){const row=this.db.prepare("SELECT v FROM state WHERE k='login_operation'").get();return row ? JSON.parse(row.v) : {}}
  saveLogin(value){this.db.prepare("INSERT OR REPLACE INTO state(k,v) VALUES('login_operation',?)").run(JSON.stringify(value))}
  targets(){const row=this.db.prepare("SELECT v FROM state WHERE k='targets'").get();return row ? JSON.parse(row.v) : null}
  setTargets(lists){this.db.prepare("INSERT OR REPLACE INTO state(k,v) VALUES('targets',?)").run(JSON.stringify(lists))}
  cursor(){return this.db.prepare("SELECT v FROM state WHERE k='cursor'").get().v}
  commitEvent(cursor,message,direct=false){
    if(!/^\d+$/.test(cursor))throw Error('Invalid event cursor')
    if(BigInt(cursor)<=BigInt(this.cursor()))return false
    this.db.exec('BEGIN IMMEDIATE')
    try{
      if(message)this.db.prepare("INSERT OR IGNORE INTO inbox VALUES(?,?,'pending',?)").run(message.id,JSON.stringify(message),Date.now())
      if(message && direct)this.db.prepare("INSERT OR IGNORE INTO direct_inbox SELECT id FROM inbox WHERE id=? AND status='pending'").run(message.id)
      this.db.prepare("UPDATE state SET v=? WHERE k='cursor'").run(cursor)
      this.db.exec('COMMIT');return true
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  pending(limit=16, directOnly=false){
    const join=directOnly ? 'JOIN' : 'LEFT JOIN'
    return this.db.prepare(`SELECT i.id,i.message,i.created,i.rowid AS seq FROM inbox i
      ${join} direct_inbox d ON d.id=i.id WHERE i.status='pending'
      ORDER BY (d.id IS NOT NULL) DESC,i.created,i.rowid LIMIT ?`).all(limit).sort((a,b)=>a.seq-b.seq)
  }
  next(){return this.db.prepare("SELECT id,message,created FROM inbox WHERE status='pending' ORDER BY created,rowid LIMIT 1").get()}
  message(id){const row=this.db.prepare('SELECT message FROM inbox WHERE id=?').get(id);return row?JSON.parse(row.message):null}
  follows(id,prior){
    return !!this.db.prepare('SELECT 1 FROM inbox a JOIN inbox b ON a.rowid>b.rowid WHERE a.id=? AND b.id=?').get(id,prior)
  }
  newerInput(group, ids, {peer, pendingOnly=false}={}) {
    if(!ids.length)return false
    const placeholders=ids.map(()=>'?').join(',')
    const peers = [...new Set((Array.isArray(peer) ? peer : [peer]).filter(Boolean))]
    const sql=`SELECT 1 FROM inbox WHERE rowid>(SELECT MAX(rowid) FROM inbox WHERE id IN (${placeholders}))
      AND json_extract(message,'$.threadId')=? AND status NOT IN ('expired','revoked','interrupted','failed')
      ${pendingOnly ? "AND status IN ('pending','processing')" : ''}
      ${peers.length ? `AND (json_extract(message,'$.senderId') IN (${peers.map(()=>'?').join(',')})
        OR status='done' OR EXISTS(SELECT 1 FROM direct_inbox d WHERE d.id=inbox.id))` : ''} LIMIT 1`
    return !!this.db.prepare(sql).get(...ids,group,...peers)
  }
  quotedSource(thread,serverId){
    if(typeof serverId!=='string'||!serverId)return null
    const row=this.db.prepare("SELECT message FROM inbox WHERE json_extract(message,'$.threadId')=? AND json_extract(message,'$.serverId')=? LIMIT 1").get(thread,serverId)
    return row?JSON.parse(row.message):null
  }
  mark(id,status){this.db.prepare('UPDATE inbox SET status=? WHERE id=?').run(status,id);if(status!=='processing')this.db.prepare('DELETE FROM direct_inbox WHERE id=?').run(id)}
  recent(groupId,limit=40){return this.db.prepare("SELECT message FROM inbox WHERE json_extract(message,'$.threadId')=? ORDER BY created DESC,rowid DESC LIMIT ?").all(groupId,Math.max(1,Math.min(40,Number.isInteger(limit)?limit:40))).map(r=>JSON.parse(r.message)).reverse()}
  bind(accountId,selfId){
    const value=JSON.stringify({accountId,selfId}),old=this.db.prepare("SELECT v FROM state WHERE k='identity'").get()
    if(old&&old.v!==value)throw Error('Transport store belongs to a different account')
    this.db.prepare("INSERT OR IGNORE INTO state VALUES('identity',?)").run(value)
    const add=this.db.prepare('INSERT OR IGNORE INTO direct_inbox VALUES(?)')
    for(const r of this.db.prepare("SELECT id,message FROM inbox WHERE status='pending'").all()){
      if(directlyAddressed(JSON.parse(r.message),selfId))add.run(r.id)
    }
  }
  outgoing(key,payload){
    const serialized=JSON.stringify(payload)
    this.db.prepare("INSERT OR IGNORE INTO outbox(k,payload,status) VALUES(?,?,'prepared')").run(key,serialized)
    const row=this.db.prepare('SELECT * FROM outbox WHERE k=?').get(key)
    if(row.payload!==serialized)throw Error('Idempotency key already belongs to a different payload')
    return row
  }
  saveSource(key,id){this.db.prepare('UPDATE outbox SET source_id=? WHERE k=?').run(id,key)}
  saveReceipt(key,receipt){this.db.prepare('UPDATE outbox SET receipt=?,status=? WHERE k=?').run(JSON.stringify(receipt),receipt.state||'unknown',key)}
  stats(){return Object.fromEntries(this.db.prepare('SELECT status,count(*) AS n FROM inbox GROUP BY status').all().map(r=>[r.status,r.n]))}
  close(){this.db.close()}
}
