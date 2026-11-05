import {safeUrl} from '../shared/core.mjs';
import {buildWeReadScopes,selectionFromWeReadRects,requestForWeReadSelection,locateWeReadRequest} from './weread-text.mjs';

const CHANNEL='context-reader-weread',ROOT='context-reader-weread-text';
const TOOLBAR='[data-wr-role="selectionToolbar"],.reader_toolbar_container';
const WRITER='.reader_float_review_writer,.readerWriteReviewPanel,.readerReviewDetailPanel,.wr_dialog,[role="dialog"]';
const EDITOR='input,textarea,select,[contenteditable]:not([contenteditable="false"])';
const own=node=>node instanceof Element&&!!node.closest('#'+ROOT+',#context-reader-host');
const rectOf=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility==='visible';};
const union=rects=>{const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top)),right=Math.max(...rects.map(r=>r.right)),bottom=Math.max(...rects.map(r=>r.bottom));return {left,top,right,bottom,width:right-left,height:bottom-top};};
export const getWeReadAdapter=()=>globalThis.__contextReaderWeReadAdapter;

// The early isolated script owns text nodes and extension policy. The MAIN
// script supplies page text/geometry only; it cannot submit tasks or read storage.
export function installWeReadAdapter(){
 if(location.hostname!=='weread.qq.com'||location.protocol!=='https:'||getWeReadAdapter())return getWeReadAdapter();
 let enabled=false,policyRevision=0,root,scopes=[],nodes=new Map(),listeners=new Set(),timer,observer;
 let lastContent='',lastPage=location.pathname,lastSelection='',pendingSelection=false,dragging=false,nativeBusy=false;
 let lastSnapshot=null,revision=0,receivedAt=0,armedAt=0;
 const onReader=()=>location.pathname.startsWith('/web/reader/');
 const emit=(type,value={})=>{for(const listener of listeners)listener({type,...value});};
 const control=()=>window.postMessage({channel:CHANNEL,type:'capture',enabled},location.origin);
 const toolbarRects=()=>[...document.querySelectorAll(TOOLBAR)].filter(visible).map(rectOf);
 const writerVisible=()=>[...document.querySelectorAll(WRITER)].some(e=>!own(e)&&visible(e));
 const nativeRects=()=>[...document.querySelectorAll('.wr_selection')].filter(visible).map(rectOf).filter(r=>r.width>.5&&r.height>.5).slice(0,200);
 const isBlocked=()=>nativeBusy||dragging||writerVisible()||!!document.activeElement?.closest(EDITOR);

 function mount(){
  if(root?.isConnected||!document.body)return;
  root=document.createElement('div');root.id=ROOT;
  root.style.cssText='position:fixed;inset:0;z-index:10;pointer-events:none;overflow:visible;user-select:none;-webkit-user-select:none;';
  document.body.append(root);
 }
 function rangeFor(scope,start,end){
  const records=nodes.get(scope.id)||scope.parts?.flatMap(part=>(nodes.get(part.id)||[]).map(record=>({...record,start:record.start+part.start,end:record.end+part.start})));if(!records)return null;
  const first=records.find(r=>start>=r.start&&start<r.end),last=records.find(r=>end>r.start&&end<=r.end);
  if(!first||!last)return null;
  const range=document.createRange();range.setStart(first.node,start-first.start);range.setEnd(last.node,end-last.start);return range;
 }
 function requestForRange(range,kind){
  const scope=scopes.find(s=>nodes.get(s.id)?.some(r=>r.node===range.startContainer));
  if(!scope)return null;
  const records=nodes.get(scope.id),first=records.find(r=>r.node===range.startContainer),last=records.find(r=>r.node===range.endContainer);
  if(!first||!last)return null;
  const request=requestForWeReadSelection(scope,{start:first.start+range.startOffset,end:last.start+range.endOffset},{url:safeUrl(location.href),title:document.title});
  return request&&{...request,...(kind?{kind}:{})};
 }
 function render(snapshot){
  if(!enabled)return;
  if(!onReader()){const pageChanged=lastPage!==location.pathname;lastPage=location.pathname;root?.remove();root=null;scopes=[];nodes.clear();lastContent='';lastSelection='';nativeBusy=false;pendingSelection=false;emit('content',{changed:true,pageChanged});return;}
  const next=buildWeReadScopes(snapshot.canvases,{url:safeUrl(location.href),title:document.title},snapshot.paragraphs||[]);
  const content=JSON.stringify(next.map(s=>[s.id,s.text,s.contextText||''])),changed=content!==lastContent;
  const pageChanged=lastPage!==location.pathname;lastPage=location.pathname;lastContent=content;
  scopes=next;mount();if(!root)return;
  const keep=new Set(next.map(s=>s.id));for(const p of [...root.children])if(!keep.has(p.dataset.crWereadScope)){nodes.delete(p.dataset.crWereadScope);p.remove();}
  for(const scope of scopes){
   let p=[...root.children].find(p=>p.dataset.crWereadScope===scope.id);
   const signature=JSON.stringify(scope.glyphs.map(g=>[g.start,g.end,g.text,g.rect,g.font,g.scaleX,g.scaleY]));
   if(p?.__crSignature===signature)continue;
   if(!p){p=document.createElement('p');p.dataset.crWereadScope=scope.id;p.lang='en';p.style.cssText='position:absolute;margin:0;padding:0;border:0;pointer-events:none;color:transparent;white-space:pre;user-select:none;-webkit-user-select:none;';root.append(p);}
   p.style.left=scope.rect.left+'px';p.style.top=scope.rect.top+'px';p.style.width=scope.rect.width+'px';p.style.height=scope.rect.height+'px';
   const fragment=document.createDocumentFragment(),records=[];let at=0;
   for(const glyph of scope.glyphs){
    if(glyph.start>at){const node=document.createTextNode(scope.text.slice(at,glyph.start));fragment.append(node);records.push({node,start:at,end:glyph.start});}
    const span=document.createElement('span');span.dataset.crWereadGlyph='';
    span.style.cssText='position:absolute;display:block;pointer-events:none;color:transparent;white-space:pre;transform-origin:0 0;user-select:none;-webkit-user-select:none;';
    span.style.font=glyph.font;const canvas=snapshot.canvases.find(c=>String(c.id)===scope.canvasId);
    if(canvas?.fontFamily)span.style.fontFamily+=','+canvas.fontFamily;
    const fontSize=Number(glyph.font?.match(/([\d.]+)px/)?.[1])||glyph.rect.height;
    const sx=glyph.scaleX*(canvas?.rect.width/canvas?.width||1),sy=glyph.scaleY*(canvas?.rect.height/canvas?.height||1);
    span.style.lineHeight=fontSize+'px';span.style.left=(glyph.rect.left-scope.rect.left)+'px';span.style.top=(glyph.rect.top-scope.rect.top)+'px';
    span.style.width=(sx>0?glyph.rect.width/sx:glyph.rect.width)+'px';span.style.height=fontSize+'px';
    span.style.transform=`scale(${sx||1},${sy||1})`;span.style.fontKerning=glyph.fontKerning||'auto';span.style.letterSpacing=glyph.letterSpacing||'0px';span.style.wordSpacing=glyph.wordSpacing||'0px';
    const node=document.createTextNode(glyph.text);span.append(node);fragment.append(span);records.push({node,start:glyph.start,end:glyph.end});at=glyph.end;
   }
   p.replaceChildren(fragment);p.__crSignature=signature;nodes.set(scope.id,records);
  }
  root.dataset.status=scopes.length?'ready':'waiting';root.dataset.glyphCount=String(scopes.reduce((n,s)=>n+s.glyphs.length,0));
  root.style.opacity=nativeBusy?'0':'1';emit('content',{changed,pageChanged});
 }
 function readSelection(){
  const rects=nativeRects();if(!rects.length)return null;
  const selection=selectionFromWeReadRects(scopes,rects);if(!selection)return null;
  const request=requestForWeReadSelection(selection.scope,selection,{url:safeUrl(location.href),title:document.title});if(!request)return null;
  return {request,rect:union(rects)};
 }
 function updateNative(){
  timer=null;if(!enabled)return;
  const rects=nativeRects(),busy=rects.length>0||toolbarRects().length>0||writerVisible();
  nativeBusy=busy;if(root)root.style.opacity=busy?'0':'1';
  if(writerVisible()){pendingSelection=false;emit('native');return;}
  if(!pendingSelection||dragging)return;
  const value=readSelection();if(!value)return;
  const key=JSON.stringify(value.request);if(key===lastSelection)return;
  lastSelection=key;pendingSelection=false;emit('selection',value);
 }
 function scheduleNative(){if(!timer)timer=setTimeout(updateNative,40);}
 function setEnabled(value){
  const next=!!value;if(next===enabled){control();return;}enabled=next;armedAt=performance.now();control();
  if(enabled){observe();if(lastSnapshot)render(lastSnapshot);}
  else{root?.remove();root=null;scopes=[];nodes.clear();lastSnapshot=null;lastContent='';lastSelection='';nativeBusy=false;pendingSelection=false;observer?.disconnect();clearTimeout(timer);timer=null;emit('content',{changed:true});}
 }
 function observe(){
  if(!document.documentElement)return;
  observer??=new MutationObserver(changes=>{
   if(!enabled||changes.every(c=>own(c.target)||c.type==='childList'&&[...c.addedNodes,...c.removedNodes].length&&[...c.addedNodes,...c.removedNodes].every(own)))return;
   if(pendingSelection||nativeBusy||changes.some(c=>c.target instanceof Element&&c.target.closest(TOOLBAR+','+WRITER)))scheduleNative();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class']});
 }
 window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!==CHANNEL)return;
  if(event.data.type==='ready'){control();return;}
  const data=event.data;if(data.type!=='snapshot'||!enabled||data.page!==location.pathname||!Number.isSafeInteger(data.revision)||data.revision<revision||!Array.isArray(data.canvases)||data.canvases.length>8)return;
  let count=0;for(const c of data.canvases){if(!c||!Array.isArray(c.glyphs)||(count+=c.glyphs.length)>16000||typeof c.fontFamily!=='string'||c.fontFamily.length>500)return;for(const g of c.glyphs)if(typeof g?.font!=='string'||g.font.length>400||typeof g.text!=='string'||g.text.length>1600||![g.scaleX,g.scaleY].every(n=>Number.isFinite(n)&&n>0&&n<=100))return;}
  if(data.paragraphs&&(!Array.isArray(data.paragraphs)||data.paragraphs.length>2000||data.paragraphs.reduce((n,p)=>n+(typeof p?.text==='string'?p.text.length:1e6),0)>200000))return;
  revision=data.revision;receivedAt=performance.now();lastSnapshot=data;render(data);scheduleNative();
 });
 window.addEventListener('pointerdown',event=>{
  if(!enabled||own(event.target))return;
  if(event.target.closest?.(TOOLBAR+','+WRITER+','+EDITOR)){pendingSelection=false;emit('native');return;}
  if(event.target.closest?.('.readerChapterContent,.renderTargetCanvasContainer')){dragging=true;pendingSelection=false;lastSelection='';emit('native');}
 },{capture:true,passive:true});
 window.addEventListener('mouseup',()=>{if(dragging){dragging=false;pendingSelection=true;scheduleNative();}},{capture:true,passive:true});
 window.addEventListener('pointercancel',()=>{dragging=false;pendingSelection=false;},{capture:true,passive:true});
 window.addEventListener('focusin',event=>{if(!own(event.target)&&event.target.closest?.(EDITOR)){pendingSelection=false;emit('native');}},true);
 document.addEventListener('DOMContentLoaded',()=>{if(enabled){observe();if(lastSnapshot)render(lastSnapshot);}} ,{once:true});
 const api={setEnabled,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},selection:readSelection,requestForRange,
  containsRange:range=>!!range?.startContainer?.parentElement?.closest('#'+ROOT),blocked:isBlocked,
  locate(request){const match=locateWeReadRequest(scopes,request);return match&&rangeFor(match.scope,match.start,match.end);},
  placeCard(anchor,width,height){
   const vw=document.documentElement.clientWidth,vh=innerHeight,left=Math.max(12,Math.min(anchor.left,vw-width-12));
   const obstacles=toolbarRects().filter(r=>r.left<left+width+8&&r.right>left-8).sort((a,b)=>a.top-b.top);
   if(!obstacles.length)return null;
   // Choose a free region independently of the card's current height, so an
   // expanded iframe cannot oscillate between two viewport limits.
   let top=12;const spaces=[];for(const r of obstacles){if(r.top-8>top)spaces.push({top,bottom:Math.min(vh-12,r.top-8)});top=Math.max(top,r.bottom+8);}if(top<vh-12)spaces.push({top,bottom:vh-12});
   const free=spaces.filter(s=>s.bottom-s.top>=88).sort((a,b)=>(b.bottom-b.top)-(a.bottom-a.top))[0];
   if(!free)return {left,top:12,height:Math.max(1,obstacles[0].top-20),maxHeight:Math.max(1,obstacles[0].top-20)};
   const maxHeight=free.bottom-free.top,h=Math.min(height,maxHeight);
   return {left,top:Math.max(free.top,Math.min(anchor.bottom+8,free.bottom-h)),height:h,maxHeight};
  },
  state(){return onReader()?{reader:'weread',ready:scopes.length>0,needsRefresh:enabled&&!scopes.length&&performance.now()-armedAt>1000&&!!document.querySelector('.readerChapterContent canvas,.renderTargetCanvasContainer canvas'),lastCapture:receivedAt}:null;}
 };
 globalThis.__contextReaderWeReadAdapter=api;
 chrome.runtime.onMessage.addListener(message=>{if(message.type==='CR_READING_CHANGED'){policyRevision++;setEnabled(message.enabled);}});
 chrome.runtime.sendMessage({type:'CR_READING_POLICY'}).then(response=>{if(!policyRevision&&response?.ok)setEnabled(response.data.enabled);}).catch(()=>{});
 return api;
}
