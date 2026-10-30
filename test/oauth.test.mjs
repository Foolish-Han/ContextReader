import test from 'node:test';import assert from 'node:assert/strict';
import http,{get} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createAuthServer} from '../auth/server.mjs';
import {createChatGPT} from '../auth/siwc-runtime.mjs';
import {ConnectionStore} from '../vendor/siwc-local/dist/storage.js';
import {authorize} from '../vendor/siwc-local/dist/oauth.js';
import {infer,listOAuthModels} from '../src/background/provider.mjs';
import {windowsCredentialEncryption} from '../auth/encryption.mjs';
const encryption=()=>{const key=randomBytes(32);return {id:'synthetic-memory-aes-gcm',isAvailable:()=>true,encrypt(text){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const b=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]);},decrypt(bytes){const b=Buffer.from(bytes),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8');}};};
const datum={kind:'term',expression:{canonical:'hone',surface:'honed',kind:'word',ipa:'',partOfSpeech:'verb',baseMeanings:['磨练'],meaning:'磨练',note:''},meaning:'技能可以磨练',explanation:'被动表达',uncertainty:'',candidates:[]};
const input={kind:'term',selected:'honed',sentence:'Skills can be honed.',context:'Skills can be honed.',before:'Skills can be',after:'.',source:{url:'https://example.com',title:'Test'}};
const stream=()=>new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(datum)})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{id:'synthetic-response',usage:{input_tokens:5,output_tokens:5}}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});

test('authentication helper isolates credentials by origin and refuses inference payloads',async t=>{
 let calls=0;const service={state:async()=>({session:{status:'disconnected',sharing:false},profiles:[]}),access:async id=>{calls++;return {accessToken:'synthetic-access',profileId:id,refreshToken:'must-never-leave-helper',idToken:'must-never-leave-helper'};},close(){}};
 const port=43829,origin='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',server=createAuthServer({origin,service,port});await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+port;
 let r=await fetch(url+'/access',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json','X-Context-Reader':'1'},body:'{}'});assert.equal(r.status,403);
 r=await fetch(url+'/access',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,404);
 r=await fetch(url+'/access',{headers:{Origin:origin}});assert.equal(r.status,404);
 r=await fetch(url+'/v1/infer',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Context-Reader':'1'},body:'{}'});assert.equal(r.status,404);
 r=await fetch(url+'/access',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Context-Reader':'1'},body:JSON.stringify({profileId:'one',input:'not-an-auth-request'})});assert.equal(r.status,400);assert.equal(calls,0);
 r=await fetch(url+'/access',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Context-Reader':'1'},body:JSON.stringify({profileId:'one'})});const result=await r.json();assert.deepEqual(result.data,{accessToken:'synthetic-access',profileId:'one'});assert.equal(r.headers.get('cache-control'),'no-store');
 r=await fetch(url+'/health');assert.equal((await r.json()).inferenceProxy,false);
});

test('privileged broker binds tokens to the expected registered profile and enforces plan scope',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'context-reader-auth-test-')),protect=encryption();t.after(()=>rm(directory,{recursive:true,force:true}));const store=new ConnectionStore(directory,protect),saved={version:2,activeProfileId:'one',profiles:[{version:1,id:'one',label:'Connection 1',clientId:'issued_test_client',subject:'test-subject',status:'connected',scopes:['openid','chatgpt.tokens.use.direct'],savedAt:new Date().toISOString(),credentials:{accessToken:'synthetic-profile-token',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000}}],pendingRegistrations:[]};
 await store.withLock(()=>store.write(saved));const client=createChatGPT({appName:'Context Reader',appId:'context-reader-test',redirectPort:0,storageDir:directory,credentialEncryption:protect,sendHostId:true});
 assert.deepEqual(await client.acquireAccessToken('one'),{accessToken:'synthetic-profile-token',profileId:'one'});await assert.rejects(client.acquireAccessToken('other'),e=>e.code==='account_mismatch');
 const file=await readFile(join(directory,'chatgpt-auth.json'),'utf8');assert.equal(file.includes('synthetic-profile-token'),false);assert.equal(file.includes('synthetic-refresh'),false);
 saved.profiles[0].scopes=['openid'];await store.withLock(()=>store.write(saved));await assert.rejects(client.acquireAccessToken('one'),e=>e.code==='sharing_not_enabled');assert.equal(JSON.stringify(await client.getSession()).includes('synthetic-profile-token'),false);
});

test('new dynamic OAuth registration includes host, PKCE and nonce and rejects stray callback state',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});const {publicKey,privateKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'context-reader-test-key',alg:'RS256',use:'sig'};let auth,tokenBody;
 globalThis.fetch=async(url,options={})=>{
  const path=String(url);if(path.endsWith('openid-configuration'))return Response.json({issuer:'https://auth.openai.com',authorization_endpoint:'https://auth.openai.com/api/accounts/authorize',token_endpoint:'https://auth.openai.com/api/accounts/oauth/token',jwks_uri:'https://auth.openai.com/.well-known/jwks.json'});
  if(path.endsWith('jwks.json'))return Response.json({keys:[jwk]});
  if(path.endsWith('/token')){tokenBody=new URLSearchParams(options.body);assert.equal(createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64url'),auth.searchParams.get('code_challenge'));const jwt=await new SignJWT({nonce:auth.searchParams.get('nonce'),email:'synthetic@example.invalid'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://auth.openai.com').setAudience('issued_dynamic_test').setSubject('synthetic-subject').setIssuedAt().setExpirationTime('1h').sign(privateKey);return Response.json({id_token:jwt,access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',expires_in:3600,scope:'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct'});}throw new Error('Unexpected network boundary');};
 const visit=url=>new Promise((resolve,reject)=>{const r=get(url,res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});r.on('error',reject);});
 const result=await authorize({appName:'Context Reader',appId:'test',redirectPort:0,sendHostId:true,openBrowser:async url=>{auth=new URL(url);assert.equal(auth.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(auth.searchParams.get('agent_name_hint'),'Context Reader');assert.equal(auth.searchParams.get('ext_agent_host_id'),'urn:uuid:synthetic-host');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');const callback=new URL(auth.searchParams.get('redirect_uri'));assert.equal(callback.hostname,'127.0.0.1');callback.searchParams.set('state','wrong');assert.equal(await visit(callback),400);callback.searchParams.set('state',auth.searchParams.get('state'));callback.searchParams.set('code','synthetic-code');callback.searchParams.set('client_id','issued_dynamic_test');assert.equal(await visit(callback),200);}},undefined,'urn:uuid:synthetic-host',AbortSignal.timeout(10000));
 assert.equal(result.clientId,'issued_dynamic_test');assert.equal(result.subject,'synthetic-subject');assert.equal(tokenBody.get('client_id'),'issued_dynamic_test');assert.equal(tokenBody.has('client_secret'),false);assert.equal(result.scopes.includes('chatgpt.tokens.use.direct'),true);
});

test('OAuth inference goes directly to the public Responses route and never uses a configured API key',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0,body;
 globalThis.fetch=async(request,init)=>{calls++;assert.equal(String(request),'https://api.openai.com/v1/responses');const headers=new Headers(init.headers);assert.equal(headers.get('authorization'),'Bearer synthetic-oauth-access');body=JSON.parse(init.body);return stream();};
 const result=await infer({mode:'oauth',model:'account-visible-model',baseUrl:'https://never-use-this.invalid',protocol:'chat'},'api-key-must-not-be-used','quick',input,{authorize:async()=>({accessToken:'synthetic-oauth-access',profileId:'one'})});assert.equal(result.provider,'openai-sdk-oauth');assert.equal(result.data.meaning,datum.meaning);assert.equal(body.stream,true);assert.equal(body.store,false);assert.equal(Array.isArray(body.input),true);assert.equal(body.input[0].role,'user');assert.equal(body.conversation,undefined);assert.equal(body.previous_response_id,undefined);assert.equal(calls,1);
 await assert.rejects(infer({mode:'oauth',model:'visible'},'api-key-must-not-be-used','quick',input,{authorize:async()=>{throw new Error('sharing_not_enabled');}}),/sharing_not_enabled/);assert.equal(calls,1);
});

test('OAuth model discovery uses the account token and filters hidden models',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/models');assert.equal(init.headers.Authorization,'Bearer synthetic-catalog-token');return Response.json({models:[{slug:'visible',display_name:'Visible model',visibility:'list'},{slug:'hidden',display_name:'Hidden',visibility:'hidden'}]});};
 assert.deepEqual(await listOAuthModels(async()=>({accessToken:'synthetic-catalog-token'})),[{slug:'visible',displayName:'Visible model'}]);
});

test('learning JSON mode declares JSON in the user input and validates the completed card locally',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let body;
 const learning={usage:'hone 搭配 skills 表示磨练技能。',memory:'把练习想成磨刀。',etymology:'',etymologySource:'',examples:[{english:'Practice hones skills.',chinese:'练习磨练技能。'},{english:'She honed her craft.',chinese:'她磨练了技艺。'}]};
 globalThis.fetch=async(_url,init)=>{body=JSON.parse(init.body);return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(learning)})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{usage:{}}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});};
 const result=await infer({mode:'oauth',model:'gpt-6-luna'},'','learn',{canonical:'hone'},{authorize:async()=>({accessToken:'synthetic-access',profileId:'one'})});
 assert.equal(body.text.format.type,'json_object');assert.match(body.input[0].content,/JSON/);assert.match(body.instructions,/JSON 的结构/);assert.equal(body.model,'gpt-6-luna');assert.deepEqual(result.data,learning);
});

test('OAuth never accepts a valid-looking JSON body from an interrupted stream',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async()=>new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(datum)})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 await assert.rejects(infer({mode:'oauth',model:'visible'},'','quick',input,{authorize:async()=>({accessToken:'synthetic-access',profileId:'one'})}),/未正常完成/);
});

test('Windows uses actual current-user DPAPI for credential round trips',{skip:process.platform!=='win32'},async()=>{const provider=windowsCredentialEncryption(),value='non-secret-integration-fixture';assert.equal(await provider.isAvailable(),true);const cipher=await provider.encrypt(value);assert.equal(Buffer.from(cipher).includes(Buffer.from(value)),false);assert.equal(await provider.decrypt(cipher),value);});
