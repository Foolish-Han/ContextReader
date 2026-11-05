import {rpc,$,brand,flash} from './client.mjs';
import {escapeHtml as e} from '../shared/core.mjs';
import {taskSummary} from './tasks.mjs';
import {icon} from './icons.mjs';
import {markTypes,markStyle} from '../shared/marks.mjs';
import {themeButton} from './appearance.mjs';
const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
let page=tab?.id?await rpc('CR_SITE_STATE',{tabId:tab.id}):{supported:false,available:false};
function render(){const available=page.supported&&page.available;
 $('#app').innerHTML=`<header class="popup-header">${brand()}${themeButton()}</header><section class="popup-content"><h1>${!available?'此页面不可用':page.enabled?'此网站已启用':'此网站已停用'}</h1><p class="muted">${!available?'Chrome 内部页、扩展页或浏览器保护的页面无法启用。':page.enabled?'悬停查看已收录表达，划选词句生成解释。':'此网站不显示标记或划选浮层。'}</p>${page.origin?`<p class="micro-copy" style="overflow-wrap:anywhere">${e(new URL(page.origin).host)}</p>`:''}<button type="button" class="button ${page.enabled?'secondary':'primary'} popup-main" id="enable" ${available?'':'disabled'}>${!available?'此页面不可用':page.enabled?'停用此网站':'在此网站启用'}</button>${available?'<p class="micro-copy">所有普通网页默认启用。</p>':''}<details class="mark-legend"><summary>原文标记说明</summary><dl>${Object.entries(markTypes).map(([kind,m])=>`<div><dt><span lang="en" style="${markStyle(kind)}">${e(m.sample)}</span></dt><dd>${e(m.label)}</dd></div>`).join('')}</dl><p class="micro-copy">标记表示已保存的解释或任务状态，不表示已掌握。悬停查看，链接仍可正常打开。</p></details><p id="status" class="status" aria-live="polite"></p></section><footer class="popup-footer"><button type="button" class="text-button" id="library">${icon('library')}知识库</button><button type="button" class="text-button" id="settings">${icon('settings')}设置</button></footer>`;
 $('#enable').addEventListener('click',async()=>{const button=$('#enable');button.disabled=true;try{const result=await rpc('CR_SET_SITE_ENABLED',{tabId:tab.id,enabled:!page.enabled});page={...page,...result};render();void refreshTasks();flash(page.enabled?'已启用，回到原文即可使用。':'已停用此网站，其他网站继续自动启用。');}catch(error){button.disabled=false;flash(error.message,true);}});
 $('#library').addEventListener('click',()=>rpc('CR_OPEN_LIBRARY'));$('#settings').addEventListener('click',()=>rpc('CR_OPEN_SETTINGS'));
}
async function refreshTasks(){try{const summary=taskSummary(await rpc('CR_TASK_LIST'));if(!summary.quick&&!summary.learning&&!summary.attention){$('#task-summary')?.remove();return;}let button=$('#task-summary');if(!button){button=document.createElement('button');button.type='button';button.id='task-summary';button.className='popup-task-summary';document.querySelector('.popup-content').append(button);button.addEventListener('click',()=>rpc('CR_OPEN_LIBRARY',{view:'tasks'}));}button.innerHTML=`<span>${e(summary.text)}</span><span class="task-view-link">查看任务</span>`;}catch{}}
chrome.runtime.onMessage.addListener(message=>{if(message.type==='CR_TASKS_CHANGED')void refreshTasks();});
render();void refreshTasks();
