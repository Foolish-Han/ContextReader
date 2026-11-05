import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../src/shared/store.mjs';
import {createCloudSync} from '../src/background/cloud-sync.mjs';
import {createGoogleDrive,DRIVE_SCOPE} from '../src/background/google-drive.mjs';
const adapter=()=>{let saved;return {read:async()=>structuredClone(saved),write:async d=>{saved=structuredClone(d);}};};
const repository=()=>createRepository(adapter());
const expression={canonical:'tacitly',surface:'tacitly',kind:'word',ipa:'',ipaUK:'/ˈtæs.ɪt.li/',ipaUS:'/ˈtæs.ɪt.li/',partOfSpeech:'副词',baseMeanings:['默示地'],meaning:'隐性地学会',note:'与 explicitly 对照。'};
const request=(context='It is learned tacitly.')=>({kind:'term',selected:'tacitly',sentence:context,context,before:context.slice(0,context.indexOf('tacitly')).trim(),after:context.slice(context.indexOf('tacitly')+7).trim(),source:{url:'https://example.com/post',title:'Post'}});
const save=(r,hash='one',context)=>r.saveTerm(expression,request(context),hash,{mode:'api',model:'fast',service:'openai-sdk'});
const envelope=async r=>(await r.cloudPayload()).envelope;
test('passage position anchors sync and legacy cloud documents remain readable without invented positions',async()=>{
 const a=repository(),b=repository(),req={...request('Read it. Read it.'),kind:'passage',selected:'Read it.',before:'',after:'Read it.'};
 await a.saveSnippet({meaning:'第一句',explanation:'',uncertainty:'',candidates:[]},req,'passage',{});const current=await envelope(a);await b.mergeCloud([current]);assert.equal((await b.snapshot()).snippets[0].after,'Read it.');
 const legacy=structuredClone(current);for(const doc of legacy.documents)if(doc.group==='snippets'){delete doc.fields.before;delete doc.fields.after;}const c=repository();await c.mergeCloud([legacy]);assert.equal(Object.hasOwn((await c.snapshot()).snippets[0],'before'),false);assert.deepEqual(await c.passageIndex(req.source.url),[]);await c.mergeCloud([current]);assert.equal((await c.passageIndex(req.source.url)).length,1);assert.equal((await c.snapshot()).snippets.length,1);
});
test('two saved positions of the same sentence survive a cloud merge as separate passages',async()=>{
 const a=repository(),b=repository(),base={...request('Read it. Read it.'),kind:'passage',selected:'Read it.'},result={meaning:'句意',explanation:'',uncertainty:'',candidates:[]};
 await a.saveSnippet(result,{...base,before:'',after:'Read it.'},'first',{});await a.saveSnippet(result,{...base,before:'Read it.',after:''},'second',{});await b.mergeCloud([await envelope(a)]);assert.equal((await b.snapshot()).snippets.length,2);assert.deepEqual((await b.passageIndex(base.source.url)).map(p=>p.request.before).sort(),['','Read it.']);
});
async function exchange(a,b){await a.mergeCloud([await envelope(b)]);await b.mergeCloud([await envelope(a)]);}
test('two devices merge the same canonical word and distinct contexts without replacing local IDs',async()=>{
 const a=repository(),b=repository();const x=await save(a),y=await save(b,'two','She tacitly accepted it.');await exchange(a,b);const left=await a.snapshot(),right=await b.snapshot();assert.equal(left.entries.length,1);assert.equal(left.entries[0].id,x.entry.id);assert.equal(right.entries[0].id,y.entry.id);assert.equal(left.contexts.length,2);assert.equal(right.contexts.length,2);assert.equal(left.entries[0].ipaUS,expression.ipaUS);assert.equal(left.entries[0].contextCount,2);await exchange(a,b);assert.equal((await a.snapshot()).contexts.length,2);
});
test('the same context from different device credential references merges once and retains both cache hashes',async()=>{
 const a=repository(),b=repository();await save(a,'hash-device-a');await save(b,'hash-device-b');await exchange(a,b);assert.equal((await a.snapshot()).contexts.length,1);assert.ok(await a.cached('hash-device-a'));assert.ok(await a.cached('hash-device-b'));
});
test('manual meaning and independent learning updates survive simultaneous changes',async()=>{
 const a=repository(),b=repository();const {entry}=await save(a);await b.mergeCloud([await envelope(a)]);const remote=(await b.snapshot()).entries[0];await a.edit(entry.id,{base:'人工修订',note:'人工说明'});await b.learning(remote.id,{status:'ready',usage:'在另一台设备补充的用法',memory:'记忆',examples:[]});await exchange(a,b);const left=(await a.snapshot()).entries[0];assert.deepEqual(left.baseMeanings,['人工修订']);assert.equal(left.note,'人工说明');assert.equal(left.learning.usage,'在另一台设备补充的用法');assert.deepEqual((await b.snapshot()).entries[0].baseMeanings,['人工修订']);
});
test('deletion wins over a stale offline learning update; explicit later re-add remains possible',async()=>{
 const a=repository(),b=repository();const {entry}=await save(a);await b.mergeCloud([await envelope(a)]);const other=(await b.snapshot()).entries[0];await a.deleteEntry(entry.id);await b.learning(other.id,{status:'ready',usage:'迟到的资料',memory:'',examples:[]});await exchange(a,b);assert.equal((await a.snapshot()).entries.length,0);assert.equal((await b.snapshot()).entries.length,0);await save(b,'new-attempt');await exchange(a,b);assert.equal((await a.snapshot()).entries.length,1);
});
test('a deliberate re-add resets old manual fields so deleted incorrect definitions cannot return',async()=>{
 const a=repository(),b=repository();const {entry}=await save(a);await a.edit(entry.id,{base:'旧的人工错误义'});await b.mergeCloud([await envelope(a)]);await a.deleteEntry(entry.id);await exchange(a,b);await save(a,'new-definition');await exchange(a,b);assert.deepEqual((await a.snapshot()).entries[0].baseMeanings,['默示地']);assert.deepEqual((await b.snapshot()).entries[0].baseMeanings,['默示地']);assert.equal((await b.snapshot()).entries[0].edited,false);
});
test('deleting one context syncs without restoring it from another device or deleting another context',async()=>{
 const a=repository(),b=repository();await save(a);await save(a,'two','She tacitly accepted it.');await b.mergeCloud([await envelope(a)]);const before=await a.snapshot();await a.deleteContext(before.contexts[0].id);await exchange(a,b);assert.equal((await a.snapshot()).contexts.length,1);assert.equal((await b.snapshot()).contexts.length,1);assert.equal((await b.snapshot()).entries[0].contextCount,1);
});
test('malformed cloud batches reject atomically and operational credentials are never exported',async()=>{
 const a=repository(),b=repository();await save(a);await a.transaction(d=>{d.fakeSecret='SECRET';d.entries[0].apiKey='SECRET';d.tasks=[{id:'task',token:'SECRET'}];});const incoming=await envelope(a);assert.equal(JSON.stringify(incoming).includes('SECRET'),false);const bad=structuredClone(incoming);bad.documents[0].fields.accessToken={value:'SECRET',stamp:[Date.now(),'bad']};await assert.rejects(b.mergeCloud([incoming,bad]),/字段/);assert.equal((await b.snapshot()).entries.length,0);assert.equal('cloudMeta' in await a.snapshot(),false);
});
function network(){const documents=new Map();let count=0,writes=0,accountId='google-account',fail=false,writeHook;return {documents,get writes(){return writes;},account:id=>{accountId=id;},fail:value=>{fail=value;},hook:fn=>{writeHook=fn;},driver:()=>({configured:true,authorize:async()=>true,account:async()=>({id:accountId,name:'Test user',email:'test@example.com'}),files:async()=>[...documents.values()].map(({body,...f})=>structuredClone(f)),read:async f=>structuredClone(documents.get(f.id).body),write:async(body,id)=>{if(fail)throw Object.assign(new Error('offline'),{code:'network'});if(writeHook){const hook=writeHook;writeHook=null;await hook();}writes++;const file={id:id||'file-'+(++count),modifiedTime:String(Date.now())+'-'+writes,appProperties:{device:body.device},body:structuredClone(body)};documents.set(file.id,file);const {body:ignored,...metadata}=file;return metadata;},disconnect:async()=>{}})};}
function storage(){const values={};return {get:async name=>({[name]:structuredClone(values[name])}),set:async patch=>Object.assign(values,structuredClone(patch))};}
const engine=(repo,net,store=storage())=>createCloudSync({repository:repo,storage:store,drive:net.driver(),clientId:'test-client',debounceMs:20});
async function automaticUntil(predicate){for(let i=0;i<120;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Automatic sync did not complete');}
test('knowledge mutations automatically upload, including edits and deletion, with no manual sync',async()=>{
 const net=network(),r=repository(),store=storage(),sync=engine(r,net,store);r.onKnowledgeChange(()=>sync.schedule());await sync.connect();
 try{const {entry}=await save(r);await automaticUntil(async()=>net.writes===2&&!(await sync.state()).pending);await r.edit(entry.id,{base:'自动上传的修订'});await automaticUntil(async()=>net.writes===3&&!(await sync.state()).pending);await r.deleteEntry(entry.id);await automaticUntil(async()=>net.writes===4&&!(await sync.state()).pending);assert.equal((await sync.state()).status,'synced');assert.equal(net.documents.size,1);}
 finally{await sync.disconnect();}
});
test('a fresh worker initializes saved authorization and uploads offline changes without connecting again',async()=>{
 const net=network(),r=repository(),store=storage(),before=engine(r,net,store);await before.connect();await save(r);let wakes=0;
 const resumed=createCloudSync({repository:r,storage:store,drive:net.driver(),clientId:'test-client',setWake:async enabled=>{if(enabled)wakes++;}});await resumed.initialize();
 try{await automaticUntil(async()=>net.writes===2&&!(await resumed.state()).pending);assert.ok(wakes>0);assert.equal((await resumed.state()).status,'synced');}
 finally{await resumed.disconnect();}
});
test('disconnect stops automatic submission while retaining local knowledge',async()=>{
 const net=network(),r=repository(),sync=engine(r,net);r.onKnowledgeChange(()=>sync.schedule());await sync.connect();await sync.disconnect();const writes=net.writes;await save(r);await new Promise(resolve=>setTimeout(resolve,50));assert.equal(net.writes,writes);assert.equal((await r.snapshot()).entries.length,1);assert.equal((await sync.state()).pending,true);
});
test('real sync coordinator restores a fresh device, propagates edits/deletions and isolates per-device writes',async()=>{
 const net=network(),a=repository(),b=repository(),x=engine(a,net),y=engine(b,net);const {entry}=await save(a);await x.connect();assert.equal((await x.state()).status,'synced');await y.connect();assert.equal((await b.snapshot()).entries.length,1);assert.equal(net.documents.size,2);await a.edit(entry.id,{base:'从设备 A 修订'});await x.sync({manual:true});await y.sync({manual:true});assert.deepEqual((await b.snapshot()).entries[0].baseMeanings,['从设备 A 修订']);await b.deleteEntry((await b.snapshot()).entries[0].id);await y.sync({manual:true});await x.sync({manual:true});assert.equal((await a.snapshot()).entries.length,0);await x.disconnect();await y.disconnect();
});
test('simultaneous device additions remain in cloud and merge on a third device',async()=>{
 const net=network(),a=repository(),b=repository(),c=repository(),x=engine(a,net),y=engine(b,net),z=engine(c,net);await x.connect();await y.connect();await save(a);await b.saveTerm({...expression,canonical:'hone',surface:'honed'},request('Skills are honed.'),'another',{});await Promise.all([x.sync({manual:true}),y.sync({manual:true})]);await z.connect();assert.deepEqual((await c.snapshot()).entries.map(e=>e.canonical).sort(),['hone','tacitly']);await Promise.all([x.disconnect(),y.disconnect(),z.disconnect()]);
});
test('failed uploads do not acknowledge dirty local data or falsely report cloud success',async()=>{
 const net=network(),r=repository(),sync=engine(r,net);await sync.connect();const last=(await sync.state()).lastSyncAt;await save(r);net.fail(true);await sync.sync({manual:true});const state=await sync.state();assert.equal(state.pending,true);assert.equal(state.status,'error');assert.equal(state.lastSyncAt,last);assert.equal((await r.snapshot()).entries.length,1);net.fail(false);await sync.sync({manual:true});assert.equal((await sync.state()).pending,false);await sync.disconnect();
});
test('an account change is blocked before reading or writing another account',async()=>{
 const net=network(),r=repository(),sync=engine(r,net);await save(r);await sync.connect();const writes=net.writes;net.account('another-account');await sync.sync({manual:true});assert.equal((await sync.state()).status,'account-mismatch');assert.equal(net.writes,writes);assert.equal((await r.snapshot()).entries.length,1);await sync.disconnect();
});
test('a change during upload stays pending until another confirmed upload',async()=>{
 const net=network(),r=repository(),sync=engine(r,net);await save(r);
 const id=(await r.snapshot()).entries[0].id;net.hook(()=>r.edit(id,{note:'上传期间的新修改'}));await sync.connect();assert.equal((await sync.state()).pending,true);await sync.sync({manual:true});assert.equal((await sync.state()).pending,false);await sync.disconnect();
});
test('missing OAuth configuration never opens a login or accesses Google',async()=>{
 let calls=0;const drive=createGoogleDrive({identity:{getAuthToken:()=>{calls++;}},clientId:'',fetcher:()=>{calls++;}});assert.equal(drive.configured,false);await assert.rejects(drive.authorize(true),/Client ID/);assert.equal(calls,0);
});
test('Drive wire requests use only appDataFolder and keep OAuth tokens out of returned metadata',async()=>{
 const sent=[],tokens=[];const drive=createGoogleDrive({clientId:'1234-public.apps.googleusercontent.com',identity:{getAuthToken:async options=>{tokens.push(options);return {token:'TEST_ONLY_TOKEN',grantedScopes:[DRIVE_SCOPE]};},removeCachedAuthToken:async()=>{}},fetcher:async(url,options)=>{sent.push({url,options});if(url.includes('/about?'))return Response.json({user:{permissionId:'account',displayName:'Test'}});if(url.includes('/files?')&&!url.includes('/upload/'))return Response.json({files:[]});return Response.json({id:'file-1',modifiedTime:'now'});}});
 await drive.authorize(true);assert.equal((await drive.account()).id,'account');await drive.files();const r=repository();await save(r);await drive.write(await envelope(r));assert.deepEqual(tokens[0].scopes,[DRIVE_SCOPE]);assert.equal(new URL(sent[1].url).searchParams.get('spaces'),'appDataFolder');assert.ok(sent[2].options.body.includes('"parents":["appDataFolder"]'));assert.ok(sent.every(s=>s.options.headers.Authorization==='Bearer TEST_ONLY_TOKEN'));
});
