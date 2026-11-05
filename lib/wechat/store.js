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
      CREATE TABLE IF NOT EXISTS outbox(k TEXT PRIMARY KEY,payload TEXT NOT NULL,source_id TEXT,receipt TEXT,status TEXT NOT NULL);
      UPDATE inbox SET status='interrupted' WHERE status='processing';`)
    this.db.prepare("INSERT OR IGNORE INTO state VALUES('cursor',?)").run(initialCursor)
  }
  cursor(){return this.db.prepare("SELECT v FROM state WHERE k='cursor'").get().v}
  commitEvent(cursor,message){
    if(!/^\d+$/.test(cursor))throw Error('Invalid event cursor')
    if(BigInt(cursor)<=BigInt(this.cursor()))return false
    this.db.exec('BEGIN IMMEDIATE')
    try{
      if(message)this.db.prepare("INSERT OR IGNORE INTO inbox VALUES(?,?,'pending',?)").run(message.id,JSON.stringify(message),Date.now())
      this.db.prepare("UPDATE state SET v=? WHERE k='cursor'").run(cursor)
      this.db.exec('COMMIT');return true
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  pending(limit=16){return this.db.prepare("SELECT id,message,created FROM inbox WHERE status='pending' ORDER BY created,rowid LIMIT ?").all(limit)}
  next(){return this.db.prepare("SELECT id,message,created FROM inbox WHERE status='pending' ORDER BY created,rowid LIMIT 1").get()}
  message(id){const row=this.db.prepare('SELECT message FROM inbox WHERE id=?').get(id);return row?JSON.parse(row.message):null}
  mark(id,status){this.db.prepare('UPDATE inbox SET status=? WHERE id=?').run(status,id)}
  recent(groupId,limit=40){return this.db.prepare("SELECT message FROM inbox WHERE json_extract(message,'$.threadId')=? ORDER BY created DESC,rowid DESC LIMIT ?").all(groupId,Math.max(1,Math.min(40,Number.isInteger(limit)?limit:40))).map(r=>JSON.parse(r.message)).reverse()}
  bind(accountId,selfId){
    const value=JSON.stringify({accountId,selfId}),old=this.db.prepare("SELECT v FROM state WHERE k='identity'").get()
    if(old&&old.v!==value)throw Error('Transport store belongs to a different account')
    this.db.prepare("INSERT OR IGNORE INTO state VALUES('identity',?)").run(value)
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
