// Browser adaptation of the OpenAI Sign-in DevKit OAuth flow.
// Sign-in with ChatGPT DevKit Noncommercial License v1.0: vendor/siwc-local/LICENSE.
import {createCredentialVault} from './oauth-vault.mjs';
import {createRemoteJWKSet, jwtVerify, customFetch} from 'jose';
const ISSUER='https://auth.openai.com',RESOURCE='https://api.openai.com/v1';
export const OAUTH_CALLBACK='http://127.0.0.1:43821/auth/callback';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const LOCAL='chatgptAccounts',SESSION='chatgptSession';
const failure=(code,message)=>Object.assign(new Error(message),{code});
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const publicError=error=>({code:error.code||'connection_error',message:({access_denied:'本次登录或订阅授权未获允许。',invalid_grant:'授权已失效，请重新登录。',cancelled:'本次登录已取消。',account_mismatch:'登录账号与所选账号不同，请选择原账号或添加账号。',expired:'登录已超时，请重新登录。',invalid_id_token:'无法验证 ChatGPT 身份，请重新登录。'})[error.code]||'ChatGPT 连接未完成，请重试登录。'});

export function createBrowserOAuth({chrome,fetch:request=(...args)=>globalThis.fetch(...args),now=Date.now,vault=createCredentialVault()}={}){
 const refreshes=new Map(),keys=new Map();
 let discoveryPromise,serial=Promise.resolve(),activeExchange=false,controller,activeAttemptId,migration;
 const exclusive=fn=>{const next=serial.then(fn);serial=next.catch(()=>{});return next;};
 const local=async()=>({profiles:[],...(await chrome.storage.local.get(LOCAL))[LOCAL]});
 async function migrate(){
  migration??=(async()=>{const previous=(await chrome.storage.session.get(SESSION))[SESSION];if(previous?.connections){
   await vault.write({...await vault.read(),...previous.connections});
   const {connections,...runtime}=previous;await chrome.storage.session.set({[SESSION]:runtime});
  }})().catch(error=>{migration=undefined;throw error;});return migration;
 }
 const session=async()=>{await migrate();return {...(await chrome.storage.session.get(SESSION))[SESSION],connections:await vault.read()};};
 const saveLocal=value=>chrome.storage.local.set({[LOCAL]:value});
 const saveSession=async value=>{await vault.write(value.connections);const {connections,...runtime}=value;await chrome.storage.session.set({[SESSION]:runtime});};
 async function json(url,options={}){
  let response;try{response=await request(url,{...options,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}catch(error){if(options.signal?.aborted)throw failure('cancelled','本次操作已取消。');throw failure('network_error','无法连接 OpenAI，请检查网络后重试。');}
  let data;try{data=await response.json();}catch{throw failure('invalid_response','OpenAI 返回了无法读取的响应。');}
  if(!response.ok){const code=typeof data.error==='string'?data.error:data.error?.code;throw Object.assign(failure(/^[a-z_]{1,80}$/.test(code)?code:'service_error','OpenAI 暂未完成请求，请稍后重试。'),{status:response.status,retryable:response.status===429||response.status>=500});}
  return data;
 }
 async function discovery(){
  discoveryPromise??=json(ISSUER+'/.well-known/openid-configuration').then(data=>{
   if(data.issuer!==ISSUER)throw failure('discovery_failed','无法验证 OpenAI 登录配置。');
   for(const name of ['authorization_endpoint','token_endpoint','jwks_uri','revocation_endpoint']){
    if(name==='revocation_endpoint'&&!data[name])continue;
    if(typeof data[name]!=='string'||new URL(data[name]).origin!==ISSUER)throw failure('discovery_failed','无法验证 OpenAI 登录配置。');
   }return data;
  }).catch(error=>{discoveryPromise=undefined;throw error;});return discoveryPromise;
 }
 async function identity(idToken,clientId,nonce,receivedAt){
  if(typeof idToken!=='string')throw failure('invalid_id_token','OpenAI 未返回可验证的身份。');
  const config=await discovery();let resolver=keys.get(config.jwks_uri);
  if(!resolver){resolver=createRemoteJWKSet(new URL(config.jwks_uri),{[customFetch]:async(url,options)=>{try{const response=await request(url,{...options,redirect:'error'});if(response.status!==200)throw new Error();const body=await response.json();if(!Array.isArray(body.keys))throw new Error();return Response.json(body);}catch{throw failure('identity_verification_unavailable','暂时无法读取 OpenAI 身份验证密钥，登录已保留，请稍后重试。');}},timeoutDuration:15000});keys.set(config.jwks_uri,resolver);}
  let payload;try{({payload}=await jwtVerify(idToken,resolver,{issuer:ISSUER,audience:clientId,algorithms:['RS256'],clockTolerance:5,requiredClaims:['iss','aud','exp','iat','sub'],...(receivedAt?{currentDate:new Date(receivedAt)}:{})}));}catch(error){keys.delete(config.jwks_uri);if(error.code==='identity_verification_unavailable')throw error;if(['ERR_JWKS_TIMEOUT','ERR_JWKS_NO_MATCHING_KEY','ERR_JWKS_INVALID'].includes(error.code)||error instanceof TypeError)throw failure('identity_verification_unavailable','暂时无法读取 OpenAI 身份验证密钥，登录已保留，请稍后重试。');throw failure('invalid_id_token','无法验证 ChatGPT 身份，请重新登录。');}
  if(typeof payload.sub!=='string'||!payload.sub||(nonce!==undefined&&payload.nonce!==nonce)||(payload.azp!==undefined&&payload.azp!==clientId)||(Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==clientId))throw failure('invalid_id_token','ChatGPT 身份与本次登录不符。');
  return {subject:payload.sub,identity:{...(typeof payload.email==='string'?{email:payload.email}:{}),...(typeof payload.name==='string'?{name:payload.name}:{})}};
 }
 async function tokens(params,signal){const config=await discovery();return json(config.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({...params,resource:RESOURCE}),signal});}
 function fields(data){
  if(typeof data.scope!=='string'||(data.access_token!==undefined&&typeof data.access_token!=='string')||(data.access_token&&(String(data.token_type).toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=0)))throw failure('invalid_token_response','OpenAI 返回的授权不完整，请重新登录。');
  const scopes=data.scope.split(/\s+/).filter(Boolean);
  if(scopes.includes('chatgpt.tokens.use.direct')&&!(typeof data.access_token==='string'&&data.access_token))throw failure('invalid_token_response','OpenAI 未返回订阅凭据。');
  if(scopes.includes('offline_access')&&!(typeof data.refresh_token==='string'&&data.refresh_token))throw failure('invalid_token_response','OpenAI 未返回刷新凭据。');
  return {scopes,expiresAt:data.access_token?now()+data.expires_in*1000:0,...(data.access_token?{accessToken:data.access_token}:{}),...(data.refresh_token?{refreshToken:data.refresh_token}:{}),...(data.earliest_refresh_at?{earliestRefreshAt:data.earliest_refresh_at}:{})};
 }
 function snapshot(meta,current){
  const profiles=meta.profiles.map(profile=>({id:profile.id,label:profile.label||'ChatGPT 账号',identity:profile.identity,status:current.connections[profile.id]&&(!current.connections[profile.id].refreshInFlight||current.connections[profile.id].pendingRefresh||refreshes.has(profile.id))?'connected':'disconnected'}));
  const selected=meta.profiles.find(p=>p.id===meta.selected),connection=current.connections[meta.selected];
  return {session:connection&&(!connection.refreshInFlight||connection.pendingRefresh||refreshes.has(meta.selected))?{status:'connected',sharing:connection.scopes.includes('chatgpt.tokens.use.direct'),profileId:meta.selected,identity:connection.identity}:{status:'disconnected',sharing:false,profileId:selected?.id||''},profiles};
 }
 async function state(){return snapshot(await local(),await session());}
 async function begin(input={}){return exclusive(async()=>{
  const current=await session();if(current.attempt?.status==='pending'&&current.attempt.created+600000>now())throw failure('connection_busy','另一个登录正在进行，请先完成或取消。');
  const meta=await local(),previous=meta.profiles.find(p=>p.id===input.profileId);
  if(input.profileId&&!previous)throw failure('account_mismatch','所选账号已不存在，请添加账号。');
  meta.hostId||='urn:uuid:'+crypto.randomUUID();await saveLocal(meta);
  const config=await discovery(),id=random(),verifier=random(),nonce=random();
  const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const url=new URL(config.authorization_endpoint);url.search=new URLSearchParams({client_id:previous?.clientId||'dynamic_agent_client',response_type:'code',redirect_uri:OAUTH_CALLBACK,scope:SCOPES,resource:RESOURCE,state:id,nonce,code_challenge_method:'S256',code_challenge:challenge,ext_agent_host_id:meta.hostId});
  if(!previous?.clientId)url.searchParams.set('agent_name_hint','Context Reader');
  if(previous?.identity?.email)url.searchParams.set('login_hint',previous.identity.email);
  if(input.reconsent)url.searchParams.set('prompt','consent');
  const tab=await chrome.tabs.create({url:'about:blank'});
  current.attempt={id,status:'pending',created:now(),tabId:tab.id,profileId:previous?.id||crypto.randomUUID(),clientId:previous?.clientId,subject:previous?.subject,verifier,nonce};await saveSession(current);
  try{await chrome.tabs.update(tab.id,{url:url.href});}catch(error){delete current.attempt;await saveSession(current);await chrome.tabs.remove(tab.id).catch(()=>{});throw error;}
  return {attemptId:id};
 });}
 async function finishTab(tabId){await chrome.tabs.update(tabId,{url:chrome.runtime.getURL('oauth-result.html')}).catch(()=>{});}
 async function callback(details){
  if(details.type!=='main_frame'||details.frameId!==0)return false;
  let url;try{url=new URL(details.url);}catch{return false;}
  if(url.origin+url.pathname!==OAUTH_CALLBACK||url.hash)return false;
  return exclusive(async()=>{
   const current=await session(),attempt=current.attempt;
   if(!attempt||attempt.status!=='pending'||details.tabId!==attempt.tabId||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==attempt.id)return false;
   activeExchange=true;activeAttemptId=attempt.id;controller=new AbortController();
   current.attempt={id:attempt.id,profileId:attempt.profileId,tabId:attempt.tabId,created:attempt.created,status:'exchanging'};await saveSession(current);
   await finishTab(attempt.tabId);
   try{
    if(attempt.created+600000<=now())throw failure('expired','登录已超时，请重新登录。');
    if(url.searchParams.has('error'))throw failure(url.searchParams.get('error'),'本次登录没有完成。');
    const supplied=url.searchParams.get('client_id'),clientId=supplied||attempt.clientId,code=url.searchParams.get('code');
    if(!code||!clientId||!(/^[a-zA-Z0-9_-]{1,200}$/).test(clientId)||clientId==='dynamic_agent_client'||(attempt.clientId&&supplied&&supplied!==attempt.clientId)||url.searchParams.getAll('code').length!==1||url.searchParams.getAll('client_id').length>1)throw failure('registration_incomplete','授权回调与本次注册不符。');
    const meta=await local();let profile=meta.profiles.find(p=>p.id===attempt.profileId);
    if(!profile){profile={id:attempt.profileId,clientId,label:'ChatGPT 账号'};meta.profiles.push(profile);}else profile.clientId=clientId;
    // Registration survives a failed one-time code exchange. No code is replayed.
    await saveLocal(meta);
    const data=await tokens({grant_type:'authorization_code',client_id:clientId,code,code_verifier:attempt.verifier,redirect_uri:OAUTH_CALLBACK},controller.signal);
    const connection={...fields(data),...await identity(data.id_token,clientId,attempt.nonce),idToken:data.id_token};
    if(attempt.subject&&connection.subject!==attempt.subject)throw failure('account_mismatch','登录账号与所选账号不同，请选择原账号或添加账号。');
    controller.signal.throwIfAborted();
    Object.assign(profile,{subject:connection.subject,identity:connection.identity,label:connection.identity.email||connection.identity.name||'ChatGPT 账号'});meta.selected=profile.id;
    current.connections[profile.id]=connection;current.attempt.status='complete';await saveSession(current);await saveLocal(meta);
   }catch(error){current.attempt.status=error.code==='cancelled'?'cancelled':'error';current.attempt.error=publicError(error);await saveSession(current);}
   finally{activeExchange=false;activeAttemptId=undefined;controller=undefined;}
   return true;
  });
 }
 async function poll(id){return exclusive(async()=>{
  const current=await session(),attempt=current.attempt;if(!attempt||attempt.id!==id)return {status:'expired'};
  if((attempt.status==='pending'&&attempt.created+600000<=now())||(attempt.status==='exchanging'&&!activeExchange)){
   current.attempt={id:attempt.id,status:'error',error:{code:'interrupted',message:'登录已超时或被中断，请重新登录。'}};await saveSession(current);
  }
  const result=current.attempt;return {status:result.status==='exchanging'?'pending':result.status,...(result.error?{error:result.error}:{}),...(result.status==='complete'?{session:(await state()).session}:{})};
 });}
 async function cancel(id){if(activeAttemptId===id)controller?.abort();return exclusive(async()=>{
  const current=await session();if(current.attempt?.id===id){const tabId=current.attempt.tabId;current.attempt={id,status:'cancelled'};await saveSession(current);if(tabId!==undefined)await chrome.tabs.remove(tabId).catch(()=>{});}return {cancelled:true};
 });}
 async function tabClosed(tabId){const current=await session();if(current.attempt?.tabId===tabId&&current.attempt.status==='pending')await cancel(current.attempt.id);}
 async function select(id){controller?.abort();return exclusive(async()=>{const meta=await local();if(!meta.profiles.some(p=>p.id===id))throw failure('account_mismatch','所选账号已不存在。');const current=await session();if(current.attempt?.status==='pending'){const {id:attemptId,tabId}=current.attempt;current.attempt={id:attemptId,status:'cancelled'};await saveSession(current);await chrome.tabs.remove(tabId).catch(()=>{});}meta.selected=id;await saveLocal(meta);return state();});}
 async function access(profileId,{signal}={}){
  const meta=await local(),current=await session(),connection=current.connections[profileId],profile=meta.profiles.find(p=>p.id===profileId);
  if(profileId&&meta.selected===profileId&&refreshes.has(profileId))return refreshes.get(profileId);
  if(!profileId||meta.selected!==profileId||!connection||(connection.refreshInFlight&&!connection.pendingRefresh)||!profile)throw failure('sign_in_required','ChatGPT 授权已失效或上次刷新被中断，请重新登录。');
  if(!connection.scopes.includes('chatgpt.tokens.use.direct'))throw failure('sharing_not_enabled','请先授权使用 ChatGPT 订阅额度。');
  if(!connection.pendingRefresh&&connection.accessToken&&connection.expiresAt>now()+5000)return {accessToken:connection.accessToken,profileId};
  if(!refreshes.has(profileId)){
   const pending=exclusive(async()=>{
    const latest=await local(),live=await session(),saved=live.connections[profileId];
    if(latest.selected!==profileId||!saved?.refreshToken||(saved.refreshInFlight&&!saved.pendingRefresh))throw failure('sign_in_required','请重新登录 ChatGPT。');
    let dispatched=false;
    try{
     if(!saved.pendingRefresh){
      const earliest=typeof saved.earliestRefreshAt==='number'?(saved.earliestRefreshAt<1e12?saved.earliestRefreshAt*1000:saved.earliestRefreshAt):Date.parse(saved.earliestRefreshAt||'');
      if(earliest>now())throw failure('refresh_not_due','OpenAI 暂不允许刷新授权，请稍后重试。');
      const config=await discovery();signal?.throwIfAborted();
      saved.refreshInFlight=true;await saveSession(live);
      dispatched=true;
      const data=await json(config.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'refresh_token',client_id:profile.clientId,refresh_token:saved.refreshToken,resource:RESOURCE}),signal});
      // Save the rotated successor before JWKS retrieval. Recovery verifies this
      // response; it never sends the already-consumed refresh grant again.
      const next=fields({...data,scope:data.scope??saved.scopes.join(' ')});
      saved.pendingRefresh={...next,idToken:data.id_token??saved.idToken,verifyIdentity:data.id_token!==undefined,receivedAt:now()};
      await saveSession(live);
     }
     const rotation=saved.pendingRefresh;
     if(!Number.isFinite(rotation.receivedAt)||rotation.receivedAt>now()+5000)throw failure('invalid_id_token','刷新身份记录无效，请重新登录。');
     const verified=rotation.verifyIdentity?await identity(rotation.idToken,profile.clientId,undefined,rotation.receivedAt):{subject:saved.subject,identity:saved.identity};
     if(verified.subject!==profile.subject)throw failure('account_mismatch','刷新后的账号不一致，请重新登录。');
     const {verifyIdentity,receivedAt,...credential}=rotation;
     live.connections[profileId]={...credential,...verified};await saveSession(live);
     // A checkpoint can outlive its access token. Its verified refresh successor
     // remains usable, but an expired access token is never sent to inference.
     if(credential.expiresAt<=now()+5000)throw failure('access_expired','登录已恢复，请重试本次操作以更新访问凭据。');
     return {accessToken:credential.accessToken,profileId};
    }catch(error){
     if(['invalid_grant','invalid_refresh_token','refresh_token_expired','refresh_token_invalidated','refresh_token_reused','invalid_id_token','account_mismatch'].includes(error.code))delete live.connections[profileId];
     else if(!saved.pendingRefresh&&(!dispatched||error.retryable))delete saved.refreshInFlight;
     // Unknown dispatched outcomes retain the durable marker and require an
     // explicit reauthorization. No automatic replay of an uncertain grant.
     if(error.code!=='credential_storage_unavailable'&&error.code!=='access_expired')await saveSession(live);
     throw error;
    }
   });refreshes.set(profileId,pending);void pending.finally(()=>refreshes.delete(profileId)).catch(()=>{});
  }
  return refreshes.get(profileId);
 }
 async function disconnect(profileId){controller?.abort();return exclusive(async()=>{
  const meta=await local(),current=await session(),profile=meta.profiles.find(p=>p.id===profileId);
  if(!profileId||meta.selected!==profileId)throw failure('account_mismatch','账号已切换，请重新选择后退出。');
  const token=current.connections[profileId]?.pendingRefresh?.refreshToken||current.connections[profileId]?.refreshToken;delete current.connections[profileId];
  if(current.attempt){const tabId=current.attempt.tabId;delete current.attempt;await saveSession(current);if(tabId!==undefined)await chrome.tabs.remove(tabId).catch(()=>{});}else await saveSession(current);
  // Keep the account/client mapping for later reauthorization on this host.
  await saveLocal(meta);
  if(token)try{const config=await discovery();if(!config.revocation_endpoint)throw new Error();const response=await request(config.revocation_endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:profile.clientId,token,token_type_hint:'refresh_token'})});if(!response.ok)throw new Error();}catch{throw failure('revocation_failed','已清除本机登录，但无法确认远程撤销。可在 ChatGPT 设置中撤销应用授权。');}
  return state();
 });}
 return {state,begin,callback,poll,cancel,tabClosed,select,access,disconnect};
}
