import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {createHash} from 'node:crypto'
const root=new URL('../',import.meta.url)
const source=JSON.parse(readFileSync(new URL('vendor/agent-wechat/SOURCE.json',root)))
mkdirSync(new URL('lib/wechat/sdk/',root),{recursive:true})
for(const file of ['native-client.ts','native-calls.ts','native.generated.ts']){
  const input=readFileSync(new URL('vendor/agent-wechat/'+file,root),'utf8')
  if(createHash('sha256').update(input).digest('hex')!==source.sha256[file])throw Error('Upstream source hash mismatch: '+file)
  const js=stripTypeScriptTypes(input,{mode:'strip'}).replace(/(from\s+["']\.\/[^"']+)\.ts(["'])/g,'$1.js$2').replace(/[\t ]+$/gm,'').trimEnd()+'\n'
  writeFileSync(new URL('lib/wechat/sdk/'+file.replace(/\.ts$/,'.js'),root),'// Generated from agent-wechat v1.5.1 (MIT); see vendor/agent-wechat/SOURCE.json.\n'+js)
}
