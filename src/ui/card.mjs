import {rpc,announce,wireTabs,animateDetail} from './client.mjs';
import {escapeHtml as e} from '../shared/core.mjs';
import {closeIcon,bookIcon,quote,historyHtml,learningHtml,termHeading,baseMeaning} from './components.mjs';
import {taskLabel,taskActions,liveStates} from './tasks.mjs';
import {icon} from './icons.mjs';
import './appearance.mjs';
const root=document.querySelector('#card-root'),nonce=location.hash.slice(1);
let init,state={expanded:false,tab:'usage',loading:false,checking:true,error:'',data:null,task:null},busy=false,lastHeight=0,lastExpanded=false,readRevision=0;
const parentMessage=(type,payload={})=>parent.postMessage({type,nonce,...payload},'*');
new ResizeObserver(()=>{
  const height=Math.ceil(document.body.getBoundingClientRect().height);
  if(Math.abs(height-lastHeight)<1&&lastExpanded===state.expanded)return;
  lastHeight=height;lastExpanded=state.expanded;parentMessage('cr-size',{height,expanded:state.expanded});
}).observe(document.body);
document.addEventListener('keydown',event=>{if(event.key==='Escape')parentMessage('cr-close');});
window.addEventListener('message',async event=>{
  if(event.source!==parent||!event.isTrusted||event.data?.nonce!==nonce)return;
  if(event.data.type==='cr-viewport'&&init){document.documentElement.style.setProperty('--card-max',Math.max(100,event.data.maxHeight||700)+'px');return;}
  if(event.data.type!=='cr-init'||init)return;
  init=event.data.payload;document.documentElement.style.setProperty('--card-max',Math.max(100,init.maxHeight||700)+'px');render();
  if(init.mode!=='notice')await refreshTask();else state.checking=false;
});
parentMessage('cr-ready');
function header(label='阅读注释'){return `<header class="card-header"><span class="card-brand"><span class="card-logo">${bookIcon}</span><span>语境<span class="card-label">${e(label)}</span></span></span><button type="button" class="icon-button" id="close" aria-label="关闭">${closeIcon}</button></header>`;}
function bind(){
  root.querySelector('#close')?.addEventListener('click',()=>parentMessage('cr-close'));
  root.querySelector('#run')?.addEventListener('click',()=>run());
  root.querySelector('#sentence')?.addEventListener('click',()=>run('passage'));
  root.querySelector('#expand')?.addEventListener('click',()=>{state.expanded=true;parentMessage('cr-pin');render();});
  root.querySelector('#collapse')?.addEventListener('click',()=>{state.expanded=false;render();});
  root.querySelector('#settings')?.addEventListener('click',()=>rpc('CR_OPEN_SETTINGS'));
  root.querySelector('#library')?.addEventListener('click',()=>rpc('CR_OPEN_LIBRARY',{id:state.data?.entry?.id}));
  root.querySelector('#regenerate')?.addEventListener('click',()=>regenerate());
  root.querySelector('#retry')?.addEventListener('click',()=>run());
  root.querySelector('#tasks')?.addEventListener('click',()=>rpc('CR_OPEN_LIBRARY',{view:'tasks',taskId:state.task?.id}));
  root.querySelectorAll('[data-task-retry]').forEach(b=>b.addEventListener('click',()=>taskAction('CR_TASK_RETRY',b.dataset.taskRetry,b)));
  root.querySelectorAll('[data-task-cancel]').forEach(b=>b.addEventListener('click',()=>taskAction('CR_TASK_CANCEL',b.dataset.taskCancel,b)));
  root.querySelector('[data-task-settings]')?.addEventListener('click',()=>rpc('CR_OPEN_SETTINGS'));
  wireTabs(root,tab=>{state.tab=tab;render();animateDetail(root);});
  root.querySelector('[data-enrich]')?.addEventListener('click',async()=>{await rpc('CR_ENRICH',{id:state.data.entry.id});state.data.entry.learning={...state.data.entry.learning,status:'pending'};render({preserveScroll:true});});
  root.querySelector('#pause')?.addEventListener('click',async()=>{state.data.entry=await rpc('CR_PAUSE',{id:state.data.entry.id,paused:!state.data.entry.paused});render({preserveScroll:true});});
  root.querySelectorAll('[data-commit]').forEach(b=>b.addEventListener('click',()=>commit(b.dataset.commit==='original')));
  root.querySelectorAll('[data-candidate]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;b.textContent='正在收录';try{await rpc('CR_SAVE_CANDIDATE',{snippetId:state.data.snippet.id,index:Number(b.dataset.candidate)});b.textContent='已收录';announce('已收录这一个表达。');}catch(error){b.disabled=false;b.textContent='重试';state.error=error.message;}}));
}
function render({preserveScroll=false}={}){
  if(!init)return;const focus=document.activeElement?.id,scroll=preserveScroll?root.querySelector('.card-content')?.scrollTop||0:0,data=state.data,task=state.task;let html='';
  if(init.mode==='notice')html=header()+`<div class="card-content"><p>${e(init.message)}</p></div>`;
  else if(state.loading||state.checking){
    const entry=data?.entry||init.entry;
    html=header()+`<div class="card-content">${entry?termHeading(entry):`<div class="selection-preview" lang="en">${e(init.request.selected)}</div>`}<p class="loading-text">${state.checking?'读取本地状态…':'正在提交…'}</p></div>`;
  }else if(state.error){
    html=header()+`<div class="card-content"><h1 class="compact-title">解释没有完成</h1><p class="error" role="alert">${e(state.error)}</p><div class="action-row"><button type="button" class="button primary" id="retry">重试</button><button type="button" class="text-button" id="settings">连接设置</button></div>${data?.entry?'<p class="micro-copy">已有资料保持不变。</p>':''}</div>`;
  }else if(task&&task.state!=='done'&&task.state!=='confirm'){
    const entry=data?.entry||init.entry,live=liveStates.has(task.state);
    html=header('生成任务')+`<div class="card-content task-receipt" data-task-id="${e(task.id)}">${entry?termHeading(entry):`<div class="selection-preview" lang="en">${e(task.selected)}</div>`}<p class="task-state ${live?'':'needs-attention'}" role="status"><span class="status-dot ${live?'is-pending':''}"></span>${e(taskLabel(task))}</p>${task.error?`<p class="explanation">${e(task.error)}</p>`:`<p class="explanation">${task.state==='queued'&&task.ahead?`前面还有 ${task.ahead} 项。`:''}${live?'可以继续读，完成后自动收录。':'已有的解释会保留。'}</p>`}${entry?baseMeaning(entry):''}<div class="action-row"><button type="button" class="text-button" id="tasks">查看任务</button>${taskActions(task)}</div>${live?'<p class="micro-copy">关闭浮层或文章，任务仍会继续。</p>':''}</div>`;
  }else if(data?.kind==='boundary'){
    html=header('确认表达')+`<div class="card-content"><div class="selection-caption">所选 ${e(data.request.selected)}</div><h1 class="term-title" lang="en">${e(data.result.expression.surface)}</h1><p class="context-meaning">${e(data.result.meaning)}</p><p class="explanation">建议连同完整表达理解。</p><div class="action-row"><button type="button" class="button primary" data-commit="full">收录完整表达</button><button type="button" class="text-button" data-commit="original">保留原选区</button></div></div>`;
  }else if(data?.kind==='passage'){
    state.expanded=true;const s=data.snippet;
    html=header('句段速解')+`<div class="card-content"><h1 class="compact-title">这段在说什么</h1><p class="passage-meaning">${e(s.meaning)}</p>${s.explanation?`<p class="explanation">${e(s.explanation)}</p>`:''}${s.uncertainty?`<p class="uncertainty">${e(s.uncertainty)}</p>`:''}<details class="original-toggle" open><summary>对照原文</summary>${quote(s.text)}</details><section class="candidates"><h2>值得留下的表达</h2>${s.candidates.map((c,i)=>`<div class="candidate-row"><div><h3 lang="en">${e(c.canonical)}</h3><p>${e(c.meaning)}</p></div><button type="button" class="small-button" data-candidate="${i}">收录</button></div>`).join('')}</section><div class="entry-tools"><button type="button" class="text-button" id="regenerate">重新生成</button></div><p class="micro-copy card-footnote"><span class="status-dot"></span>句段已保存，只收录你选择的表达。</p></div>`;
  }else if(data?.entry||init.mode==='known'){
    const entry=data?.entry||init.entry,current=data?.current;
    const currentHtml=current?`<section class="current-context"><h2><span class="context-symbol" aria-hidden="true"></span>此处含义</h2><p class="context-meaning">${e(current.meaning)}</p></section>`:`<p class="context-status">这处用法尚未解释${entry.contextCount?`，已积累 ${entry.contextCount} 条历史语境`:'。'}</p>`;
    const expandedHtml=`<div class="detail-navigation"><div class="entry-tabs" role="tablist" aria-label="表达详情"><button type="button" role="tab" data-tab="usage" aria-selected="${state.tab==='usage'}">用法</button><button type="button" role="tab" data-tab="history" aria-selected="${state.tab==='history'}">历史 <span class="tab-count">${data?.contexts?.length||0}</span></button></div><button type="button" class="text-button" id="collapse">收起</button></div><section class="entry-detail" id="entry-panel" role="tabpanel" aria-labelledby="entry-tab-${state.tab}">${state.tab==='history'?historyHtml(data?.contexts||[]):learningHtml(entry)}</section>${current&&state.tab==='usage'?`<details class="original-toggle" open><summary>本处原句</summary>${quote(current.sentence,current.surface)}</details>`:''}<div class="entry-tools"><button type="button" class="text-button" id="regenerate">重新生成</button><button type="button" class="text-button" id="pause">${entry.paused?'恢复标记':'暂停标记'}</button><button type="button" class="text-button" id="library">在知识库修订</button></div>`;
    const actions=`<div class="action-row reading-actions">${!current?'<button type="button" class="button primary" id="run">解释此处</button>':''}<button type="button" class="button secondary" id="expand">用法与历史<span class="expand-glyph" aria-hidden="true">${icon('expand')}</span></button><button type="button" class="text-button regenerate-link" id="regenerate">${icon('refresh')}重新生成</button></div>`;
    const footer=entry.learning?.status==='pending'?'短解释已保存，学习资料正在补齐。':current?'已保存本处语境。':'已收录';
    html=header()+`<div class="card-content">${termHeading(entry)}${baseMeaning(entry)}${currentHtml}${state.expanded?expandedHtml:actions}<p class="micro-copy card-footnote"><span class="status-dot ${entry.learning?.status==='pending'?'is-pending':''}" aria-hidden="true"></span>${footer}</p></div>`;
  }else{
    const r=init.request;html=header('所选内容')+`<div class="card-content selection-content"><div class="selection-preview" lang="en">${e(r.selected)}</div><div class="action-row"><button type="button" class="button primary" id="run">${r.kind==='passage'?'速解所选':'解释并收录'}</button>${r.kind==='term'?'<button type="button" class="text-button" id="sentence">理解整句</button>':''}</div></div>`;
  }
  root.className='reading-card'+(state.expanded?' is-expanded':'');root.innerHTML=html;bind();if(preserveScroll){root.querySelector('.card-content')?.scrollTo(0,scroll);if(focus)root.querySelector('#'+CSS.escape(focus))?.focus({preventScroll:true});}
}
async function run(kind){
  if(busy)return;busy=true;state.error='';state.loading=true;parentMessage('cr-pin');render();let request={...init.request};
  if(kind==='passage')request={...request,kind:'passage',selected:request.sentence};
  try{state.request=request;const receipt=await rpc('CR_SUBMIT',request);state.task=receipt.task||null;state.data=receipt.data||state.task?.data||state.data;state.loading=false;readRevision++;if(state.data?.kind==='passage')state.expanded=true;render();if(state.task&&liveStates.has(state.task.state))parentMessage('cr-background');announce(receipt.data?'已读取本地解释。':'任务已提交，可以继续读。');void refreshTask();}catch(error){state.loading=false;state.error='未提交成功。'+error.message;render();}finally{busy=false;}
}
async function regenerate(){if(busy)return;busy=true;state.error='';state.loading=true;render();try{const request={...(state.request||init.request),entryId:state.data?.entry?.id||init.request.entryId||''};const receipt=await rpc('CR_REGENERATE',{request,contextId:state.data?.current?.id||state.data?.snippet?.id||''});state.task=receipt.task;state.loading=false;state.expanded=false;render();parentMessage('cr-background');void refreshTask();}catch(error){state.loading=false;state.error=error.message;render();}finally{busy=false;}}
async function commit(original){if(busy)return;busy=true;try{state.task=await rpc('CR_COMMIT',{id:state.data.pendingId,original});state.data=state.task.data||null;render();}catch(error){state.error=error.message;render();}finally{busy=false;}}
async function taskAction(type,id,button){if(busy)return;busy=true;button.disabled=true;try{await rpc(type,{id});await refreshTask();if(liveStates.has(state.task?.state))parentMessage('cr-background');}catch(error){state.error=error.message;render();}finally{busy=false;}}
async function refreshTask(){if(!init||init.mode==='notice'||state.loading)return;const revision=++readRevision;try{
 const receipt=state.task?{task:await rpc('CR_TASK_GET',{id:state.task.id})}:await rpc('CR_TASK_LOOKUP',state.request||init.request);
 let data=receipt?.data||receipt?.task?.data;if(!data&&init.mode==='known')data=await rpc('CR_GET_ENTRY',{id:init.entry.id,request:state.request||init.request});
 if(revision!==readRevision||state.loading)return;state.task=receipt?.task||null;if(data)state.data=data;state.checking=false;render({preserveScroll:true});if(liveStates.has(state.task?.state))parentMessage('cr-background');
 }catch(error){if(revision===readRevision){state.checking=false;state.error=error.message;render();}}}
chrome.runtime.onMessage.addListener(message=>{if(['CR_LIBRARY_CHANGED','CR_TASKS_CHANGED'].includes(message.type))void refreshTask();});
