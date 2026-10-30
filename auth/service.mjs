import {createChatGPT} from './siwc-runtime.mjs';
import {randomBytes} from 'node:crypto';
export function publicError(error){return {code:String(error?.code||'connection_error').slice(0,100),message:String(error?.message||'连接没有完成。').replace(/Bearer\s+\S+|sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[已隐藏]').replace(/([?&](?:code|state|id_token_hint|access_token|refresh_token)=)[^&\s]+/g,'$1[已隐藏]').slice(0,600),retryable:!!error?.retryable,...(Number.isInteger(error?.status)?{status:error.status}:{}),...(typeof error?.requestId==='string'?{requestId:error.requestId.slice(0,160)}:{})};}
export function createAuthService({directory,encryption,callbackPort=0,runtimeFactory=createChatGPT}={}){
  const attempts=new Map();let active;
  const runtime=runtimeFactory({appName:'Context Reader',appId:'context-reader',redirectPort:callbackPort,storageDir:directory,credentialEncryption:encryption,sendHostId:true});
  const state=async()=>({session:await runtime.getSession(),profiles:await runtime.listProfiles()});
  return {
    state,
    async begin(input={}){
      if(active?.status==='pending'){const error=new Error('另一个登录正在进行，请先完成或取消。');error.code='connection_busy';throw error;}
      const id=randomBytes(32).toString('base64url');const attempt={id,status:'pending',created:Date.now()};active=attempt;attempts.set(id,attempt);
      for(const [key,item] of attempts)if(Date.now()-item.created>15*60_000&&item!==active)attempts.delete(key);
      const options={...(input.profileId?{profileId:String(input.profileId)}:{newProfile:true}),...(input.reconsent?{reconsent:true}:{})};
      void runtime.signIn(options).then(session=>{attempt.status='complete';attempt.session=session;},error=>{attempt.status=error?.code==='cancelled'?'cancelled':'error';attempt.error=publicError(error);});
      return {attemptId:id};
    },
    async poll(id){const item=attempts.get(id);if(!item)return {status:'expired'};return {status:item.status,...(item.session?{session:item.session}:{}),...(item.error?{error:item.error}:{})};},
    async cancel(id){if(active?.id===id&&active.status==='pending')runtime.cancelSignIn();return {cancelled:true};},
    async select(id){await runtime.selectProfile(id);return state();},
    async disconnect(id){const session=await runtime.getSession();if(session.profileId!==id)throw Object.assign(new Error('账号已切换，请重新选择后退出。'),{code:'account_mismatch'});await runtime.disconnect();return state();},
    async access(id){if(!/^[a-zA-Z0-9-]{1,100}$/.test(id||''))throw Object.assign(new Error('请先选择已授权的 ChatGPT 账号。'),{code:'sign_in_required'});return runtime.acquireAccessToken(id,{signal:AbortSignal.timeout(65000)});},
    close(){runtime.cancelSignIn();}
  };
}
