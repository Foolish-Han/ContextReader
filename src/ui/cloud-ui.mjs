import {rpc} from './client.mjs';
import {escapeHtml as e} from '../shared/core.mjs';
import {icon} from './icons.mjs';
const labels={'not-configured':'应用配置缺失',disconnected:'尚未连接',syncing:'正在同步',synced:'已同步至 Google Drive',pending:'正在等待自动同步',error:'同步未完成','needs-auth':'需要重新授权','account-mismatch':'Google 账号不一致'};
export function mountCloudStatus(root,{compact=false}={}){
 let busy=false,revision=0,lastHtml='';
 async function refresh(){const version=++revision;try{
  const state=await rpc('CR_CLOUD_STATE');if(version!==revision)return;
  const label=state.pending&&state.status==='synced'?labels.pending:labels[state.status]||'等待同步';
  const connected=state.enabled&&!['needs-auth','account-mismatch'].includes(state.status),healthy=state.status==='synced'&&!state.pending;
  const timestamp=state.lastSyncAt?new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(state.lastSyncAt)):'';
  const dot=`<span class="status-dot ${healthy?'is-connected':state.enabled?'is-pending':''}" aria-hidden="true"></span>`;
  let html;
  if(compact){
   html=`<span class="cloud-rail-status" role="status">${dot}<span>${state.enabled&&healthy?'自动同步已开启':e(label)}</span></span>${!connected?'<button type="button" class="text-button" data-cloud-connect '+(busy?'disabled':'')+'>连接 Google Drive</button>':''}<a href="options.html#cloud">同步设置</a><span class="cloud-action-error" role="alert"></span>`;
  }else{
   html=`<div class="cloud-heading"><h2>云端同步</h2><span class="cloud-state" role="status">${dot}${e(label)}</span></div>
${state.enabled?`<div class="cloud-account-row"><span class="account-symbol">${icon(healthy?'cloud-check':'cloud')}</span><div><p class="cloud-account">${e(state.account?.email||state.account?.name||'Google Drive')}</p><p class="micro-copy">${timestamp?'上次同步 '+e(timestamp):'等待首次同步'}</p></div></div><p class="cloud-auto-label">${icon(connected?'check':'cloud-off')}${connected?'自动同步已开启':'自动同步已暂停'}</p>`:'<p class="cloud-description">连接 Google Drive，在其他设备继续使用知识库。离线时仍可查阅和收录。</p>'}
${!state.configured?'<p class="cloud-error" role="alert">此安装包缺少应用配置，请更新扩展。无需自行创建 Google 开发者项目。</p>':''}
${state.error?`<p class="cloud-error" role="alert">${e(state.error)}</p>`:''}
<div class="action-row">${!connected?'<button type="button" class="button primary" data-cloud-connect '+(busy?'disabled':'')+'>连接 Google Drive</button>':'<button type="button" class="text-button" data-cloud-sync '+(busy||state.status==='syncing'?'disabled':'')+'>'+icon('refresh')+'立即同步</button>'}${state.enabled?'<button type="button" class="text-button" data-cloud-disconnect '+(busy?'disabled':'')+'>断开连接</button>':''}</div>
<p class="cloud-action-error error" role="alert"></p>
<details class="connection-guide" data-cloud-details="sync"><summary>同步内容与频率</summary><p>新增、修订和删除后自动同步；运行期间每分钟检查云端，Chrome 启动时恢复检查。断网后保留本机改动，连接恢复后自动重试。</p><p>同步包括表达、英美音标、学习资料和语境历史。API Key、ChatGPT 凭据、网站偏好和生成队列仅留在本机。</p></details>
<details class="connection-guide cloud-diagnostics" data-cloud-details="diagnostics"><summary>连接诊断</summary><p>版本：${e(chrome.runtime.getManifest().version)}<br>扩展 ID：<code>${e(chrome.runtime.id)}</code><br>应用 Client ID：<code>${e(state.clientId||'未配置')}</code></p><p>更新后请重新加载扩展，并刷新本页。</p></details>`;
  }
  if(html===lastHtml)return;lastHtml=html;
  const open=[...root.querySelectorAll('details[open]')].map(el=>el.dataset.cloudDetails);
  root.innerHTML=html;root.querySelectorAll('details').forEach(el=>{el.open=open.includes(el.dataset.cloudDetails);});
  root.querySelector('[data-cloud-connect]')?.addEventListener('click',event=>action('CR_CLOUD_CONNECT',event.currentTarget));
  root.querySelector('[data-cloud-sync]')?.addEventListener('click',event=>action('CR_CLOUD_SYNC',event.currentTarget));
  root.querySelector('[data-cloud-disconnect]')?.addEventListener('click',event=>action('CR_CLOUD_DISCONNECT',event.currentTarget));
 }catch(error){if(version===revision){lastHtml='';root.innerHTML=`<p class="micro-copy" role="alert">同步状态暂不可用：${e(error.message)}</p>`;}}}
 async function action(type,button){if(busy)return;busy=true;button.disabled=true;const previous=root.querySelector('.cloud-action-error');if(previous)previous.textContent='';try{await rpc(type);}catch(error){const node=root.querySelector('.cloud-action-error');if(node)node.textContent=error.message;}finally{busy=false;lastHtml='';const node=root.querySelector('.cloud-action-error'),error=node?.textContent;await refresh();if(error){const next=root.querySelector('.cloud-action-error');if(next)next.textContent=error;}}}
 chrome.runtime.onMessage.addListener(message=>{if(message.type==='CR_CLOUD_CHANGED')void refresh();});void refresh();return refresh;
}
