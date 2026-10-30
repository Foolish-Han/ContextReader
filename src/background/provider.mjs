import OpenAI from 'openai';
import {validateEndpoint,errorText} from '../shared/core.mjs';
import {QUICK_SCHEMA,promptFor,parseResult} from '../shared/model.mjs';
export async function listOAuthModels(authorize,{signal}={}){
 const credential=await authorize();const response=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+credential.accessToken},signal,redirect:'error'});
 const data=await response.json();if(!response.ok)throw new Error('ChatGPT 模型列表请求失败（HTTP '+response.status+'）。'+(data.error?.message||data.detail||'请检查订阅授权。'));
 if(!Array.isArray(data.models))throw new Error('ChatGPT 模型目录格式不正确。');
 return data.models.filter(m=>m.visibility==='list'&&typeof m.slug==='string').map(m=>({slug:m.slug,displayName:String(m.display_name||m.slug)}));
}
export async function infer(settings,apiKey,task,payload,{signal,onProgress=()=>{},authorize}={}){
 const oauth=settings.mode==='oauth';
 if(oauth&&!authorize)throw new Error('请先独立登录 ChatGPT，并授权使用订阅额度。');
 if(!oauth&&!apiKey)throw new Error('请先在设置中填写 API Key。');
 if(!settings.model?.trim())throw new Error(oauth?'请先选择 ChatGPT 账户可用的模型。':'请先填写 Model Name。');
 // OAuth credentials exist only in this worker request's memory, never browser storage.
 const credential=oauth?await authorize():null;
 const client=new OpenAI({apiKey:oauth?credential.accessToken:apiKey,baseURL:oauth?'https://api.openai.com/v1':validateEndpoint(settings.baseUrl),dangerouslyAllowBrowser:true,maxRetries:0,timeout:110000,...(oauth?{organization:null,project:null,logLevel:'warn',fetchOptions:{redirect:'error'}}:{})});
 const prompt=promptFor(task,payload);let text='',usage=null,completed=false,requestId='';
 try{
  if(!oauth&&settings.protocol==='chat'){
   const stream=await client.chat.completions.create({model:settings.model,messages:[{role:'system',content:prompt.system+(task==='learn'?'':'\n输出必须符合以下 JSON Schema：'+JSON.stringify(QUICK_SCHEMA))},{role:'user',content:prompt.input}],response_format:{type:'json_object'},stream:true},{signal});
   for await(const event of stream){text+=event.choices?.[0]?.delta?.content||'';if(event.usage)usage=event.usage;onProgress(oauth?'正在使用 ChatGPT 订阅生成解释…':'正在生成解释…');}completed=true;
  }else{
   // Learning uses compact JSON mode, with an explicit JSON marker in the user
   // message as required by that mode, and local field validation after completion.
   const outputFormat={text:{format:task==='learn'?{type:'json_object'}:{type:'json_schema',name:'reading',strict:true,schema:QUICK_SCHEMA}}};
   const stream=await client.responses.create({model:settings.model,instructions:prompt.system,input:oauth?[{role:'user',content:prompt.input}]:prompt.input,...outputFormat,stream:true,store:false},{signal,headers:{accept:'text/event-stream'}});
   for await(const event of stream){
    if(event.type==='response.output_text.delta')text+=event.delta;
    signal?.throwIfAborted();
    if(event.type==='response.completed'){completed=true;usage=event.response.usage;requestId=event.response.id||'';break;}
    if(['response.failed','response.incomplete','error'].includes(event.type))throw new Error(event.response?.error?.message||event.message||'模型没有完整生成解释，请重试。');
    onProgress(oauth?'正在使用 ChatGPT 订阅生成解释…':'正在生成解释…');
   }
  }
  signal?.throwIfAborted();if(!completed)throw new Error('模型流未正常完成，结果没有保存。');
  return {data:parseResult(text,task),usage,requestId,provider:oauth?'openai-sdk-oauth':'openai-sdk',model:settings.model};
 }catch(error){
  if(signal?.aborted)throw new Error(signal.reason?.name==='TimeoutError'?'模型请求超时，已有解释已保留，可手动重试。':'这次模型请求已取消，已有解释已保留。');
  if(error.status===401)throw Object.assign(new Error(oauth?'ChatGPT 授权未通过验证，请在设置中重新登录。':'API Key 未通过验证，请检查密钥和服务地址。'),{code:'connection'});
  if(error.status===403)throw Object.assign(new Error(oauth?'ChatGPT 订阅访问被拒绝，请检查应用授权或服务可用地区。':'模型服务拒绝访问，请检查账户权限。'),{code:'connection'});
  if(error.status===429)throw Object.assign(new Error(oauth?'ChatGPT 订阅额度或速率受限。请到“管理用量”查看。':'模型服务额度或速率受限，请稍后重试或检查账户额度。'),{code:'rate-limit'});
  if(error.status===400)throw new Error(oauth?'ChatGPT 模型不接受当前请求格式。请重新选择可用模型。':'模型不支持当前请求格式。请检查 Model Name，或切换 Responses / Chat Completions 协议。');
  throw new Error(errorText(error));
 }
}
