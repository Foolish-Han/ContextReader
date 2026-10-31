import {sanitizeRequest,contextKey,providerIdentity,keyOf,norm,expandSelection,errorText} from '../shared/core.mjs';
import {cloudContextKey} from '../shared/cloud.mjs';

const ACTIVE=new Set(['queued','preparing','running']);
const ATTENTION=new Set(['failed','blocked','interrupted','save_failed','confirm']);
export const connectionIdentity=c=>JSON.stringify(c.mode==='oauth'?['oauth',c.oauthProfileId||'']:['api',c.baseUrl,c.protocol,c.apiKeyId||'']);
export function taskConfig(c){return Object.fromEntries(['mode','model','oauthModel','oauthProfileId','baseUrl','protocol','apiKeyId'].map(k=>[k,c[k]??'']));}
const failure=(message,code='connection')=>Object.assign(new Error(message),{code});

// All state changes pass through the repository's serialized IndexedDB write.
// A task and its knowledge result commit together; UI lifetime owns neither.
export function createTaskQueue({repository,getSettings,getCredential,runInference,publish=async()=>{},retainWorker=()=>()=>{},setWake=async()=>{},now=Date.now}){
 const active=new Map(),unsaved=new Map();let pumping=false,requested=false,ready,recoveryError='';
 const stamp=t=>{t.updatedAt=now();};
 const listOf=d=>d.tasks||=[];
 const find=(d,id)=>listOf(d).find(t=>t.id===id);
 const notify=async()=>{try{await publish();}catch{}};
 function makeTask(kind,config,extra={}){return {id:crypto.randomUUID(),kind,config,connection:connectionIdentity(config),state:'queued',attempt:0,createdAt:now(),updatedAt:now(),...extra};}
 function learningTask(d,entry,config,{standalone=false,retry=false,force=false}={}){
  let t=listOf(d).find(t=>t.kind==='learn'&&t.entryId===entry.id&&t.state!=='canceled');
  if(force&&t){t.state='canceled';t.attempt++;stamp(t);t=null;}
  if(t){if(retry&&!ACTIVE.has(t.state)&&t.state!=='done'){delete (d.taskBlocks||{})[t.connection];t.state=t.output?'save_failed':'queued';t.error='';t.code='';stamp(t);}return t;}
  if(entry.learning?.status==='ready'&&!retry&&!force)return null;
  t=makeTask('learn',config,{entryId:entry.id,canonical:entry.canonical,source:d.contexts.find(c=>c.entryId===entry.id)?.source||{},standalone});const block=d.taskBlocks?.[t.connection];if(block)Object.assign(t,{state:'blocked',error:block.error,code:block.code});listOf(d).push(t);if(!entry.learning?.edited)entry.learning={...entry.learning,status:block?'failed':'pending',refreshing:force,...(block?{error:block.error}:{})};return t;
 }
 function publicTask(t,d,{detail=false}={}){
  if(recoveryError&&ACTIVE.has(t.state))t={...t,state:'blocked',code:'storage',error:'本地任务状态恢复失败，尚未重新派发。请检查存储后重试。'};
  const buffered=unsaved.get(t.id),volatile=buffered&&buffered.attempt===t.attempt&&['running','confirm','save_failed'].includes(t.state)?buffered:null;if(volatile)t={...t,state:'save_failed',error:volatile.error,code:'storage'};
  const learn=t.kind==='quick'?find(d,t.learningId):null;
  const queued=listOf(d).filter(v=>v.state==='queued'&&(t.kind==='learn'||v.kind==='quick')).sort((a,b)=>a.createdAt-b.createdAt);
  const ahead=t.state==='queued'?Math.max(0,queued.findIndex(v=>v.id===t.id)):0;
  const item={id:t.id,kind:t.kind,state:t.state,attempt:t.attempt,selected:t.request?.selected||t.canonical||'',source:t.request?.source||t.source||{},createdAt:t.createdAt,updatedAt:t.updatedAt,model:t.config.mode==='oauth'?t.config.oauthModel:t.config.model,mode:t.config.mode,entryId:t.entryId||'',error:t.error||'',code:t.code||'',ahead,volatile:!!volatile,anchorStatus:t.anchorStatus||'',learning:learn?{id:learn.id,state:unsaved.has(learn.id)?'save_failed':learn.state,error:learn.error||''}:null};
  if(detail){item.request=t.request;if(t.state==='confirm')item.data={kind:'boundary',pendingId:t.id,result:t.output.data,request:t.request};else if(t.state==='done'&&t.kind==='quick'){
   if(t.snippetId){const snippet=d.snippets.find(s=>s.id===t.snippetId);if(snippet)item.data={kind:'passage',snippet,cached:true};}
   else{const entry=d.entries.find(e=>e.id===t.entryId);if(entry){const contexts=d.contexts.filter(c=>c.entryId===entry.id);item.data={kind:'term',entry,contexts,current:contexts.find(c=>c.hash===t.resultHash)||null,cached:true};}}
  }}return item;
 }
 async function prune(d){const threshold=now()-7*86400000;d.tasks=listOf(d).filter(t=>!(['done','canceled'].includes(t.state)&&t.updatedAt<threshold&&!((ACTIVE.has(find(d,t.learningId)?.state)||ATTENTION.has(find(d,t.learningId)?.state)))&&!listOf(d).some(p=>p.learningId===t.id&&(ACTIVE.has(p.state)||ATTENTION.has(p.state)))));}
 async function recover(){await repository.transaction(async d=>{
  await prune(d);
  for(const t of listOf(d)){
   if(t.state==='preparing'){t.state='queued';stamp(t);}
   else if(t.state==='running'){t.state=t.output?'save_failed':'interrupted';t.error='上次生成已中断，结果未确认。重试可能再次使用额度。';t.code='interrupted';stamp(t);}
   if(t.kind==='learn'){const e=d.entries.find(e=>e.id===t.entryId);if(e&&!e.learning?.edited&&['interrupted','failed','blocked','canceled'].includes(t.state)&&e.learning?.status==='pending')e.learning={...e.learning,status:'failed',error:t.error||'资料补充已取消。'};}
  }
  // Upgrade older pending learning records without silently making another call.
  for(const e of d.entries)if(e.learning?.status==='pending'&&!listOf(d).some(t=>t.kind==='learn'&&t.entryId===e.id))e.learning={...e.learning,status:'failed',error:'上次资料补充已中断，可以重新补充。'};
 });wake();}
 const initialized=()=>ready||=(recover().then(()=>{recoveryError='';},error=>{recoveryError=errorText(error);ready=null;throw error;}));
 async function descriptor(payload){const request=sanitizeRequest(payload),config=taskConfig(await getSettings());return {request,config,hash:await contextKey(request,providerIdentity(config)),occurrence:await contextKey(request)};}
 async function submit(payload){await initialized();const spec=await descriptor(payload);const cached=await repository.cached(spec.hash);if(cached)return {data:cached,cached:true};
  const id=await repository.transaction(d=>{const previous=listOf(d).find(t=>t.kind==='quick'&&t.hashes.includes(spec.hash));if(previous)return previous.id;
   const t=makeTask('quick',spec.config,{request:spec.request,hashes:[spec.hash],occurrences:[spec.occurrence],deletionRevision:d.deletionRevision||0});const block=d.taskBlocks?.[t.connection];if(block)Object.assign(t,{state:'blocked',error:block.error,code:block.code});listOf(d).push(t);return t.id;});
  // The receipt is a persisted state. Generation is never awaited by submit.
  const receipt=await get(id);wake();void notify();return {task:receipt};
 }
 async function regenerate(payload){await initialized();const spec=await descriptor(payload.request),entryId=spec.request.entryId;
  const id=await repository.transaction(d=>{if(entryId&&!d.entries.some(e=>e.id===entryId))throw new Error('表达已不存在。');const existing=listOf(d).find(t=>t.kind==='quick'&&ACTIVE.has(t.state)&&(t.hashes.includes(spec.hash)||(entryId&&t.regenerateEntryId===entryId)));if(existing)return existing.id;
   const t=makeTask('quick',spec.config,{request:spec.request,hashes:[spec.hash],occurrences:[spec.occurrence],deletionRevision:d.deletionRevision||0,regenerate:true,regenerateEntryId:entryId,replaceContextId:String(payload.contextId||'').slice(0,80)});const block=d.taskBlocks?.[t.connection];if(block)Object.assign(t,{state:'blocked',error:block.error,code:block.code});listOf(d).push(t);return t.id;});const task=await get(id);wake();void notify();return {task};
 }
 async function get(id){await initialized().catch(()=>{});const d=await repository.internal(),t=find(d,id);return t?publicTask(t,d,{detail:true}):null;}
 async function lookup(payload){await initialized().catch(()=>{});const spec=await descriptor(payload),d=await repository.internal();let t=listOf(d).filter(t=>t.kind==='quick'&&t.hashes.includes(spec.hash)).at(-1);
  if(!t)t=listOf(d).filter(t=>t.kind==='quick'&&t.occurrences.includes(spec.occurrence)&&t.state!=='canceled'&&t.state!=='done').at(-1);
  if(t)return {task:publicTask(t,d,{detail:true})};const cached=await repository.cached(spec.hash);return cached?{data:cached}:null;
 }
 async function list(){await initialized().catch(()=>{});const d=await repository.internal();return listOf(d).filter(t=>t.kind==='quick'||t.standalone).map(t=>publicTask(t,d)).sort((a,b)=>b.createdAt-a.createdAt);}
 async function pageTasks(url){await initialized().catch(()=>{});const d=await repository.internal();return listOf(d).filter(t=>t.kind==='quick'&&t.request.source.url===url&&t.state!=='done'&&t.state!=='canceled').map(t=>({id:t.id,state:unsaved.has(t.id)?'save_failed':t.state,request:t.request,...(t.state==='confirm'?{suggested:t.output?.data?.expression?.surface||''}:{})}));}
 async function observeAnchors(url,ids){await initialized();const found=new Set(Array.isArray(ids)?ids.filter(id=>typeof id==='string').slice(0,2000):[]);const changed=await repository.transaction(d=>{let changed=false;for(const t of listOf(d))if(t.kind==='quick'&&t.request.source.url===url&&!['done','canceled'].includes(t.state)){const status=found.has(t.id)?'found':'changed';if(t.anchorStatus!==status){t.anchorStatus=status;t.anchorObservedAt=now();changed=true;}}return changed;});if(changed)await notify();return true;}
 function finishLearning(d,t,data){const e=d.entries.find(e=>e.id===t.entryId);if(!e){t.state='canceled';return;}if(!e.learning?.edited)e.learning={status:'ready',...data};t.state='done';delete t.output;t.error='';stamp(t);}
 async function finishQuick(d,t,output,{original=false,confirmed=false}={}){
  const result=structuredClone(output.data),request=t.request,provider={mode:t.config.mode,model:output.model,service:output.provider};
  if(result.kind!==request.kind)throw failure('模型返回了不同的解释类型。','model');
  if(request.kind==='passage'){
   let snippet=d.snippets.find(s=>s.hash===t.hashes[0]||s.id===t.replaceContextId);if(snippet&&t.regenerate)Object.assign(snippet,{meaning:result.meaning,explanation:result.explanation,uncertainty:result.uncertainty,candidates:result.candidates,provider,updatedAt:new Date(now()).toISOString()});if(!snippet){snippet={id:crypto.randomUUID(),hash:t.hashes[0],text:request.selected,context:request.context,sentence:request.sentence,before:request.before,after:request.after,meaning:result.meaning,explanation:result.explanation,uncertainty:result.uncertainty,candidates:result.candidates,source:request.source,provider,createdAt:new Date(now()).toISOString()};d.snippets.push(snippet);}t.snippetId=snippet.id;
  }else{
   const expanded=keyOf(result.expression.surface)!==keyOf(request.selected)?expandSelection(request,result.expression.surface):request;if(!expanded)throw failure('模型返回的表达边界与所选原文不一致，未收录。请核对完整表达后重试。','model');
   if(!confirmed&&!request.entryId&&keyOf(result.expression.surface)!==keyOf(request.selected)&&result.expression.surface.length>request.selected.length+1){const hash=await contextKey(expanded,providerIdentity(t.config)),occurrence=await contextKey(expanded);if(!t.hashes.includes(hash))t.hashes.push(hash);if(!t.occurrences.includes(occurrence))t.occurrences.push(occurrence);t.state='confirm';t.output=output;t.error='';stamp(t);return;}
   const existing=d.entries.find(e=>e.id===request.entryId);if(existing&&keyOf(existing.canonical)!==keyOf(result.expression.canonical))throw failure('模型将已收录表达改成了另一个词条，已有解释已保留。请重新划选核对完整表达。','model');
   const expression={...result.expression,meaning:result.meaning,note:result.explanation,uncertainty:result.uncertainty};let actual=request;
   if(original){expression.canonical=request.selected;expression.surface=request.selected;expression.kind=/\s/.test(request.selected)?'phrase':/[\-\u2010-\u2015]/u.test(request.selected)?'compound':'word';expression.ipa='';expression.ipaUK='';expression.ipaUS='';}
   else if(keyOf(expression.surface)!==keyOf(request.selected))actual=expanded;
   const cloudKey=await cloudContextKey(expression.canonical,{...actual,provider});if((d.deletedCloudContexts||[]).some(x=>x.revision>(t.deletionRevision||0)&&(x.key===cloudKey||x.contextId===t.replaceContextId))){t.state='canceled';t.error='这条语境已删除，迟到结果没有重新写入。';delete t.output;stamp(t);return;}
   if((d.deletedEntries||[]).some(x=>(x.revision?x.revision>(t.deletionRevision||0):x.at>=(t.acceptedAt||t.createdAt))&&(x.id===request.entryId||x.canonical===keyOf(expression.canonical)))){t.state='canceled';t.error='表达已删除，迟到的结果没有重新收录。';delete t.output;stamp(t);return;}
   const hash=await contextKey(actual,providerIdentity(t.config)),occurrence=await contextKey(actual);if(!t.hashes.includes(hash))t.hashes.push(hash);if(!t.occurrences.includes(occurrence))t.occurrences.push(occurrence);
   const saved=repository.applyTerm(d,expression,actual,hash,provider,request.entryId,{replace:!!t.regenerate,contextId:t.replaceContextId}),context=d.contexts.find(c=>c.entryId===saved.entry.id&&c.hash===hash);context.hashAliases=[...new Set([...(context.hashAliases||[]),...t.hashes])];t.entryId=saved.entry.id;t.resultHash=hash;
   const learn=saved.created||t.regenerate?learningTask(d,saved.entry,t.config,{force:!!t.regenerate}):listOf(d).find(v=>v.kind==='learn'&&v.entryId===saved.entry.id&&v.state!=='canceled');if(learn)t.learningId=learn.id;
  }
  t.state='done';t.error='';delete t.output;stamp(t);
 }
 async function saveOutput(id,attempt,output,options={}){
  try{await repository.transaction(async d=>{const t=find(d,id);if(!t||t.attempt!==attempt||!['running','confirm','save_failed'].includes(t.state))return;if(t.kind==='learn')finishLearning(d,t,output.data);else await finishQuick(d,t,output,options);});unsaved.delete(id);}
  catch(error){
   if(error.code==='model')throw error;
   const current=find(await repository.internal(),id);if(!current||current.attempt!==attempt||!['running','confirm','save_failed'].includes(current.state))return;
   const record={output,options,attempt,error:'解释已生成，但本地保存失败。请重新保存；不会再次调用模型。若关闭浏览器，未落盘的结果可能丢失。'};unsaved.set(id,record);
   try{await repository.transaction(d=>{const t=find(d,id);if(t&&t.attempt===attempt&&!['canceled','blocked'].includes(t.state)){t.state='save_failed';t.output=output;t.saveOptions=options;t.error=record.error;t.code='storage';stamp(t);}});}catch{}
  }
  await reconcile();await notify();
 }
 async function settleFailure(id,attempt,error){await repository.transaction(d=>{const t=find(d,id);if(!t||t.attempt!==attempt||!['preparing','running'].includes(t.state))return;const code=error.code||'model';t.state=['connection','rate-limit'].includes(code)?'blocked':'failed';t.error=errorText(error);t.code=code;stamp(t);
  if(t.kind==='learn'){const e=d.entries.find(e=>e.id===t.entryId);if(e&&!e.learning?.edited)e.learning={...e.learning,status:'failed',error:t.error};}
  if(t.state==='blocked'){(d.taskBlocks||={})[t.connection]={error:t.error,code,at:now()};for(const other of listOf(d))if(other.connection===t.connection&&other.state==='queued'){other.state='blocked';other.error=t.error;other.code=code;stamp(other);if(other.kind==='learn'){const e=d.entries.find(e=>e.id===other.entryId);if(e&&!e.learning?.edited)e.learning={...e.learning,status:'failed',error:t.error};}}}
 });await notify();}
 async function run(t,controller){const release=retainWorker();try{
  const config=taskConfig(await getSettings());if(connectionIdentity(config)!==t.connection)throw failure('提交时的连接已改变。恢复原连接后重试，或取消并重新提交。');
  const credential=await getCredential(t.config,{signal:controller.signal});controller.signal.throwIfAborted();let payload;
  const claimed=await repository.transaction(d=>{const current=find(d,t.id);if(current?.attempt!==t.attempt||current.state!=='preparing')return false;if(t.kind==='learn'){const e=d.entries.find(e=>e.id===t.entryId);if(!e){current.state='canceled';return false;}payload={canonical:e.canonical,baseMeanings:e.baseMeanings,partOfSpeech:e.partOfSpeech,note:e.note};}else{payload={...t.request};if(t.regenerate){const e=d.entries.find(e=>e.id===t.request.entryId),c=d.contexts.find(c=>c.id===t.replaceContextId),s=d.snippets.find(s=>s.id===t.replaceContextId);payload.previous=e?{canonical:e.canonical,kind:e.kind,ipaUK:e.ipaUK||'',ipaUS:e.ipaUS||'',baseMeanings:e.baseMeanings,meaning:c?.meaning||'',explanation:c?.explanation||''}:s?{meaning:s.meaning,explanation:s.explanation}:null;}}current.state='running';current.startedAt=now();stamp(current);return true;});
  if(!claimed)return;await notify();const output=await runInference(t.config,credential,t.kind==='learn'?'learn':'quick',payload,{signal:controller.signal});controller.signal.throwIfAborted();await saveOutput(t.id,t.attempt,output);
 }catch(error){try{await settleFailure(t.id,t.attempt,error);}catch{await notify();}}
 finally{release();if(active.get(t.id)?.task.attempt===t.attempt)active.delete(t.id);wake();}}
 async function pump(){pumping=true;try{while(requested){requested=false;
  while(active.size<2){const t=await repository.transaction(d=>{
   const queued=listOf(d).filter(t=>t.state==='queued'&&!active.has(t.id)).sort((a,b)=>a.createdAt-b.createdAt);const candidate=queued.find(t=>t.kind==='quick')||(![...active.values()].some(a=>a.task.kind==='learn')?queued.find(t=>t.kind==='learn'):null);if(!candidate)return null;
   candidate.state='preparing';candidate.attempt++;stamp(candidate);if(candidate.kind==='learn'){const e=d.entries.find(e=>e.id===candidate.entryId);if(e&&!e.learning?.edited)e.learning={...e.learning,status:'pending'};}return candidate;
  });if(!t)break;const controller=new AbortController();active.set(t.id,{task:t,controller});void run(t,controller);}
  const d=await repository.internal();await setWake(active.size>0||listOf(d).some(t=>t.state==='queued'));
 }}catch{try{await setWake(true);}catch{}}finally{pumping=false;if(requested)wake();}}
 function wake(){requested=true;if(!pumping)void pump();}
 async function retry(id){await initialized();const d=await repository.internal(),t=find(d,id);if(!t)throw new Error('任务已不存在。');const buffered=unsaved.get(id);
  if(buffered||t.state==='save_failed'){const output=buffered?.output||t.output;if(!output)throw new Error('生成结果未能保留，请明确重新提交。');await saveOutput(id,t.attempt,output,buffered?.options||t.saveOptions);wake();return get(id);}
  await repository.transaction(d=>{const item=find(d,id);if(!item||!['failed','blocked','interrupted','canceled'].includes(item.state))return;delete (d.taskBlocks||{})[item.connection];item.state='queued';item.error='';item.code='';item.acceptedAt=now();item.deletionRevision=d.deletionRevision||0;delete item.output;stamp(item);});wake();await notify();return get(id);
 }
 async function cancel(id){await initialized();await repository.transaction(d=>{const t=find(d,id);if(!t||['done','canceled'].includes(t.state))return;t.state='canceled';t.attempt++;t.error='';delete t.output;stamp(t);if(t.kind==='learn'){const e=d.entries.find(e=>e.id===t.entryId);if(e&&!e.learning?.edited)e.learning={...e.learning,status:'failed',error:'资料补充已取消，可以稍后补充。'};}});unsaved.delete(id);active.get(id)?.controller.abort();wake();await notify();return get(id);}
 async function confirm(id,original=false){await initialized();const t=find(await repository.internal(),id);if(!t||t.state!=='confirm')throw new Error('此任务已处理，请重新打开。');await saveOutput(id,t.attempt,t.output,{confirmed:true,original});wake();return get(id);}
 async function enrich(entryId){await initialized();const config=taskConfig(await getSettings());const id=await repository.transaction(d=>{const e=d.entries.find(e=>e.id===entryId);if(!e)throw new Error('表达已不存在。');const task=learningTask(d,e,config,{standalone:true,retry:true});return task.id;});if(unsaved.has(id))return retry(id);wake();await notify();return get(id);}
 async function connectionChanged({oauthOnly=false,force=false}={}){await initialized();const current=connectionIdentity(taskConfig(await getSettings()));await repository.transaction(d=>{for(const t of listOf(d))if(ACTIVE.has(t.state)&&(!oauthOnly||t.config.mode==='oauth')&&(force||t.connection!==current)){t.state='blocked';t.attempt++;t.error='提交时的连接已改变。恢复原连接后重试，或取消并重新提交。';t.code='connection';stamp(t);if(t.kind==='learn'){const e=d.entries.find(e=>e.id===t.entryId);if(e&&!e.learning?.edited)e.learning={...e.learning,status:'failed',error:t.error};}}});await reconcile();await notify();}
 async function reconcile(){const d=await repository.internal();for(const [id,a] of active){const t=find(d,id);if(!t||t.attempt!==a.task.attempt||!['preparing','running'].includes(t.state))a.controller.abort();}for(const [id,output] of unsaved){const t=find(d,id);if(!t||t.state==='canceled'||t.attempt!==output.attempt)unsaved.delete(id);}wake();}
 return {initialize:initialized,submit,regenerate,get,lookup,list,pageTasks,observeAnchors,retry,cancel,confirm,enrich,connectionChanged,reconcile,wake};
}
