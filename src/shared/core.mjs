export const VERSION = 1;
export const DEFAULTS = Object.freeze({ mode: 'oauth', model: '', oauthModel:'gpt-6-luna', oauthProfileId:'', baseUrl: 'https://api.openai.com/v1', protocol: 'responses', rememberKey: false });
export const norm = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
export const keyOf = value => norm(value).toLocaleLowerCase('en-US');
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeUrl(value) {
  try { const u = new URL(value); if (!['https:', 'http:'].includes(u.protocol)) return ''; u.username = ''; u.password = ''; u.hash = ''; for (const name of [...u.searchParams.keys()]) if (/^(utm_|token$|auth$|session$|key$|signature$)/i.test(name)) u.searchParams.delete(name); return u.href; } catch { return ''; }
}
export function validateEndpoint(value, { bridge = false } = {}) {
  const u = new URL(value); if (u.username || u.password || u.search || u.hash) throw new Error('连接地址不能包含账号、密码、查询参数或片段。');
  if (bridge ? u.protocol !== 'http:' || u.hostname !== '127.0.0.1' : u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) throw new Error(bridge ? '本机连接只允许 http://127.0.0.1。' : '模型地址需要 HTTPS；本机服务可使用 HTTP。');
  return u.href.replace(/\/$/, '');
}
export function sanitizeRequest(input) {
  if (!input || !['term', 'passage'].includes(input.kind)) throw new Error('请选择要解释的表达或句段。');
  const selected = norm(input.selected); if (!selected || selected.length > 1600) throw new Error('请选择 1–1600 个字符；内容过长时请分段查询。');
  const sentence = norm(input.sentence).slice(0, 2200);
  const context = norm(input.context || sentence || selected).slice(0, 3200);
  return { kind: input.kind, selected, sentence: sentence || selected, context, before:norm(input.before).slice(-400),after:norm(input.after).slice(0,400),source: { url: safeUrl(input.source?.url), title: norm(input.source?.title).slice(0, 240) }, entryId: typeof input.entryId === 'string' ? input.entryId.slice(0, 80) : '' };
}
export async function digest(value) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join(''); }
export function providerIdentity(s) { return JSON.stringify([s.mode, s.mode==='oauth'?s.oauthModel||s.model||'':s.model||'', s.mode==='oauth'?'https://api.openai.com/v1':s.baseUrl, s.mode==='oauth'?'responses':s.protocol, 'explanation-v2',...(s.mode==='oauth'?[s.oauthProfileId||'']:s.apiKeyId?[s.apiKeyId]:[])]); }
export async function contextKey(request, provider = '') { return digest(JSON.stringify([request.kind, keyOf(request.selected), norm(request.sentence), norm(request.context),norm(request.before),norm(request.after),request.source.url, provider])); }
export function surroundings(context,surface,hint=''){const text=norm(context),needle=norm(surface);const positions=[];let i=-1;while((i=text.toLowerCase().indexOf(needle.toLowerCase(),i+1))>=0){if(!hint||norm(text.slice(0,i)).endsWith(norm(hint).slice(-100)))positions.push(i);if(!needle)break;}if(positions.length!==1)return null;const at=positions[0];return {before:norm(text.slice(0,at)).slice(-400),after:norm(text.slice(at+needle.length)).slice(0,400)};}
export function errorText(error) { return String(error?.message || error || '请求未完成。').replace(/(?:sk-[\w-]{8,}|Bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+)/gi, '[已隐藏]').slice(0, 500); }
export function sourceLabel(source) { try { return new URL(source.url).hostname.replace(/^www\./, ''); } catch { return source.title || '原文'; } }
export function emptyLibrary() { return { version: VERSION, entries: [], contexts: [], snippets: [] }; }
export function expressionKind(expression){const canonical=norm(expression.canonical);return expression.kind==='word'&&/[\p{L}\p{N}][\-\u2010-\u2015][\p{L}\p{N}]/u.test(canonical)?'compound':expression.kind;}

// Reattach only an unambiguous occurrence in an unchanged context. Never mark
// every spelling of a submitted word or guess a new position after text edits.
export function locateOccurrence(text,request){
 if(text.normalize('NFC')!==text)return null;
 const clean=[],offsets=[];let space=false;
 for(let i=0;i<text.length;i++){if(/\s/u.test(text[i])){if(!space){clean.push(' ');offsets.push(i);}space=true;}else{space=false;clean.push(text[i]);offsets.push(i);}}
 let normalized=clean.join('');if(normalized.startsWith(' ')){normalized=normalized.slice(1);offsets.shift();}normalized=normalized.trimEnd();
 const context=norm(request.context),needle=norm(request.selected);if(!needle||!context||!normalized.includes(context))return null;
 const hits=[];let at=-1;while((at=normalized.toLowerCase().indexOf(needle.toLowerCase(),at+1))>=0){const before=norm(normalized.slice(0,at)).slice(-400),after=norm(normalized.slice(at+needle.length)).slice(0,400);if(before===norm(request.before)&&after===norm(request.after))hits.push({start:offsets[at],end:offsets[at+needle.length-1]+1});}
 return hits.length===1?hits[0]:null;
}
// A boundary suggestion must contain the submitted occurrence, including when
// it expands to the left. A matching phrase elsewhere is not evidence.
export function expandSelection(request,surface){const context=norm(request.context),selected=norm(surface),original=locateOccurrence(context,request);if(!selected||!original)return null;const positions=[];let at=-1;while((at=context.toLowerCase().indexOf(selected.toLowerCase(),at+1))>=0)if(at<=original.start&&at+selected.length>=original.end)positions.push(at);if(positions.length!==1)return null;const start=positions[0];return {...request,selected,before:norm(context.slice(0,start)).slice(-400),after:norm(context.slice(start+selected.length)).slice(0,400)};}

// Hyphens separate exact lexical components; they do not license guessed inflections.
const wordChar = c => !!c && /[\p{L}\p{N}_'’]/u.test(c);
const matchChar=c=>/[\u2010-\u2015]/u.test(c)?'-':c.toLowerCase();
export function makeMatcher(entries) {
  const root = new Map();
  for (const entry of entries) { if (entry.paused) continue; for (const alias of new Set([entry.canonical, ...(entry.aliases || [])].map(keyOf).filter(Boolean))) {
    if (alias.length > 150) continue; let node = root;
    for (const original of alias) { if (/[\u00ad\u200b\ufeff]/u.test(original)) continue; const c=matchChar(original); if (!node.has(c)) node.set(c, new Map()); node = node.get(c); }
    if (!node.has(null)) node.set(null, entry);
  } }
  return text => {
    const clean = [], offsets = []; let inSpace = false;
    for (let i = 0; i < text.length; i++) { const c = text[i]; if (/[\u00ad\u200b\ufeff]/u.test(c)) continue; if (/\s/u.test(c)) { if (!inSpace) { clean.push(' '); offsets.push(i); } inSpace = true; } else { inSpace = false; clean.push(matchChar(c)); offsets.push(i); } }
    const haystack = clean.join(''), matches = [];
    for (let i = 0; i < haystack.length; i++) { if (wordChar(haystack[i - 1])) continue; let node = root, best = null;
      for (let j = i; j < haystack.length && node.has(haystack[j]); j++) { node = node.get(haystack[j]); if (node.has(null) && !wordChar(haystack[j + 1])) best = { start: offsets[i], end: offsets[j] + 1, entry: node.get(null), next: j + 1 }; }
      if (best) { matches.push({ start: best.start, end: best.end, entry: best.entry }); i = best.next - 1; }
    }
    return matches;
  };
}
