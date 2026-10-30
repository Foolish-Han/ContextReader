import {digest,keyOf,norm,safeUrl} from './core.mjs';

const FIELDS={
 entries:['canonical','aliases','kind','ipa','ipaUK','ipaUS','partOfSpeech','baseMeanings','note','paused','edited','learning','createdAt'],
 contexts:['entryKey','hash','hashAliases','selected','surface','sentence','context','before','after','meaning','explanation','uncertainty','source','provider','createdAt'],
 snippets:['hash','text','context','sentence','meaning','explanation','uncertainty','candidates','source','provider','createdAt']
};
const text=(v,n=4000)=>String(v??'').slice(0,n);
const source=v=>({url:safeUrl(v?.url),title:text(v?.title,240)});
const provider=v=>({mode:text(v?.mode,60),model:text(v?.model,160),service:text(v?.service,160)});
function learning(v){return {status:v?.usage||v?.memory||v?.examples?.length?'ready':'empty',usage:text(v?.usage),memory:text(v?.memory),etymology:v?.etymologySource?text(v?.etymology):'',etymologySource:safeUrl(v?.etymologySource),examples:(Array.isArray(v?.examples)?v.examples:[]).slice(0,4).map(x=>({english:text(x.english,1500),chinese:text(x.chinese,1500)}))};}
function expression(v){return {canonical:text(v?.canonical,160),surface:text(v?.surface,240),kind:['word','phrase','compound'].includes(v?.kind)?v.kind:'word',ipa:text(v?.ipa,160),ipaUK:text(v?.ipaUK,160),ipaUS:text(v?.ipaUS,160),partOfSpeech:text(v?.partOfSpeech,120),baseMeanings:(v?.baseMeanings||[]).slice(0,6).map(x=>text(x,400)),meaning:text(v?.meaning),note:text(v?.note)};}
function field(group,name,value){
 if(name==='source')return source(value);if(name==='provider')return provider(value);if(name==='learning')return learning(value);
 if(name==='candidates')return (Array.isArray(value)?value:[]).slice(0,8).map(expression);
 if(['aliases','hashAliases','baseMeanings'].includes(name)){const items=[...new Set((Array.isArray(value)?value:[]).filter(x=>typeof x==='string').map(x=>text(x,name==='baseMeanings'?400:240)))];if(name!=='baseMeanings')items.sort();return items.slice(0,name==='baseMeanings'?6:name==='aliases'?40:24);}
 if(['paused','edited'].includes(name))return !!value;
 return text(value,({canonical:160,entryKey:160,hash:100,kind:20,ipa:160,ipaUK:160,ipaUS:160,partOfSpeech:120,createdAt:40,selected:1600,surface:240,sentence:2200,context:3200,before:400,after:400,uncertainty:1000,text:1600})[name]||4000);
}
const stampOrder=(a,b)=>a[0]-b[0]||a[1].localeCompare(b[1]);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function winner(a,b,name){if(!a)return b;if(!b)return a;
 if((name==='baseMeanings'||name==='note')&&!!a.manual!==!!b.manual)return a.manual?a:b;
 const selected=stampOrder(a.stamp,b.stamp)>=0?a:b;
 if(name==='aliases'||name==='hashAliases')return {...selected,value:[...new Set([...a.value,...b.value])].sort().slice(0,name==='aliases'?40:24)};
 if(name==='createdAt')return {...selected,value:[a.value,b.value].filter(Boolean).sort()[0]||''};
 if(name==='edited')return {...selected,value:!!a.value||!!b.value};
 return selected;
}
export async function cloudContextKey(canonical,c){return digest(JSON.stringify([keyOf(canonical),...['selected','sentence','context','before','after'].map(k=>norm(c[k])),safeUrl(c.source?.url),provider(c.provider)]));}
async function flatten(data){const records=new Map(),entryKeys=new Map(data.entries.map(e=>[e.id,keyOf(e.canonical)]));
 for(const group of Object.keys(FIELDS))for(const raw of data[group]){
  const canonical=group==='entries'?keyOf(raw.canonical):entryKeys.get(raw.entryId);if(group==='contexts'&&!canonical)continue;
  const key=group==='entries'?canonical:group==='contexts'?await cloudContextKey(canonical,raw):await digest(JSON.stringify([raw.text,raw.context,raw.sentence,safeUrl(raw.source?.url),provider(raw.provider)]));
  const id=group+':'+(group==='entries'?await digest(key):key),values={};for(const name of FIELDS[group])values[name]=field(group,name,name==='entryKey'?canonical:name==='hashAliases'?[...(raw.hashAliases||[]),raw.hash].filter(Boolean):raw[name]);
  records.set(id,{id,group,key,values,localId:raw.id});
 }return records;
}
function meta(d){return d.cloudMeta||={device:crypto.randomUUID(),clock:0,version:0,acknowledged:0,documents:{}};}
const nextStamp=m=>[m.clock=Math.max(Date.now(),m.clock+1),m.device];
const signature=d=>JSON.stringify([d.entries,d.contexts,d.snippets]);
// Capture ONLY knowledge fields. Tokens, settings, task records and in-flight
// learning state never cross the Drive boundary.
export async function captureCloud(before,d){const existed=!!d.cloudMeta,m=meta(d);if(existed&&before&&signature(before)===signature(d))return false;
 const current=await flatten(d),previous=existed&&before?await flatten(before):new Map();let changed=false;
 for(const [id,record] of current){let doc=m.documents[id];const old=previous.get(id);
  if(!doc){doc=m.documents[id]={id,group:record.group,key:record.key,present:{value:true,stamp:nextStamp(m)},fields:{}};changed=true;}
  else if(!old&&!doc.present.value){doc.present={value:true,stamp:nextStamp(m)};changed=true;}
  for(const [name,value] of Object.entries(record.values))if(!old||!same(old.values[name],value)||!doc.fields[name]){
   if(doc.fields[name]&&same(doc.fields[name].value,value))continue;
   doc.fields[name]={value,stamp:nextStamp(m),...((name==='baseMeanings'||name==='note')&&record.values.edited?{manual:true}:{})};changed=true;
  }
 }
 for(const [id] of previous)if(!current.has(id)&&m.documents[id]?.present.value){m.documents[id].present={value:false,stamp:nextStamp(m)};m.documents[id].reset=m.documents[id].present.stamp;changed=true;}
 if(changed)m.version++;return changed;
}
export function cloudEnvelope(d){const m=meta(d);return {format:'context-reader-sync',version:1,device:m.device,documents:Object.values(m.documents).map(doc=>doc.present.value?doc:{...doc,fields:{}})};}
export function validateCloud(input){
 if(input?.format!=='context-reader-sync'||input.version!==1||!Array.isArray(input.documents)||input.documents.length>180000)throw new Error('Google 云端知识格式不受支持，未覆盖本机数据。');
 const validStamp=s=>Array.isArray(s)&&s.length===2&&Number.isSafeInteger(s[0])&&s[0]>=0&&s[0]<Date.now()+366*86400000&&typeof s[1]==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(s[1]);
 const documents=[];
 for(const raw of input.documents){if(!raw||!Object.hasOwn(FIELDS,raw.group)||typeof raw.id!=='string'||!new RegExp('^'+raw.group+':[a-f0-9]{64}$').test(raw.id)||typeof raw.key!=='string'||raw.key.length>160||typeof raw.present?.value!=='boolean'||!validStamp(raw.present.stamp)||!raw.fields||typeof raw.fields!=='object'||raw.reset&&!validStamp(raw.reset))throw new Error('云端有无效记录，未覆盖本机数据。');
  const doc={id:raw.id,group:raw.group,key:raw.key,present:{value:raw.present.value,stamp:raw.present.stamp},fields:{},...(raw.reset?{reset:raw.reset}:!raw.present.value?{reset:raw.present.stamp}:{})};
  for(const [name,register] of Object.entries(raw.fields)){if(!FIELDS[raw.group].includes(name)||!register||!validStamp(register.stamp))throw new Error('云端字段校验失败，未覆盖本机数据。');doc.fields[name]={value:field(raw.group,name,register.value),stamp:register.stamp,...(register.manual&&(name==='baseMeanings'||name==='note')?{manual:true}:{})};}
  if(doc.present.value&&FIELDS[doc.group].some(name=>!doc.fields[name]))throw new Error('云端记录不完整，未覆盖本机数据。');documents.push(doc);
 }return documents;
}
export async function mergeCloud(d,envelopes){const m=meta(d);let changed=false;
 for(const input of envelopes)for(const incoming of validateCloud(input)){
  if(incoming.group==='entries'&&incoming.id!=='entries:'+await digest(incoming.key))throw new Error('云端表达身份不一致。');
  const previous=m.documents[incoming.id];if(!previous){m.documents[incoming.id]=structuredClone(incoming);changed=true;}
  else{const floor=[previous.reset,incoming.reset].filter(Boolean).sort(stampOrder).at(-1),joined={...previous,present:winner(previous.present,incoming.present,'present'),fields:{},...(floor?{reset:floor}:{})};
   for(const name of new Set([...Object.keys(previous.fields),...Object.keys(incoming.fields)])){const a=previous.fields[name],b=incoming.fields[name],keptA=a&&(!floor||stampOrder(a.stamp,floor)>0)?a:null,keptB=b&&(!floor||stampOrder(b.stamp,floor)>0)?b:null;const selected=winner(keptA,keptB,name);if(selected)joined.fields[name]=selected;}
   if(!joined.present.value)joined.fields={};if(!same(previous,joined)){m.documents[incoming.id]=joined;changed=true;}}
  for(const register of [incoming.present,...Object.values(incoming.fields)])m.clock=Math.max(m.clock,register.stamp[0]);
 }
 if(!changed)return false;
 const previousEntries=new Map(d.entries.map(e=>[keyOf(e.canonical),e])),previousRecords=await flatten(d),localIds=new Map([...previousRecords].map(([id,r])=>[id,r.localId]));
 const entries=[],contexts=[],snippets=[],entriesByKey=new Map();
 const values=doc=>Object.fromEntries(Object.entries(doc.fields).map(([name,reg])=>[name,structuredClone(reg.value)]));
 for(const doc of Object.values(m.documents))if(doc.group==='entries'&&doc.present.value){const v=values(doc);if(!v.canonical||keyOf(v.canonical)!==doc.key)throw new Error('云端表达名校验失败。');const existing=previousEntries.get(doc.key),entry={...v,id:existing?.id||crypto.randomUUID(),contextCount:0,updatedAt:new Date(Math.max(doc.present.stamp[0],...Object.values(doc.fields).map(r=>r.stamp[0]))).toISOString()};
  // A local task still owns its pending state, even while ready data is pulled.
  if(existing?.learning?.status==='pending')entry.learning={...entry.learning,status:'pending',refreshing:!!entry.learning.usage};entries.push(entry);entriesByKey.set(doc.key,entry);
 }
 for(const doc of Object.values(m.documents))if(doc.group!=='entries'&&doc.present.value){const v=values(doc),id=localIds.get(doc.id)||crypto.randomUUID();if(doc.group==='contexts'){
   const entry=entriesByKey.get(v.entryKey);if(!entry)continue;if(await cloudContextKey(v.entryKey,v)!==doc.key)throw new Error('云端语境身份校验失败。');delete v.entryKey;contexts.push({...v,id,entryId:entry.id});entry.contextCount++;
  }else snippets.push({...v,id});
 }
 // Remote deletions invalidate local in-flight callbacks exactly like a local
 // deletion. Field updates alone cannot resurrect a tombstoned expression.
 for(const doc of Object.values(m.documents))if(!doc.present.value&&doc.group==='entries'){
  const existing=previousEntries.get(doc.key);if(!(d.deletedEntries||[]).some(t=>t.cloudStamp===JSON.stringify(doc.present.stamp))){d.deletionRevision=(d.deletionRevision||0)+1;(d.deletedEntries||=[]).push({id:existing?.id||'',canonical:doc.key,revision:d.deletionRevision,at:Date.now(),cloudStamp:JSON.stringify(doc.present.stamp)});}
 }
 for(const doc of Object.values(m.documents))if(!doc.present.value&&doc.group==='contexts'&&!(d.deletedCloudContexts||[]).some(t=>t.cloudStamp===JSON.stringify(doc.present.stamp))){d.deletionRevision=(d.deletionRevision||0)+1;(d.deletedCloudContexts||=[]).push({key:doc.key,contextId:localIds.get(doc.id)||'',revision:d.deletionRevision,cloudStamp:JSON.stringify(doc.present.stamp)});}
 for(const t of d.tasks||[])if(t.replaceContextId&&(d.deletedCloudContexts||[]).some(x=>x.contextId===t.replaceContextId&&x.revision>(t.deletionRevision||0))){t.state='canceled';t.attempt++;delete t.output;}
 for(const t of d.tasks||[])if((t.entryId&&!entries.some(e=>e.id===t.entryId))||(t.request?.entryId&&!entries.some(e=>e.id===t.request.entryId))){t.state='canceled';t.attempt++;delete t.output;}
 d.entries=entries;d.contexts=contexts;d.snippets=snippets;m.version++;return true;
}
