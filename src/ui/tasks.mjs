import {escapeHtml as e} from '../shared/core.mjs';
export const liveStates=new Set(['queued','preparing','running']);
export const needsAction=new Set(['confirm','failed','blocked','interrupted','save_failed']);
export function taskLabel(task){
 const labels={queued:'已排队',preparing:'即将开始',running:task.kind==='learn'?'正在补充资料':'正在解释',confirm:'等待确认表达',done:task.kind==='learn'?'资料已保存':'解释已保存',failed:'生成没有完成',blocked:'需要检查连接',interrupted:'生成中断，结果未确认',save_failed:'已生成，尚未保存',canceled:'已取消'};
 if(task.state==='done'&&task.learning){const s=task.learning.state;if(liveStates.has(s))return '解释已保存，资料补充中';if(needsAction.has(s))return '解释已保存，资料待处理';}
 return labels[task.state]||task.state;
}
export function taskGroup(t){if(liveStates.has(t.state)||(t.state==='done'&&liveStates.has(t.learning?.state)))return 'active';if(needsAction.has(t.state)||(t.state==='done'&&needsAction.has(t.learning?.state)))return 'attention';return 'done';}
export function taskSummary(tasks){const quick=tasks.filter(t=>t.kind==='quick'&&liveStates.has(t.state)).length,learning=new Set(tasks.flatMap(t=>t.kind==='learn'&&liveStates.has(t.state)?[t.id]:liveStates.has(t.learning?.state)?[t.learning.id]:[])).size,attention=tasks.filter(t=>taskGroup(t)==='attention').length;return {quick,learning,attention,text:[quick?`${quick} 项待解释`:'',learning?`${learning} 项补资料`:'',attention?`${attention} 项待处理`:''].filter(Boolean).join('，')||'暂时没有进行中的任务'};}
export function taskActions(t){const id=e(t.id);let html='';
 if(['failed','blocked','interrupted','save_failed','canceled'].includes(t.state))html+=`<button type="button" class="button ${t.state==='save_failed'?'primary':'secondary'}" data-task-retry="${id}">${t.state==='save_failed'?'重新保存':t.state==='canceled'?'重新提交':'重试此任务'}</button>`;
 if(t.state==='blocked')html+='<button type="button" class="text-button" data-task-settings>连接设置</button>';
 if(liveStates.has(t.state)||needsAction.has(t.state))html+=`<button type="button" class="text-button" data-task-cancel="${id}">取消任务</button>`;
 if(t.state==='done'&&t.learning&&needsAction.has(t.learning.state))html+=`<button type="button" class="button secondary" data-task-retry="${e(t.learning.id)}">${t.learning.state==='save_failed'?'重新保存资料':'重试学习资料'}</button>`;
 if(t.state==='done'&&liveStates.has(t.learning?.state))html+=`<button type="button" class="text-button" data-task-cancel="${e(t.learning.id)}">取消补资料</button>`;
 return html;
}
