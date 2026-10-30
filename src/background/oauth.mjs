import {validateEndpoint} from '../shared/core.mjs';
export function createOAuthBroker(url='http://127.0.0.1:43821'){
 const base=validateEndpoint(url,{bridge:true});
 return async(path,payload={},options={})=>{
  let response;try{response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Context-Reader':'1'},body:JSON.stringify(payload),signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(path==='/access'?75000:35000)]):AbortSignal.timeout(path==='/access'?75000:35000)});}catch{throw new Error('OAuth 认证助手未启动。请运行 start-auth.cmd，再登录 ChatGPT。');}
  const result=await response.json();if(!response.ok||!result.ok){const error=new Error(result.error?.message||'OAuth 连接未完成。');Object.assign(error,result.error||{});throw error;}return result.data;
 };
}
