import { bookIcon } from './components.mjs';
import { icon } from './icons.mjs';
let port, activeSpeakButton = null;const pending=new Map();
const disconnected=()=>Object.assign(new Error('扩展连接已中断，请重试。'),{code:'disconnected'});
function connect(){if(port)return port;port=chrome.runtime.connect({name:'cr-rpc'});port.onMessage.addListener(message=>{const job=pending.get(message.id);if(!job)return;if(message.progress){job.progress?.(message.progress);return;}pending.delete(message.id);clearInterval(job.keepalive);message.ok?job.resolve(message.data):job.reject(new Error(message.error||'操作未完成。'));});port.onDisconnect.addListener(()=>{port=null;for(const job of pending.values()){clearInterval(job.keepalive);job.reject(disconnected());}pending.clear();});return port;}
function request(type,payload,progress){return new Promise((resolve,reject)=>{const id=crypto.randomUUID();const current=connect();const keepalive=setInterval(()=>{try{current.postMessage({type:'ping'});}catch{}},10000);pending.set(id,{resolve,reject,progress,keepalive});try{current.postMessage({id,type,payload});}catch{pending.delete(id);clearInterval(keepalive);port=null;reject(disconnected());}});}
const reconnectReads=new Set(['CR_GET_PASSAGE','CR_GET_ENTRY','CR_GET_SETTINGS','CR_SNAPSHOT','CR_TASK_GET','CR_TASK_LOOKUP','CR_TASK_LIST','CR_SITE_STATE','CR_OAUTH_STATE','CR_CLOUD_STATE']);
export async function rpc(type,payload={},progress){try{return await request(type,payload,progress);}catch(error){if(error.code!=='disconnected'||!reconnectReads.has(type))throw error;await new Promise(r=>setTimeout(r,50));return request(type,payload,progress);}}
export const $=selector=>document.querySelector(selector);
export function announce(text){const node=$('#live-status');if(node)node.textContent=text;}
export function flash(text,error=false){const node=$('#status');if(node){node.textContent=text;node.className=error?'status error':'status';node.setAttribute('role',error?'alert':'status');}}
export function brand(){return `<a class="wordmark" href="library.html" target="_blank" rel="noopener"><span class="brand-mark">${bookIcon}</span><span>语境</span><span class="brand-name">Context Reader</span></a>`;}
export function wireTabs(root,onSelect){const tabs=[...root.querySelectorAll('[data-tab]')];tabs.forEach((button,i)=>{button.id='entry-tab-'+button.dataset.tab;button.tabIndex=button.getAttribute('aria-selected')==='true'?0:-1;button.setAttribute('aria-controls','entry-panel');button.addEventListener('click',()=>onSelect(button.dataset.tab));button.addEventListener('keydown',event=>{const keys=['ArrowLeft','ArrowRight','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;const name=tabs[next].dataset.tab;onSelect(name);root.querySelector('[data-tab="'+name+'"]')?.focus();});});}
export function animateDetail(root){if(!root||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const panel=root.querySelector('#entry-panel');panel?.animate?.([{opacity:0.65,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:' ease-out'.trim()});}
export function speakText(text, lang = 'en-US', button = null) {
  const clean = String(text ?? '').trim();
  if (!clean || typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
    announce('当前浏览器环境暂不支持语音朗读。');
    return;
  }
  try {
    if (activeSpeakButton && activeSpeakButton === button && speechSynthesis.speaking) {
      speechSynthesis.cancel();
      activeSpeakButton.classList.remove('is-speaking');
      activeSpeakButton = null;
      return;
    }
    speechSynthesis.cancel();
    if (activeSpeakButton) activeSpeakButton.classList.remove('is-speaking');
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = lang;
    utterance.rate = 0.94;
    const voices = speechSynthesis.getVoices?.() || [];
    const targetPrefix = lang.toLowerCase();
    const matchedVoice = voices.find(v => v.lang?.toLowerCase().replace('_', '-') === targetPrefix) || voices.find(v => v.lang?.toLowerCase().startsWith('en'));
    if (matchedVoice) utterance.voice = matchedVoice;
    if (button) {
      activeSpeakButton = button;
      button.classList.add('is-speaking');
      const clear = () => { button.classList.remove('is-speaking'); if (activeSpeakButton === button) activeSpeakButton = null; };
      utterance.addEventListener('end', clear, { once: true });
      utterance.addEventListener('error', clear, { once: true });
    }
    speechSynthesis.speak(utterance);
    announce(`正在朗读 ${clean}`);
  } catch {
    button?.classList.remove('is-speaking');
  }
}
export async function copyText(text, button = null) {
  const clean = String(text ?? '').trim();
  if (!clean) return;
  try {
    await navigator.clipboard.writeText(clean);
    announce('已复制表达。');
    if (button) {
      const previous = button.innerHTML;
      button.classList.add('is-copied');
      button.innerHTML = icon('check');
      setTimeout(() => {
        if (button.isConnected) {
          button.classList.remove('is-copied');
          button.innerHTML = previous;
        }
      }, 1400);
    }
  } catch {}
}
export function wireEntryInteractions(root) {
  root.querySelectorAll('[data-speak]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.stopPropagation();
      speakText(btn.dataset.speak, btn.dataset.lang || 'en-US', btn);
    });
  });
  root.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.stopPropagation();
      void copyText(btn.dataset.copy, btn);
    });
  });
}
