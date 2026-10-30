// All ordinary web pages are enabled. Store only the user's site exceptions,
// separately from model settings so saving a connection cannot overwrite them.
export const READING_EXCEPTIONS='readingDisabledOrigins';
export function webOrigin(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?u.origin:'';}catch{return '';}}
export function createReadingController(api){
 let writes=Promise.resolve();
 const disabled=async()=>{const saved=(await api.storage.local.get(READING_EXCEPTIONS))[READING_EXCEPTIONS];return new Set((Array.isArray(saved)?saved:[]).map(webOrigin).filter(Boolean));};
 async function state(url){const origin=webOrigin(url);return {origin,supported:!!origin,enabled:!!origin&&!(await disabled()).has(origin)};}
 async function ensure(tabId){const tab=await api.tabs.get(tabId),policy=await state(tab.url);if(!policy.supported)throw new Error('此页面不支持语境，请打开普通网页。');
  await api.scripting.executeScript({target:{tabId},files:['content.js']});
  await api.tabs.sendMessage(tabId,{type:'CR_READING_CHANGED',enabled:policy.enabled});return policy;
 }
 async function openTabs(origin=''){return (await api.tabs.query({url:['http://*/*','https://*/*']})).filter(t=>t.id&&webOrigin(t.url)&&(!origin||webOrigin(t.url)===origin));}
 async function sync(origin=''){const tabs=await openTabs(origin);await Promise.allSettled(tabs.map(t=>ensure(t.id)));}
 async function setEnabled(tabId,enabled){const tab=await api.tabs.get(tabId),origin=webOrigin(tab.url);if(!origin)throw new Error('此页面不支持语境，请打开普通网页。');
  const job=writes.then(async()=>{const sites=await disabled();if(enabled)sites.delete(origin);else sites.add(origin);await api.storage.local.set({[READING_EXCEPTIONS]:[...sites].sort()});await sync(origin);return {origin,supported:true,enabled:!!enabled};});writes=job.catch(()=>{});return job;
 }
 async function tabState(tabId){const tab=await api.tabs.get(tabId),policy=await state(tab.url);if(!policy.supported)return {...policy,available:false};
  try{await ensure(tabId);const page=await api.tabs.sendMessage(tabId,{type:'CR_PAGE_STATE'});return {...policy,available:!!page,...page};}catch{return {...policy,available:false};}
 }
 async function initialize(){const legacy=(await api.scripting.getRegisteredContentScripts()).filter(s=>s.id.startsWith('cr-'));if(legacy.length)await api.scripting.unregisterContentScripts({ids:legacy.map(s=>s.id)});await sync();}
 return {state,ensure,sync,setEnabled,tabState,initialize};
}
