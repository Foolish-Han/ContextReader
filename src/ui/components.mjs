import { expressionKind, escapeHtml as e, sourceLabel, safeUrl, isMultiPart } from '../shared/core.mjs';
import { icon } from './icons.mjs';
export const closeIcon = icon('close');
export const bookIcon = icon('book');
export const expandIcon = icon('expand');
export function quote(text, surface = '') {
  const i = surface ? text.toLowerCase().indexOf(surface.toLowerCase()) : -1;
  const content = i < 0 ? e(text) : e(text.slice(0, i)) + '<mark>' + e(text.slice(i, i + surface.length)) + '</mark>' + e(text.slice(i + surface.length));
  return `<blockquote class="source-quote" lang="en">${content}</blockquote>`;
}
export function historyHtml(contexts = [], { allowDelete = false } = {}) {
  return contexts.length
    ? contexts.map(c => `<section class="history-record"><div class="source-line"><span class="source-domain">${safeUrl(c.source.url) ? `<a href="${e(safeUrl(c.source.url))}" target="_blank" rel="noopener noreferrer">${e(sourceLabel(c.source))}${icon('external')}</a>` : e(sourceLabel(c.source))}</span><span class="history-meta-right"><time>${e(new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(c.createdAt)))}</time>${allowDelete ? `<button type="button" class="icon-button history-delete" data-delete-context="${e(c.id)}" aria-label="删除此条语境" title="删除此条语境">${icon('trash')}</button>` : ''}</span></div><p class="context-meaning">${e(c.meaning)}</p>${quote(c.sentence, c.surface)}${c.explanation ? `<p class="explanation">${e(c.explanation)}</p>` : ''}${c.uncertainty ? `<p class="uncertainty">${e(c.uncertainty)}</p>` : ''}</section>`).join('')
    : '<p class="muted">还没有保存语境。</p>';
}
export function componentsHtml(entry, { showUpgradeHint = false } = {}) {
  const list = Array.isArray(entry.components) ? entry.components.filter(c => c && c.word && c.meaning) : [];
  if (list.length) {
    return `<details class="components-panel" open><summary><span class="components-summary-title">${icon('layers')}<span>逐词拆解</span><span class="subtle-badge">${list.length}</span></span></summary><div class="components-list">${list.map(c => {
      const same = c.ipaUK && c.ipaUS && c.ipaUK === c.ipaUS;
      const ipa = same
        ? `<span class="component-ipa" lang="en">${e(c.ipaUS)}</span>`
        : `${c.ipaUK ? `<span class="component-ipa"><span class="ipa-label">英</span><span lang="en">${e(c.ipaUK)}</span></span>` : ''}${c.ipaUS ? `<span class="component-ipa"><span class="ipa-label">美</span><span lang="en">${e(c.ipaUS)}</span></span>` : ''}`;
      return `<div class="component-item"><div class="component-head"><span class="component-word" lang="en">${e(c.word)}</span>${ipa}<button type="button" class="ipa-speak" data-speak="${e(c.word)}" data-lang="en-US" aria-label="朗读 ${e(c.word)}" title="朗读 ${e(c.word)}">${icon('volume')}</button>${c.partOfSpeech ? `<span class="part-of-speech">${e(c.partOfSpeech)}</span>` : ''}</div><p class="component-meaning">${e(c.meaning)}</p></div>`;
    }).join('')}</div></details>`;
  }
  const missingIpa = !entry.ipaUK && !entry.ipaUS && !entry.ipa;
  const multi = expressionKind(entry) !== 'word' || isMultiPart(entry.canonical);
  if (showUpgradeHint && (multi || missingIpa)) {
    const copy = missingIpa && multi
      ? '此历史词条尚未生成英美音标与逐词拆解。'
      : missingIpa
        ? '此历史词条尚未生成完整英美音标。'
        : '此多词表达保存于旧版本，尚未生成逐词拆解。';
    return `<div class="legacy-upgrade-bar"><p class="legacy-upgrade-copy">${copy}</p><button type="button" class="small-button" data-upgrade-entry>${icon('sparkles')}<span>补全音标与拆解</span></button></div>`;
  }
  return '';
}
export function learningHtml(entry) {
  const l = entry.learning || {};
  if (l.status === 'pending' && !l.usage) return '<div class="learning-notice"><span class="status-dot is-pending" aria-hidden="true"></span><p>短解释已经保存。<br><span class="muted">学习资料正在补齐，可以先继续读。</span></p></div>';
  if (l.status !== 'ready' && !l.usage) return `<div class="learning-notice"><p>${l.status === 'failed' ? '学习资料没有完成，已有解释仍在。' : '还没有补充学习资料。'}</p></div><button type="button" class="button secondary" data-enrich>补充学习资料</button>`;
  return `${l.status !== 'ready' ? `<p class="learning-refresh" role="status">${l.status === 'pending' ? '正在更新学习资料，先显示上次保存的内容。' : '资料更新未完成，已保留上次内容。'}</p>${l.status === 'failed' ? '<button type="button" class="button secondary" data-enrich>重试学习资料</button>' : ''}` : ''}<section class="learning-block usage-block"><h3>怎么用</h3><p>${e(l.usage || entry.note)}</p></section><details class="learning-block" open><summary><span>理解与记忆</span></summary><div class="learning-disclosure"><p>${e(l.memory)}</p></div></details><details class="learning-block" open><summary><span>例句 <span class="subtle-badge">自拟</span></span></summary><div class="learning-disclosure">${(l.examples || []).map(x => `<div class="example-pair"><div class="example-head"><p class="example" lang="en">${e(x.english)}</p><button type="button" class="ipa-speak example-speak" data-speak="${e(x.english)}" data-lang="en-US" aria-label="朗读例句" title="朗读例句">${icon('volume')}</button></div><p class="example-translation">${e(x.chinese)}</p></div>`).join('')}</div></details>${l.etymology && safeUrl(l.etymologySource) ? `<details class="learning-block" open><summary><span>词源</span></summary><div class="learning-disclosure"><p>${e(l.etymology)}</p><a href="${e(safeUrl(l.etymologySource))}" target="_blank" rel="noopener noreferrer">核对来源</a></div></details>` : ''}`;
}
export function termHeading(entry) {
  const kind = expressionKind(entry), label = { word: '单词', phrase: '短语', compound: '复合词' }[kind] || '表达';
  const speakUK = `<button type="button" class="ipa-speak" data-speak="${e(entry.canonical)}" data-lang="en-GB" aria-label="英式朗读" title="英式朗读">${icon('volume')}</button>`;
  const speakUS = `<button type="button" class="ipa-speak" data-speak="${e(entry.canonical)}" data-lang="en-US" aria-label="美式朗读" title="美式朗读">${icon('volume')}</button>`;
  const ipaBlock = entry.ipaUK || entry.ipaUS
    ? `<span class="ipa-chip"><span class="ipa-pair"><span class="ipa-label">英</span><span lang="en">${e(entry.ipaUK || '读音待确认')}</span></span>${speakUK}</span><span class="ipa-chip"><span class="ipa-pair"><span class="ipa-label">美</span><span lang="en">${e(entry.ipaUS || '读音待确认')}</span></span>${speakUS}</span>`
    : entry.ipa
      ? `<span class="ipa-chip"><span class="ipa-pair"><span class="ipa-label">音标</span><span lang="en">${e(entry.ipa)}</span></span>${speakUS}</span><span class="ipa-legacy">尚未区分英美</span>`
      : `${kind !== 'phrase' ? '<span class="ipa-unavailable">读音待确认</span>' : ''}<button type="button" class="ipa-speak ipa-speak-fallback" data-speak="${e(entry.canonical)}" data-lang="en-US" aria-label="朗读表达" title="朗读表达">${icon('volume')}</button>`;
  return `<div class="term-heading"><div class="term-heading-row"><h1 class="term-title" lang="en">${e(entry.canonical)}</h1><button type="button" class="icon-button copy-button" data-copy="${e(entry.canonical)}" aria-label="复制表达" title="复制表达">${icon('copy')}</button></div><div class="pronunciation">${ipaBlock}<span class="expression-kind">${label}</span>${entry.partOfSpeech ? `<span class="part-of-speech">${e(entry.partOfSpeech)}</span>` : ''}</div></div>`;
}
export function baseMeaning(entry) {
  return `<section class="base-definition"><h2>常用释义</h2><p class="base-meaning">${e(entry.baseMeanings.join('；'))}</p></section>`;
}
export function candidatesHtml(candidates = []) {
  if (!candidates.length) return '';
  return `<section class="candidates"><h2>值得留下的表达</h2>${candidates.map((c, i) => {
    const ipa = c.ipaUS || c.ipaUK || c.ipa || '';
    const breakdown = Array.isArray(c.components) && c.components.length
      ? `<p class="candidate-breakdown">${c.components.map(part => `<span lang="en">${e(part.word)}</span> ${e(part.meaning)}`).join('；')}</p>`
      : '';
    return `<div class="candidate-row"><div class="candidate-body"><div class="candidate-head"><h3 lang="en">${e(c.canonical)}</h3>${ipa ? `<span class="candidate-ipa" lang="en">${e(ipa)}</span>` : ''}<button type="button" class="ipa-speak" data-speak="${e(c.canonical)}" data-lang="en-US" aria-label="朗读 ${e(c.canonical)}" title="朗读 ${e(c.canonical)}">${icon('volume')}</button>${c.partOfSpeech ? `<span class="part-of-speech">${e(c.partOfSpeech)}</span>` : ''}</div><p>${e(c.meaning)}</p>${breakdown}</div><button type="button" class="small-button" data-candidate="${i}">收录</button></div>`;
  }).join('')}</section>`;
}
