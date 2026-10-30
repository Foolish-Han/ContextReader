import {errorText} from '../shared/core.mjs';
export function createCloudSync({repository,storage,drive,clientId='',notify=async()=>{},setWake=async()=>{},retainWorker=()=>()=>{},debounceMs=1800}){
 let running,connecting,timer,controller,epoch=0;const read=async()=>({enabled:false,status:'disconnected',files:{},...(await storage.get('cloudSync')).cloudSync});
 const write=async cfg=>{await storage.set({cloudSync:cfg});try{await notify();}catch{}};
 async function state(){const cfg=await read(),local=await repository.cloudStatus();return {configured:drive.configured,enabled:!!cfg.enabled,status:drive.configured?cfg.status:'not-configured',account:cfg.account||null,lastSyncAt:cfg.lastSyncAt||'',error:cfg.error||'',pending:local.version>local.acknowledged,clientId:clientId||''};}
 async function initialize(){const cfg=await read();await setWake(!!cfg.enabled&&drive.configured);if(cfg.enabled&&drive.configured)void sync().catch(()=>{});}
 async function connect(){if(connecting)return connecting;connecting=(async()=>{if(!drive.configured)throw new Error('此安装包缺少应用的 Google OAuth Client ID，请更新扩展或联系发布者。普通用户只需登录授权，不需要配置开发者项目。');const before=await read(),version=epoch;
  await drive.authorize(true);const account=await drive.account();if(version!==epoch)return state();if(before.account?.id&&before.account.id!==account.id)throw new Error('当前知识库绑定另一个 Google 账号。请在对应 Chrome 个人资料中连接原账号，未向新账号上传。');
  await write({...before,enabled:true,account,clientId,status:'pending',error:'',nextAttemptAt:0});await setWake(true);return sync({manual:true});})();try{return await connecting;}finally{connecting=null;}}
 async function sync({manual=false}={}){if(running)return running;const version=epoch;controller=new AbortController();const signal=controller.signal;
  running=(async()=>{let cfg=await read();if(!cfg.enabled||!drive.configured)return state();if(!manual&&(cfg.nextAttemptAt>Date.now()||cfg.status==='needs-auth'||cfg.status==='account-mismatch'))return state();const release=retainWorker();
   try{if(cfg.clientId&&cfg.clientId!==clientId)throw Object.assign(new Error('Google 应用配置已变化，请重新连接；跨设备须使用同一个 Client ID。'),{code:'auth'});
    await write({...cfg,status:'syncing',error:''});await drive.authorize(false);const account=await drive.account(signal);if(account.id!==cfg.account?.id)throw Object.assign(new Error('Google 账号已变化，未上传或合并资料。请连接原账号。'),{code:'account-mismatch'});
    const files=await drive.files(signal),incoming=[],cache={...(cfg.files||{})};for(const file of files){if(cache[file.id]===file.modifiedTime&&file.modifiedTime)continue;try{incoming.push(await drive.read(file,signal));cache[file.id]=file.modifiedTime||'';}catch(error){if(error.code==='not-found'){delete cache[file.id];continue;}throw error;}}
    if(version!==epoch||signal.aborted)return state();if(incoming.length&&await repository.mergeCloud(incoming))await notify();const payload=await repository.cloudPayload(),own=files.find(file=>file.appProperties?.device===payload.device);let uploaded=own;
    if(!own||payload.version>payload.acknowledged)uploaded=await drive.write(payload.envelope,own?.id||'',signal);
    if(version!==epoch||signal.aborted)return state();if(uploaded?.id)cache[uploaded.id]=uploaded.modifiedTime||'';
    await repository.acknowledgeCloud(payload.version);const local=await repository.cloudStatus();cfg=await read();if(version!==epoch||signal.aborted||!cfg.enabled)return state();await write({...cfg,files:cache,status:local.version>local.acknowledged?'pending':'synced',lastSyncAt:new Date().toISOString(),error:'',nextAttemptAt:0});if(local.version>local.acknowledged)void schedule();return state();
   }catch(error){if(version!==epoch||signal.aborted)return state();cfg=await read();await write({...cfg,status:error.code==='auth'?'needs-auth':error.code==='account-mismatch'?'account-mismatch':'error',error:errorText(error),nextAttemptAt:Date.now()+(error.code==='rate-limit'?300000:60000)});return state();}
   finally{release();}
  })();try{return await running;}finally{running=null;controller=null;}
 }
 async function schedule(){const cfg=await read();if(!cfg.enabled||!drive.configured)return;await setWake(true);if(cfg.status==='synced')await write({...cfg,status:'pending'});clearTimeout(timer);timer=setTimeout(()=>void sync().catch(()=>{}),debounceMs);}
 async function disconnect(){epoch++;clearTimeout(timer);controller?.abort();const cfg=await read();await write({...cfg,enabled:false,status:'disconnected',error:''});await setWake(false);await drive.disconnect();return state();}
 return {state,initialize,connect,sync,schedule,disconnect};
}
