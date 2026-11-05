import {expressionKind} from '../shared/core.mjs';
import { escapeHtml as e, sourceLabel, safeUrl } from '../shared/core.mjs';
import {icon} from './icons.mjs';
export const closeIcon=icon('close');
export const bookIcon=icon('book');
export const expandIcon=icon('expand');
export function quote(text,surface=''){
  const i=surface?text.toLowerCase().indexOf(surface.toLowerCase()):-1;
  const content=i<0?e(text):e(text.slice(0,i))+'<mark>'+e(text.slice(i,i+surface.length))+'</mark>'+e(text.slice(i+surface.length));
  return `<blockquote class="source-quote" lang="en">${content}</blockquote>`;
}
export function historyHtml(contexts=[]){return contexts.length?contexts.map(c=>`<section class="history-record"><div class="source-line"><span class="source-domain">${safeUrl(c.source.url)?`<a href="${e(safeUrl(c.source.url))}" target="_blank" rel="noopener noreferrer">${e(sourceLabel(c.source))}</a>`:e(sourceLabel(c.source))}</span><time>${e(new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'}).format(new Date(c.createdAt)))}</time></div><p class="context-meaning">${e(c.meaning)}</p>${quote(c.sentence,c.surface)}${c.explanation?`<p class="explanation">${e(c.explanation)}</p>`:''}${c.uncertainty?`<p class="uncertainty">${e(c.uncertainty)}</p>`:''}</section>`).join(''):'<p class="muted">还没有保存语境。</p>';}
export function learningHtml(entry){
  const l=entry.learning||{};
  if(l.status==='pending'&&!l.usage)return '<div class="learning-notice"><span class="status-dot is-pending" aria-hidden="true"></span><p>短解释已经保存。<br><span class="muted">学习资料正在补齐，可以先继续读。</span></p></div>';
  if(l.status!=='ready'&&!l.usage)return `<div class="learning-notice"><p>${l.status==='failed'?'学习资料没有完成，已有解释仍在。':'还没有补充学习资料。'}</p></div><button type="button" class="button secondary" data-enrich>补充学习资料</button>`;
  return `${l.status!=="ready"?`<p class="learning-refresh" role="status">${l.status==="pending"?"正在更新学习资料，先显示上次保存的内容。":"资料更新未完成，已保留上次内容。"}</p>${l.status==="failed"?'<button type="button" class="button secondary" data-enrich>重试学习资料</button>':""}`:""}<section class="learning-block usage-block"><h3>怎么用</h3><p>${e(l.usage||entry.note)}</p></section><details class="learning-block" open><summary><span>理解与记忆</span></summary><div class="learning-disclosure"><p>${e(l.memory)}</p></div></details><details class="learning-block" open><summary><span>例句 <span class="subtle-badge">自拟</span></span></summary><div class="learning-disclosure">${(l.examples||[]).map(x=>`<div class="example-pair"><p class="example" lang="en">${e(x.english)}</p><p class="example-translation">${e(x.chinese)}</p></div>`).join('')}</div></details>${l.etymology&&safeUrl(l.etymologySource)?`<details class="learning-block" open><summary><span>词源</span></summary><div class="learning-disclosure"><p>${e(l.etymology)}</p><a href="${e(safeUrl(l.etymologySource))}" target="_blank" rel="noopener noreferrer">核对来源</a></div></details>`:''}`;
}
export function termHeading(entry){const kind=expressionKind(entry),label={word:'单词',phrase:'短语',compound:'复合词'}[kind]||'表达';return `<div class="term-heading"><h1 class="term-title" lang="en">${e(entry.canonical)}</h1><div class="pronunciation">${entry.ipaUK||entry.ipaUS?`<span class="ipa-pair"><span class="ipa-label">英</span><span lang="en">${e(entry.ipaUK||"读音待确认")}</span></span><span class="ipa-pair"><span class="ipa-label">美</span><span lang="en">${e(entry.ipaUS||"读音待确认")}</span></span>`:entry.ipa?`<span class="ipa-pair"><span class="ipa-label">音标</span><span lang="en">${e(entry.ipa)}</span></span><span class="ipa-legacy">尚未区分英美</span>`:kind!=='phrase'?'<span class="ipa-unavailable">读音待确认</span>':''}<span class="expression-kind">${label}</span>${entry.partOfSpeech?`<span class="part-of-speech">${e(entry.partOfSpeech)}</span>`:''}</div></div>`;}
export function baseMeaning(entry){return `<section class="base-definition"><h2>常用释义</h2><p class="base-meaning">${e(entry.baseMeanings.join('；'))}</p></section>`;}
