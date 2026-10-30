import {rpc,$,brand,flash} from './client.mjs';
import {escapeHtml as e,validateEndpoint,DEFAULTS} from '../shared/core.mjs';
import {mountCloudStatus} from './cloud-ui.mjs';
import {icon} from './icons.mjs';
import {themeButton,appearanceChoices} from './appearance.mjs';
let settings=await rpc('CR_GET_SETTINGS'),connection={session:{status:'disconnected',sharing:false},profiles:[]},models=[],attemptId='',pollTimer,working=false;
$('#app').innerHTML=`<header class="app-header">${brand()}<nav><a href="library.html" class="inline-meta">${icon('back')}<span>知识库</span></a>${themeButton()}</nav></header>
<div class="settings-layout"><aside><h1>设置</h1><nav class="settings-nav" aria-label="设置分节"><a href="#settings-form">${icon('plug')}模型连接</a><a href="#cloud">${icon('cloud')}云端同步</a><a href="#appearance">${icon('palette')}外观</a><a href="#data">${icon('shield')}数据</a></nav></aside>
<div class="settings-main"><form id="settings-form"><h2 class="settings-section-title">模型连接</h2>
<fieldset class="connection-choice"><legend class="sr-only">连接方式</legend>
<label><input type="radio" name="mode" value="oauth" ${settings.mode==='oauth'?'checked':''}><strong>ChatGPT 订阅</strong></label>
<label><input type="radio" name="mode" value="api" ${settings.mode==='api'?'checked':''}><strong>API Key</strong></label></fieldset>
<section id="oauth-fields"><div class="oauth-account" id="auth-card"></div>
<label class="field">模型<select name="oauthModel" id="oauth-model" disabled><option value="">登录后读取可用模型</option></select><small>默认 GPT-6 Luna，优先阅读速度。</small></label>
<div class="plan-usage"><span id="plan-state">尚未启用订阅调用</span><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">管理用量</a></div>
<details class="connection-guide oauth-guide"><summary>认证助手与凭据</summary><p>首次使用运行 <code>start-auth.cmd</code>。认证助手处理本机 OAuth 回调、凭据保护与刷新；扩展后台直接请求 OpenAI。</p><p>长期凭据由 Windows 用户账户加密保存，不进入网页、浏览器存储或知识库备份。</p></details></section>
<section id="api-fields"><label class="field">服务地址<input name="baseUrl" type="url" value="${e(settings.baseUrl)}" spellcheck="false" placeholder="https://api.openai.com/v1"></label>
<label class="field">API Key<input name="apiKey" type="password" autocomplete="off" placeholder="${settings.hasApiKey?'已保存，留空保持不变':'填写 API Key'}"></label>
<label class="check-field"><input type="checkbox" name="rememberKey" ${settings.rememberKey?'checked':''}>保存在此设备<small>关闭后，密钥仅保留到浏览器退出。</small></label>
<label class="field">请求协议<select name="protocol"><option value="responses" ${settings.protocol==='responses'?'selected':''}>OpenAI Responses</option><option value="chat" ${settings.protocol==='chat'?'selected':''}>Chat Completions</option></select></label>
<label class="field">模型名称<input name="model" value="${e(settings.model)}" placeholder="服务提供的 Model Name" spellcheck="false"></label></section>
<div class="settings-actions"><button type="submit" class="button primary">保存连接</button><button type="button" class="button secondary" id="check">保存并检查连接</button></div><p id="status" class="status" aria-live="polite"></p></form>
<section id="cloud" class="cloud-settings" aria-label="Google 云端同步"></section>
<section id="appearance" class="appearance-settings"><h2>外观</h2>${appearanceChoices()}</section>
<section id="data" class="privacy-note"><h2>数据与隐私</h2><details class="connection-guide"><summary>文章、知识库与凭据</summary><p>划选解释与重新生成会发送选区和有限的附近原文。页面标记、悬停和阅读历史不调用模型。</p><p>知识库同步到你自己的 Google Drive，同时保留离线缓存。API Key、ChatGPT 凭据、网站偏好和生成队列不参与同步。</p><p>卸载前可在知识库导出备份。ChatGPT 授权可在上方退出，或到 ChatGPT 设置撤销。</p></details><button type="button" class="text-button danger" id="forget">移除已保存的 API Key</button></section></div></div>`;
function mode(){return new FormData($('#settings-form')).get('mode');}
function syncKeyField(){const input=$('[name=apiKey]');input.value='';input.placeholder=settings.hasApiKey?'已保存，留空保持不变':'填写 API Key';}
function syncMode(){const oauth=mode()==='oauth';$('#oauth-fields').hidden=!oauth;$('#api-fields').hidden=oauth;}
function label(profile){const identity=profile.identity?.email;return identity&&identity!==profile.label?identity+'（'+profile.label+'）':profile.label;}
function renderAuth(){
 const s=connection.session||{},pending=!!attemptId,connected=s.status==='connected',selected=connection.profiles.find(p=>p.id===s.profileId);
 $('#auth-card').innerHTML=pending?`<div class="oauth-title"><span class="status-dot is-pending"></span><h2>正在等待 OpenAI 授权</h2></div><p>请在打开的页面完成登录，并允许语境使用 ChatGPT 订阅。</p><button type="button" class="text-button" id="cancel-auth">取消本次登录</button>`:
 `<div class="oauth-title"><span class="status-dot ${connected&&s.sharing?'is-connected':'is-pending'}"></span><h2>${connected?'ChatGPT 已登录':'连接 ChatGPT'}</h2></div>${connected?`<p class="account-identity">${e(s.identity?.email||s.identity?.name||s.profileLabel||'ChatGPT 账号')}</p><p>${s.sharing?'订阅额度已启用':'尚未授权订阅额度'}</p>`:'<p>使用 ChatGPT 订阅额度进行解释。</p>'}
 ${!connected?`<button type="button" class="button primary chatgpt-signin" id="sign-in"><img src="icons/chatgpt.svg" alt="" width="21" height="21">Continue with ChatGPT</button>`:!s.sharing?'<button type="button" class="button primary" id="enable-plan">启用订阅额度</button>':''}
 ${connection.profiles.length?`<label class="field account-picker">已保存账号<select id="profile-picker">${connection.profiles.map(p=>`<option value="${e(p.id)}" ${p.id===s.profileId?'selected':''}>${e(label(p))}${p.status==='connected'?'':'（需登录）'}</option>`).join('')}</select></label>`:''}
 <div class="oauth-tools">${connected?'<button type="button" class="text-button" id="reconnect">重新登录</button><button type="button" class="text-button" id="logout">退出此账号</button>':''}${connection.profiles.length?'<button type="button" class="text-button" id="add-account">添加账号</button>':''}${connected&&s.sharing?'<button type="button" class="text-button" id="models-refresh">刷新模型</button>':''}</div>`;
 $('#plan-state').textContent=connected&&s.sharing?'使用 ChatGPT 订阅':'尚未启用订阅调用';$('#plan-state').classList.toggle('is-enabled',connected&&s.sharing);
 $('#sign-in')?.addEventListener('click',()=>startLogin(selected?.id));$('#enable-plan')?.addEventListener('click',()=>startLogin(s.profileId,true));$('#reconnect')?.addEventListener('click',()=>startLogin(s.profileId));$('#add-account')?.addEventListener('click',()=>startLogin());
 $('#cancel-auth')?.addEventListener('click',async()=>{clearTimeout(pollTimer);await rpc('CR_OAUTH_CANCEL',{attemptId});attemptId='';await refreshAuth();flash('本次登录已取消。');});
 $('#models-refresh')?.addEventListener('click',()=>refreshModels());
 $('#profile-picker')?.addEventListener('change',async event=>{try{working=true;const result=await rpc('CR_OAUTH_SELECT',{profileId:event.target.value});connection=result;models=result.models;settings=result.settings;renderAuth();renderModels();flash(result.catalogError||'已切换账号。',!!result.catalogError);}catch(error){flash(error.message,true);}finally{working=false;}});
 $('#logout')?.addEventListener('click',async()=>{if(working)return;working=true;try{await rpc('CR_OAUTH_LOGOUT');models=[];await refreshAuth();renderModels();flash('已退出此账号。');}catch(error){await refreshAuth();flash(error.message,true);}finally{working=false;}});
}
function renderModels(){const input=$('#oauth-model'),valid=models.some(m=>m.slug===settings.oauthModel);input.innerHTML=models.length?(!valid?'<option value="">请选择可用模型</option>':'')+models.map(m=>`<option value="${e(m.slug)}">${e(m.displayName)}</option>`).join(''):'<option value="">登录并启用订阅后读取模型</option>';input.disabled=!models.length;input.value=valid?settings.oauthModel:'';}
async function refreshModels(){try{models=await rpc('CR_OAUTH_MODELS');if(!models.some(m=>m.slug===settings.oauthModel)&&models.some(m=>m.slug===DEFAULTS.oauthModel)){settings.oauthModel=DEFAULTS.oauthModel;renderModels();await save(false,true);}else renderModels();if(!models.length)flash('这个账号暂未返回可用模型。',true);else if(!models.some(m=>m.slug===settings.oauthModel))flash('当前账号没有所选模型，请手动选择；不会自动升级到更强模型。',true);}catch(error){flash(error.message,true);}}
async function refreshAuth(){try{connection=await rpc('CR_OAUTH_STATE');if(connection.pendingAttemptId){attemptId=connection.pendingAttemptId;renderAuth();void poll();return;}renderAuth();if(connection.session.sharing&&mode()==='oauth'){
 if(settings.oauthProfileId!==connection.session.profileId){const result=await rpc('CR_OAUTH_SELECT',{profileId:connection.session.profileId});connection=result;settings=result.settings;models=result.models;renderAuth();renderModels();}
 else await refreshModels();
 }}catch(error){connection={session:{status:'disconnected',sharing:false},profiles:[]};renderAuth();flash(error.message,true);}}
async function startLogin(profileId,reconsent=false){if(working)return;working=true;try{flash('正在准备安全登录…');const result=await rpc('CR_OAUTH_START',{profileId,reconsent});attemptId=result.attemptId;renderAuth();flash('请在 OpenAI 页面完成登录与授权。');void poll();}catch(error){flash(error.message,true);}finally{working=false;}}
async function poll(){clearTimeout(pollTimer);if(!attemptId)return;try{const result=await rpc('CR_OAUTH_POLL',{attemptId});if(result.status==='pending'){pollTimer=setTimeout(poll,1500);return;}attemptId='';if(result.status==='complete'){
 settings=result.settings;connection={session:result.session,profiles:(await rpc('CR_OAUTH_STATE')).profiles};models=result.models||[];$('[name=mode][value=oauth]').checked=true;syncMode();renderAuth();renderModels();flash(result.catalogError||(!result.session.sharing?'已登录，仍需允许使用订阅额度。':'独立登录和订阅授权已完成。回到文章即可查询。'),!!result.catalogError);
 }else{await refreshAuth();flash(result.error?.message||'登录未完成，请重试。',true);}}catch(error){attemptId='';renderAuth();flash(error.message,true);}}
async function save(check=false,quiet=false){
 const data=Object.fromEntries(new FormData($('#settings-form')));data.rememberKey=$('[name=rememberKey]').checked;data.oauthModel=$('#oauth-model').value||settings.oauthModel;
 try{
  if(data.mode==='api'){const origin=new URL(validateEndpoint(data.baseUrl)).origin+'/*';if(!(await chrome.permissions.request({origins:[origin]})))throw new Error('未授予模型服务访问权限，连接没有保存。');}
  await rpc('CR_SAVE_SETTINGS',data);settings=await rpc('CR_GET_SETTINGS');syncKeyField();if(!quiet)flash(check?'正在检查连接…':'连接已保存。');
  if(check){const result=await rpc('CR_CHECK_CONNECTION');if(result.provider==='openai-sdk-oauth'){connection=result;models=result.models;renderAuth();renderModels();}flash(result.provider==='openai-sdk-oauth'?'独立 ChatGPT 授权可用，已读取账户模型。':'API 服务可连接，请实际查询验证所选模型。');}
 }catch(error){flash(error.message,true);}
}
document.querySelectorAll('[name=mode]').forEach(input=>input.addEventListener('change',()=>{syncMode();if(mode()==='oauth')void refreshAuth();}));$('#settings-form').addEventListener('submit',event=>{event.preventDefault();void save();});$('#check').addEventListener('click',()=>save(true));$('#oauth-model').addEventListener('change',()=>save(false,true));$('#forget').addEventListener('click',async()=>{await rpc('CR_FORGET_KEY');settings=await rpc('CR_GET_SETTINGS');syncKeyField();flash('已移除 API Key。');});
syncMode();renderAuth();renderModels();if(settings.mode==='oauth')void refreshAuth();
mountCloudStatus($('#cloud'));
