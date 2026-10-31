import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createCredentialVault} from '../src/background/oauth-vault.mjs';
import {createBrowserOAuth,OAUTH_CALLBACK} from '../src/background/oauth.mjs';
const issuer='https://auth.openai.com',clientId='oaiapp_synthetic';
const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='synthetic';
const sign=(nonce,subject='reader',receivedAt=Date.now())=>new SignJWT({...(nonce?{nonce}:{})}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience(clientId).setSubject(subject).setIssuedAt(Math.floor(receivedAt/1000)).setExpirationTime(Math.floor(receivedAt/1000)+300).sign(privateKey);
const area=()=>{const data={};return {data,async get(key){return structuredClone({[key]:data[key]});},async set(values){Object.assign(data,structuredClone(values));}};};
async function fixture(){
 const chrome={storage:{local:area(),session:area()},runtime:{getURL:path=>'chrome-extension://test/'+path},tabs:{items:new Map(),async create(input){const tab={id:this.items.size+1,...input};this.items.set(tab.id,tab);return tab;},async update(id,input){Object.assign(this.items.get(id),input);},async remove(id){this.items.delete(id);}}};
 let encrypted={};const adapter={async read(){return structuredClone(encrypted);},async write(value){encrypted=structuredClone(value);}};const vault=createCredentialVault({adapter});
 const calls=[];let subject='reader',badNonce=false,denied=false,delayRefresh,failRevoke=false,omitRefreshIdentity=false,temporaryFailure=false,keyOutage=false,clock=Date.now();
 const request=async(url,options={})=>{
  const path=new URL(url).pathname;calls.push({path,body:options.body});
  if(path==='/.well-known/openid-configuration')return Response.json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',revocation_endpoint:issuer+'/revoke'});
  if(path==='/jwks'&&keyOutage)throw new TypeError('Synthetic key outage');
  if(path==='/jwks')return Response.json({keys:[jwk]});
  if(path==='/token'){
   const body=new URLSearchParams(options.body);assert.equal(body.has('client_secret'),false);assert.equal(body.get('resource'),'https://api.openai.com/v1');
   if(temporaryFailure)return Response.json({error:'server_error'},{status:503});
   if(denied)return Response.json({error:'invalid_grant'},{status:400});
   if(body.get('grant_type')==='refresh_token'&&delayRefresh)await delayRefresh;
   const attempt=chrome.storage.session.data.chatgptSession?.attempt;
   return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-rotated-refresh',token_type:'Bearer',expires_in:3600,...(omitRefreshIdentity&&body.get('grant_type')==='refresh_token'?{}:{scope:'openid offline_access chatgpt.tokens.use.direct',id_token:await sign(badNonce?'wrong':body.get('grant_type')==='refresh_token'?undefined:nonce,subject,clock)})});
  }
  if(path==='/revoke')return new Response('',{status:failRevoke?503:200});
  throw new Error('Unexpected request '+path);
 };
 let service=createBrowserOAuth({chrome,fetch:request,now:()=>clock,vault}),nonce;
 const begin=async(input={})=>{const result=await service.begin(input),tab=[...chrome.tabs.items.values()].at(-1),url=new URL(tab.url);nonce=url.searchParams.get('nonce');return {...result,tab,url};};
 const callback=async(attempt,params={})=>service.callback({type:'main_frame',frameId:0,tabId:attempt.tab.id,url:OAUTH_CALLBACK+'?'+new URLSearchParams({state:attempt.attemptId,code:'synthetic-code',client_id:clientId,...params})});
 return {chrome,calls,begin,callback,vault,encrypted:()=>encrypted,get service(){return service;},restart(){service=createBrowserOAuth({chrome,fetch:request,now:()=>clock,vault});},advance(ms){clock+=ms;},subject(value){subject=value;},badNonce(){badNonce=true;},deny(){denied=true;},delay(value){delayRefresh=value;},failRevoke(){failRevoke=true;},omitRefreshIdentity(){omitRefreshIdentity=true;},temporaryFailure(value){temporaryFailure=value;},keyOutage(value){keyOutage=value;}};
}
test('browser OAuth uses PKCE and issued registration; renderer state never contains credentials',async()=>{
 const f=await fixture(),a=await f.begin();assert.equal(a.url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(a.url.searchParams.get('redirect_uri'),OAUTH_CALLBACK);assert.equal(a.url.searchParams.get('code_challenge_method'),'S256');assert.ok(a.url.searchParams.get('ext_agent_host_id'));assert.equal(a.url.searchParams.has('client_secret'),false);
 assert.equal(await f.callback(a),true);const result=await f.service.poll(a.attemptId);assert.equal(result.status,'complete');assert.equal(result.session.sharing,true);assert.equal((await f.service.access(result.session.profileId)).accessToken,'synthetic-access');
 assert.equal(/Token|verifier|nonce/.test(JSON.stringify(await f.service.state())),false);assert.equal(/Token|synthetic-access|synthetic-rotated-refresh/.test(JSON.stringify(f.chrome.storage.local.data)),false);
 assert.equal(JSON.stringify(f.chrome.storage.session.data).includes('synthetic-access'),false);assert.equal(JSON.stringify(f.chrome.storage.session.data).includes('synthetic-code'),false);
 const body=new URLSearchParams(f.calls.find(c=>c.path==='/token').body);assert.equal(body.get('client_id'),clientId);assert.equal(body.get('redirect_uri'),OAUTH_CALLBACK);assert.ok(body.get('code_verifier'));
});
test('callback rejects wrong tab, frame, origin, path, state and repeated parameters without exchanging',async()=>{
 const f=await fixture(),a=await f.begin(),base={type:'main_frame',frameId:0,tabId:a.tab.id,url:OAUTH_CALLBACK+'?state='+a.attemptId+'&code=c&client_id='+clientId};
 for(const patch of [{tabId:999},{frameId:1},{type:'sub_frame'},{url:base.url.replace('127.0.0.1','localhost')},{url:base.url.replace('/auth/callback','/callback')},{url:base.url+'&state=duplicate'},{url:base.url.replace(a.attemptId,'wrong')}])assert.equal(await f.service.callback({...base,...patch}),false);
 assert.equal(f.calls.filter(c=>c.path==='/token').length,0);await f.callback(a);assert.equal(await f.callback(a),false);assert.equal(f.calls.filter(c=>c.path==='/token').length,1);
});
test('denial, cancellation, closed login tab and timeout do not exchange or replay codes',async()=>{
 const f=await fixture();let a=await f.begin();await f.callback(a,{error:'access_denied'});assert.equal((await f.service.poll(a.attemptId)).status,'error');
 a=await f.begin();await f.service.cancel(a.attemptId);assert.equal(await f.callback(a),false);
 a=await f.begin();await f.service.tabClosed(a.tab.id);assert.equal((await f.service.poll(a.attemptId)).status,'cancelled');
 a=await f.begin();f.advance(600001);assert.equal((await f.service.poll(a.attemptId)).status,'error');assert.equal(f.calls.filter(c=>c.path==='/token').length,0);
});
test('pending sign-in survives worker restart; interrupted exchange never replays',async()=>{
 const f=await fixture(),a=await f.begin();f.restart();await f.callback(a);assert.equal((await f.service.poll(a.attemptId)).status,'complete');
 const b=await f.begin();f.chrome.storage.session.data.chatgptSession.attempt.status='exchanging';f.restart();assert.equal((await f.service.poll(b.attemptId)).status,'error');assert.equal(f.calls.filter(c=>c.path==='/token').length,1);
});
test('failed exchange retains registration, and invalid identity preserves active account',async()=>{
 const f=await fixture(),a=await f.begin();await f.callback(a);const original=(await f.service.state()).session.profileId;
 f.subject('other');const b=await f.begin({profileId:original});await f.callback(b);assert.equal((await f.service.poll(b.attemptId)).status,'error');assert.equal((await f.service.state()).session.profileId,original);assert.equal((await f.service.state()).session.identity?.email,undefined);
 const next=await f.begin();f.badNonce();await f.callback(next);assert.equal((await f.service.poll(next.attemptId)).status,'error');assert.equal((await f.service.state()).session.profileId,original);
 const retained=f.chrome.storage.local.data.chatgptAccounts.profiles.find(p=>p.id!==original);assert.equal(retained.clientId,clientId);
});
test('refresh is single flight, validates account identity, and stays out of persistent storage',async()=>{
 const f=await fixture(),a=await f.begin();await f.callback(a);const id=(await f.service.state()).session.profileId;f.advance(3600001);f.restart();
 const values=await Promise.all([f.service.access(id),f.service.access(id)]);assert.equal(values[0].accessToken,values[1].accessToken);assert.equal(f.calls.filter(c=>c.path==='/token').length,2);
 assert.equal(/synthetic-access|synthetic-rotated-refresh/.test(JSON.stringify(f.chrome.storage.local.data)),false);
 f.advance(3600001);f.restart();f.subject('other');await assert.rejects(f.service.access(id),/账号不一致/);assert.equal((await f.service.state()).session.status,'disconnected');
});
test('an uncertain refresh is never replayed after worker termination',async()=>{
 const f=await fixture(),a=await f.begin();await f.callback(a);const id=(await f.service.state()).session.profileId;
 const credentials=await f.vault.read();credentials[id].refreshInFlight=true;await f.vault.write(credentials);f.restart();await assert.rejects(f.service.access(id),/重新登录/);assert.equal(f.calls.filter(c=>c.path==='/token').length,1);
});
test('logout clears persisted credentials even when revocation fails; browser exit preserves a valid login',async()=>{
 const f=await fixture(),a=await f.begin();await f.callback(a);const id=(await f.service.state()).session.profileId;
 f.failRevoke();await assert.rejects(f.service.disconnect(id),/无法确认远程撤销/);assert.equal((await f.service.state()).session.status,'disconnected');assert.equal(JSON.stringify(f.chrome.storage.session.data).includes('synthetic-rotated-refresh'),false);
 const b=await f.begin();await f.callback(b);f.chrome.storage.session.data.chatgptSession=undefined;f.restart();assert.equal((await f.service.state()).session.status,'connected');assert.equal((await f.service.state()).profiles.length,2);assert.equal((await f.service.access((await f.service.state()).session.profileId)).accessToken,'synthetic-access');
});

test('refresh may omit unchanged scopes and a replacement ID token',async()=>{
 const f=await fixture(),a=await f.begin();await f.callback(a);const id=(await f.service.state()).session.profileId;f.advance(3600001);f.restart();f.omitRefreshIdentity();assert.equal((await f.service.access(id)).accessToken,'synthetic-access');assert.equal((await f.service.state()).session.sharing,true);
});
test('switching saved profiles cancels a pending new sign-in before it can replace selection',async()=>{
 const f=await fixture(),a=await f.begin();await f.callback(a);const id=(await f.service.state()).session.profileId,b=await f.begin();await f.service.select(id);assert.equal(await f.callback(b),false);assert.equal((await f.service.state()).session.profileId,id);
});

test('browser restart reuses a valid access token without an early refresh or new consent',async()=>{
 const f=await fixture(),a=await f.begin();await f.callback(a);const id=(await f.service.state()).session.profileId;
 f.chrome.storage.session.data.chatgptSession=undefined;f.restart();assert.equal((await f.service.access(id)).accessToken,'synthetic-access');assert.equal(f.calls.filter(c=>c.path==='/token').length,1);
 const encrypted=f.encrypted();assert.equal(encrypted.key.extractable,false);assert.ok(encrypted.record.bytes instanceof Uint8Array);
 assert.equal(JSON.stringify(encrypted).includes('synthetic-access'),false);assert.equal(JSON.stringify(f.chrome.storage.session.data).includes('synthetic-rotated-refresh'),false);
});
test('temporary refresh service failures preserve the login for a later retry',async()=>{
 const f=await fixture(),a=await f.begin();await f.callback(a);const id=(await f.service.state()).session.profileId;
 f.advance(3600001);f.temporaryFailure(true);await assert.rejects(f.service.access(id));assert.equal((await f.service.state()).session.status,'connected');f.restart();f.temporaryFailure(false);assert.equal((await f.service.access(id)).accessToken,'synthetic-access');
});
test('revoked grants require login and are never automatically exchanged again',async()=>{
 const f=await fixture(),a=await f.begin();await f.callback(a);const id=(await f.service.state()).session.profileId;f.advance(3600001);f.deny();await assert.rejects(f.service.access(id));f.restart();await assert.rejects(f.service.access(id));assert.equal(f.calls.filter(c=>c.path==='/token').length,2);
});
test('a JWKS outage checkpoints rotation and recovers after browser restart without replaying refresh',async()=>{
 const f=await fixture(),a=await f.begin();await f.callback(a);const id=(await f.service.state()).session.profileId;f.advance(3600001);f.restart();f.keyOutage(true);await assert.rejects(f.service.access(id));assert.ok((await f.vault.read())[id].pendingRefresh);assert.equal((await f.service.state()).session.status,'connected');
 f.restart();f.keyOutage(false);assert.equal((await f.service.access(id)).accessToken,'synthetic-access');assert.equal(f.calls.filter(c=>c.path==='/token').length,2);
});
test('an existing session login migrates into the encrypted vault without new authorization',async()=>{
 const f=await fixture();f.chrome.storage.local.data.chatgptAccounts={selected:'legacy',profiles:[{id:'legacy',clientId,subject:'reader',label:'Reader'}]};
 f.chrome.storage.session.data.chatgptSession={connections:{legacy:{accessToken:'synthetic-access',refreshToken:'synthetic-rotated-refresh',subject:'reader',scopes:['chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000}}};
 assert.equal((await f.service.state()).session.status,'connected');assert.equal(f.chrome.storage.session.data.chatgptSession.connections,undefined);f.chrome.storage.session.data.chatgptSession=undefined;f.restart();assert.equal((await f.service.access('legacy')).accessToken,'synthetic-access');assert.equal(f.calls.length,0);
});
