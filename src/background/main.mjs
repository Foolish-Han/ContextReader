import { DEFAULTS, sanitizeRequest, contextKey, providerIdentity, errorText, validateEndpoint,surroundings,safeUrl,digest } from '../shared/core.mjs';
import { createRepository, indexedAdapter } from '../shared/store.mjs';
import {infer,listOAuthModels} from './provider.mjs';
import {createBrowserOAuth} from './oauth.mjs';
import {createReadingController} from './reading.mjs';
import {createTaskQueue,connectionIdentity,taskConfig} from './tasks.mjs';
import {createGoogleDrive} from './google-drive.mjs';
import {createCloudSync} from './cloud-sync.mjs';
const reading=createReadingController(chrome);
const oauthControllers=new Set();
const repository=createRepository(indexedAdapter());
const retainWorker=()=>{const timer=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);return ()=>clearInterval(timer);};
const privateUi=sender=>sender.url?.startsWith(chrome.runtime.getURL(''));
const initialize=Promise.all([chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})]);
async function settings(){await initialize;const cfg={...DEFAULTS,...(await chrome.storage.local.get('settings')).settings};if(cfg.mode==='codex')cfg.mode='oauth';delete cfg.oauthUrl;return cfg;}
async function apiKey(){return (await chrome.storage.session.get('apiKey')).apiKey||(await chrome.storage.local.get('apiKey')).apiKey||'';}

const oauth=createBrowserOAuth({chrome});
chrome.webRequest.onBeforeRequest.addListener(details=>{void initialize.then(()=>oauth.callback(details)).catch(()=>{});},{urls:['http://127.0.0.1/*'],types:['main_frame']});
chrome.tabs.onRemoved.addListener(tabId=>{void initialize.then(()=>oauth.tabClosed(tabId)).catch(()=>{});});
async function authorize(cfg,signal){try{return await oauth.access(cfg.oauthProfileId,{signal});}catch(error){throw Object.assign(error,{code:'connection'});}}
async function languageInfer(cfg,key,task,payload,options={}){
 const controller=new AbortController();if(cfg.mode==='oauth')oauthControllers.add(controller);
 try{return await infer({...cfg,model:cfg.mode==='oauth'?cfg.oauthModel:cfg.model},key,task,payload,{...options,signal:AbortSignal.any([AbortSignal.timeout(120000),controller.signal,...(options.signal?[options.signal]:[])]),authorize:()=>key&&typeof key==='object'?Promise.resolve(key):authorize(cfg)});}finally{oauthControllers.delete(controller);}
}
function stopOAuthRequests(){for(const controller of oauthControllers)controller.abort();}
async function saveOAuthSelection(session,models=[],activate=false){const cfg=await settings();if(activate)cfg.mode='oauth';cfg.oauthProfileId=session.profileId||'';cfg.oauthModel=models.some(m=>m.slug===cfg.oauthModel)?cfg.oauthModel:models.some(m=>m.slug===DEFAULTS.oauthModel)?DEFAULTS.oauthModel:'';await chrome.storage.local.set({settings:cfg});return cfg;}
async function oauthModels(cfg){return listOAuthModels(()=>authorize(cfg),{signal:AbortSignal.timeout(20000)});}

async function publish(){const tabs=await chrome.tabs.query({});await Promise.allSettled(tabs.filter(t=>t.id).map(t=>chrome.tabs.sendMessage(t.id,{type:'CR_INDEX_CHANGED'})));chrome.runtime.sendMessage({type:'CR_LIBRARY_CHANGED'}).catch(()=>{});chrome.runtime.sendMessage({type:'CR_TASKS_CHANGED'}).catch(()=>{});}
async function requestHash(request){return contextKey(request,providerIdentity(await settings()));}
const tasks=createTaskQueue({repository,getSettings:settings,retainWorker,publish,
 getCredential:async (config,{signal}={})=>{if(connectionIdentity(taskConfig(await settings()))!==connectionIdentity(config))throw Object.assign(new Error('提交时的连接已改变，请恢复原连接或重新提交。'),{code:'connection'});if(config.mode==='oauth')return authorize(config,signal);const key=await apiKey();if(config.mode==='api'){if(!key)throw Object.assign(new Error('此任务需要原 API Key。请到连接设置中恢复。'),{code:'connection'});if(config.apiKeyId){const refs=(await chrome.storage.local.get('apiKeyReferences')).apiKeyReferences||{};if(refs[await digest('context-reader-key-reference:'+key)]!==config.apiKeyId)throw Object.assign(new Error('密钥与此任务的连接不一致，请重新保存原连接。'),{code:'connection'});}}return key;},
 runInference:languageInfer,
 setWake:async needed=>{if(needed){if(!await chrome.alarms.get('cr-tasks'))await chrome.alarms.create('cr-tasks',{periodInMinutes:1});}else await chrome.alarms.clear('cr-tasks');}
});
void initialize.then(()=>tasks.initialize()).catch(()=>{});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='cr-tasks')void tasks.initialize().then(()=>tasks.wake());});
const googleClientId=chrome.runtime.getManifest().oauth2?.client_id||'';
const cloud=createCloudSync({repository,storage:chrome.storage.local,clientId:googleClientId,drive:createGoogleDrive({identity:chrome.identity,clientId:googleClientId}),retainWorker,
 notify:async()=>{await tasks.reconcile();await publish();chrome.runtime.sendMessage({type:'CR_CLOUD_CHANGED'}).catch(()=>{});},
 setWake:async needed=>{if(needed){if(!await chrome.alarms.get('cr-cloud'))await chrome.alarms.create('cr-cloud',{periodInMinutes:1});}else await chrome.alarms.clear('cr-cloud');}
});
repository.onKnowledgeChange(()=>cloud.schedule());
void initialize.then(()=>cloud.initialize()).catch(()=>{});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='cr-cloud')void cloud.sync().catch(()=>{});});
async function commitCandidate(result,request,hash,provider){
 const saved=await repository.saveTerm({...result.expression,meaning:result.meaning,note:result.explanation,uncertainty:result.uncertainty},request,hash,provider);if(saved.created)await tasks.enrich(saved.entry.id);await publish();return {kind:'term',...(await repository.get(saved.entry.id,hash)),cached:false};
}
export async function dispatch(type,payload,sender,progress=()=>{}){
  await initialize;
  if(type==='CR_GET_INDEX')return repository.index();
  if(type==='CR_GET_ENTRY'){const req=payload.request?sanitizeRequest(payload.request):null;return repository.get(payload.id,req?await requestHash(req):'',req);}
  if(type==='CR_PAGE_TASKS')return tasks.pageTasks(safeUrl(sender.url));
  if(type==='CR_TASK_ANCHORS')return tasks.observeAnchors(safeUrl(sender.url),payload.found);
  if(type==='CR_READING_POLICY')return reading.state(sender.url);
    if(type==='CR_APPEARANCE'){const value=(await chrome.storage.local.get('appearance')).appearance;return ['light','dark'].includes(value)?value:'system';}
  if(!privateUi(sender))throw new Error('此操作只允许从扩展界面发起。');
  if(type==='CR_CLOUD_STATE')return cloud.state();
  if(type==='CR_CLOUD_CONNECT')return cloud.connect();
  if(type==='CR_CLOUD_SYNC')return cloud.sync({manual:true});
  if(type==='CR_CLOUD_DISCONNECT')return cloud.disconnect();
  if(type==='CR_OPEN_GOOGLE_SETUP'){await chrome.tabs.create({url:chrome.runtime.getURL('google-setup.html')});return true;}
  if(type==='CR_SUBMIT'||type==='CR_EXPLAIN')return tasks.submit(payload);
  if(type==='CR_REGENERATE'){
    if(payload.request)return tasks.regenerate(payload);
    const data=await repository.get(payload.entryId);const context=data?.contexts.find(c=>c.id===payload.contextId)||data?.contexts[0];if(!context)throw new Error('还没有可用原文，请回到文章划选后重新生成。');
    return tasks.regenerate({contextId:context.id,request:{kind:'term',...context,entryId:data.entry.id}});
  }
  if(type==='CR_TASK_LOOKUP')return tasks.lookup(payload);
  if(type==='CR_TASK_GET')return tasks.get(payload.id);
  if(type==='CR_TASK_LIST')return tasks.list();
  if(type==='CR_TASK_RETRY')return tasks.retry(payload.id);
  if(type==='CR_TASK_CANCEL')return tasks.cancel(payload.id);
  if(type==='CR_COMMIT')return tasks.confirm(payload.id,!!payload.original);
  if(type==='CR_GET_SETTINGS'){const cfg=await settings();return {...cfg,hasApiKey:!!await apiKey()};}
  if(type==='CR_SAVE_SETTINGS'){
    const previous=await settings();const cfg={...previous,mode:payload.mode==='api'?'api':'oauth',model:String(payload.model??previous.model??'').trim().slice(0,100),oauthModel:String(payload.oauthModel??previous.oauthModel??'').trim().slice(0,100),protocol:payload.protocol==='chat'?'chat':'responses',baseUrl:validateEndpoint(payload.baseUrl||DEFAULTS.baseUrl),rememberKey:!!payload.rememberKey};
    if(cfg.mode==='api'&&!cfg.model)throw new Error('请填写 Model Name。');
    if(payload.apiKey&&payload.apiKey.length>2000)throw new Error('API Key 格式不正确。');
    if(payload.apiKey){const fingerprint=await digest('context-reader-key-reference:'+payload.apiKey.trim()),refs=(await chrome.storage.local.get('apiKeyReferences')).apiKeyReferences||{};cfg.apiKeyId=refs[fingerprint]||crypto.randomUUID();refs[fingerprint]=cfg.apiKeyId;await chrome.storage.local.set({apiKeyReferences:refs});}
    if(previous.mode==='oauth'&&cfg.mode!=='oauth')stopOAuthRequests();await chrome.storage.local.set({settings:cfg});
    if(payload.apiKey){if(payload.apiKey.length>2000)throw new Error('API Key 格式不正确。');if(cfg.rememberKey){await chrome.storage.local.set({apiKey:payload.apiKey.trim()});await chrome.storage.session.remove('apiKey');}else{await chrome.storage.session.set({apiKey:payload.apiKey.trim()});await chrome.storage.local.remove('apiKey');}}
    else if(!cfg.rememberKey&&previous.rememberKey){const value=await apiKey();await chrome.storage.local.remove('apiKey');if(value)await chrome.storage.session.set({apiKey:value});}await tasks.connectionChanged();return {saved:true};
  }
  if(type==='CR_FORGET_KEY'){await chrome.storage.local.remove('apiKey');await chrome.storage.session.remove('apiKey');const cfg=await settings();cfg.apiKeyId=crypto.randomUUID();await chrome.storage.local.set({settings:cfg});await tasks.connectionChanged();return true;}
  if(type==='CR_OAUTH_STATE'){return {...await oauth.state(),pendingAttemptId:(await chrome.storage.session.get('oauthAttemptId')).oauthAttemptId||''};}
  if(type==='CR_OAUTH_START'){
    await tasks.connectionChanged({oauthOnly:true,force:true});stopOAuthRequests();const result=await oauth.begin({profileId:payload.profileId||'',reconsent:!!payload.reconsent});
    await chrome.storage.session.set({oauthAttemptId:result.attemptId});return {attemptId:result.attemptId};
  }
  if(type==='CR_OAUTH_POLL'){
    const cfg=await settings(),id=String(payload.attemptId||(await chrome.storage.session.get('oauthAttemptId')).oauthAttemptId||'');const result=await oauth.poll(id);
    if(result.status==='complete'){
      const next={...cfg,oauthProfileId:result.session.profileId};let models=[],catalogError='';
      if(result.session.sharing)try{models=await oauthModels(next);}catch(error){catalogError=errorText(error);}
      const saved=await saveOAuthSelection(result.session,models,true);await chrome.storage.session.remove('oauthAttemptId');return {...result,models,settings:saved,catalogError};
    }
    if(result.status!=='pending')await chrome.storage.session.remove('oauthAttemptId');return result;
  }
  if(type==='CR_OAUTH_CANCEL'){const id=String(payload.attemptId||'');const result=await oauth.cancel(id);await chrome.storage.session.remove('oauthAttemptId');return result;}
  if(type==='CR_OAUTH_SELECT'){
    await tasks.connectionChanged({oauthOnly:true,force:true});stopOAuthRequests();const cfg=await settings(),result=await oauth.select(payload.profileId);const next={...cfg,oauthProfileId:result.session.profileId};let models=[],catalogError='';if(result.session.sharing)try{models=await oauthModels(next);}catch(error){catalogError=errorText(error);}const saved=await saveOAuthSelection(result.session,models);return {...result,models,settings:saved,catalogError};
  }
  if(type==='CR_OAUTH_LOGOUT'){
    await tasks.connectionChanged({oauthOnly:true,force:true});stopOAuthRequests();const cfg=await settings();try{return await oauth.disconnect(cfg.oauthProfileId);}finally{cfg.oauthModel='';await chrome.storage.local.set({settings:cfg});}
  }
  if(type==='CR_OAUTH_MODELS'){const cfg=await settings();return oauthModels(cfg);}
  if(type==='CR_CHECK_CONNECTION'){
    const cfg=await settings();if(cfg.mode==='oauth'){const state=await oauth.state();if(!state.session.sharing)throw new Error('请先通过 Continue with ChatGPT 登录并授权使用订阅额度。');const models=await oauthModels(cfg);return {ready:true,provider:'openai-sdk-oauth',...state,models};}
    const {default:OpenAI}=await import('openai');const client=new OpenAI({apiKey:await apiKey(),baseURL:cfg.baseUrl,dangerouslyAllowBrowser:true,maxRetries:0,timeout:15000});await client.models.list();return {ready:true,provider:'openai-sdk'};
  }
  if(type==='CR_SNAPSHOT')return repository.snapshot();
  if(type==='CR_EXPORT')return {format:'context-reader',exportedAt:new Date().toISOString(),...await repository.snapshot()};
  if(type==='CR_IMPORT'){const r=await repository.import(payload);await publish();return r;}
  if(type==='CR_PAUSE'){const r=await repository.pause(payload.id,payload.paused);await publish();return r;}
  if(type==='CR_EDIT'){const r=await repository.edit(payload.id,payload);await publish();return r;}
  if(type==='CR_DELETE_ENTRY'){const r=await repository.deleteEntry(payload.id);await tasks.reconcile();await publish();return r;}
  if(type==='CR_DELETE_CONTEXT'){const r=await repository.deleteContext(payload.id);await publish();return r;}
  if(type==='CR_ENRICH')return tasks.enrich(payload.id);
  if(type==='CR_SAVE_CANDIDATE'){const snapshot=await repository.snapshot(),snippet=snapshot.snippets.find(s=>s.id===payload.snippetId);const candidate=snippet?.candidates[payload.index];if(!candidate)throw new Error('候选表达已不存在。');const request={kind:'term',selected:candidate.surface,sentence:snippet.sentence,context:snippet.context,...(surroundings(snippet.context,candidate.surface)||{before:'[位置未确认]',after:''}),source:snippet.source,entryId:''};const hash=await requestHash(request);const result={expression:candidate,meaning:candidate.meaning,explanation:candidate.note,uncertainty:snippet.uncertainty};return commitCandidate(result,request,hash,snippet.provider);}
  if(type==='CR_ENABLE')return reading.setEnabled(payload.tabId,true);
  if(type==='CR_SITE_STATE')return reading.tabState(payload.tabId);
  if(type==='CR_SET_SITE_ENABLED')return reading.setEnabled(payload.tabId,!!payload.enabled);
  if(type==='CR_OPEN_LIBRARY'){await chrome.tabs.create({url:chrome.runtime.getURL('library.html')+(payload.view==='tasks'?'?view=tasks'+(payload.taskId?'&task='+encodeURIComponent(payload.taskId):''):(payload.id?'?entry='+encodeURIComponent(payload.id):''))});return true;}
  if(type==='CR_OPEN_SETTINGS'){await chrome.tabs.create({url:chrome.runtime.getURL('options.html')});return true;}
  throw new Error('不支持的操作。');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(!message?.type?.startsWith('CR_')||['CR_LIBRARY_CHANGED','CR_TASKS_CHANGED','CR_CLOUD_CHANGED'].includes(message.type))return;dispatch(message.type,message.payload||{},sender).then(data=>respond({ok:true,data})).catch(error=>respond({ok:false,error:errorText(error)}));return true;});
chrome.runtime.onConnect.addListener(port=>{if(port.name!=='cr-rpc'||!privateUi(port.sender))return;port.onMessage.addListener(message=>{if(message.type==='ping')return;const send=event=>{try{port.postMessage({...event,id:message.id});}catch{}};dispatch(message.type,message.payload||{},port.sender,message=>send({progress:message})).then(data=>send({ok:true,data})).catch(error=>send({ok:false,error:errorText(error)}));});});
chrome.contextMenus?.removeAll(()=>{chrome.contextMenus.create({id:'cr-explain',title:'用语境解释所选内容',contexts:['selection']});});
chrome.contextMenus?.onClicked.addListener(async(info,tab)=>{if(info.menuItemId==='cr-explain'&&tab?.id){try{const policy=await reading.ensure(tab.id);if(policy.enabled)await chrome.tabs.sendMessage(tab.id,{type:'CR_EXPLAIN_SELECTION',text:info.selectionText});}catch{await chrome.runtime.openOptionsPage();}}});
chrome.commands.onCommand.addListener(async command=>{if(command==='explain-selection'){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab?.id){try{const policy=await reading.ensure(tab.id);if(policy.enabled)await chrome.tabs.sendMessage(tab.id,{type:'CR_EXPLAIN_SELECTION'});}catch{}}}});
const initializeReading=()=>{void initialize.then(()=>reading.initialize()).catch(()=>{});};
chrome.runtime.onInstalled.addListener(initializeReading);
chrome.runtime.onStartup.addListener(initializeReading);

chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||!changes.appearance)return;const appearance=['light','dark'].includes(changes.appearance.newValue)?changes.appearance.newValue:'system';void chrome.tabs.query({}).then(tabs=>Promise.allSettled(tabs.filter(tab=>/^https?:/.test(tab.url||'')).map(tab=>chrome.tabs.sendMessage(tab.id,{type:'CR_APPEARANCE_CHANGED',appearance}))));});
