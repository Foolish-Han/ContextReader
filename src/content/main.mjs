import { makeMatcher, norm, safeUrl,locateOccurrence,expandSelection } from '../shared/core.mjs';
import {slate,slateDark} from '@radix-ui/colors';
import {markTypes,markStyle,taskMark} from '../shared/marks.mjs';
(() => {
  if(window.__contextReaderController||!['text/html','application/xhtml+xml'].includes(document.contentType))return;window.__contextReaderController=true;
  let enabled=false,policyRevision=0,refreshRevision=0,lastAnchors='',appearancePreference='system',lastLocation=safeUrl(location.href);
  const themeMedia=matchMedia('(prefers-color-scheme: dark)');
  const isDark=()=>appearancePreference==='dark'||appearancePreference==='system'&&themeMedia.matches;
  let entries=[],passages=[],pageTasks=[],matcher=()=>[],marks=[],nodeHits=new WeakMap(),hoverTimer,closeTimer,scanTimer,frame,host,shadow,nonce,pinned=false,hovering=false,anchorRect=null,visible=true,lastKey='',activeMark=null,frameExpanded=false,geometryLocked=false,pendingGeometry=null;
  const extensionOrigin=`chrome-extension://${chrome.runtime.id}`;
  const call=async(type,payload={})=>{const response=await chrome.runtime.sendMessage({type,payload});if(!response?.ok)throw new Error(response?.error||'扩展后台没有响应。');return response.data;};
  const outside='script,style,code,pre,nav,header,footer,button,input,textarea,select,[role="button"],[role="menu"],[role="navigation"],[contenteditable]:not([contenteditable="false"]),[role="textbox"],[aria-hidden="true"],#context-reader-host';
  const blockSelector='p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,div,section,article';
  const readingBlock=node=>(node?.nodeType===Node.TEXT_NODE?node.parentElement:node)?.closest(blockSelector)||document.body;
  function textScope(nodes){let text='',previous;const segments=[];for(const node of nodes){const block=readingBlock(node);if(text&&block!==previous)text+=' ';segments.push({node,start:text.length,end:text.length+node.textContent.length});text+=node.textContent;previous=block;}return {text,segments};}
  function fragmentText(root){const nodes=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode())if(!node.parentElement?.closest(outside))nodes.push(node);return textScope(nodes).text;}
  function scheduleScan(){if(!scanTimer)scanTimer=setTimeout(scan,120);}
  function cancelClose(){clearTimeout(closeTimer);closeTimer=null;}
  function close(){geometryLocked=false;pendingGeometry=null;clearTimeout(hoverTimer);cancelClose();host?.remove();host=null;frame=null;pinned=false;hovering=false;lastKey='';activeMark=null;}
  function position(height=240,width=430){if(!host||!anchorRect)return;if(geometryLocked){pendingGeometry={height,width};return;}const vw=document.documentElement.clientWidth,vh=innerHeight;const w=Math.min(width,vw-24),h=Math.min(height,vh-24);let x=Math.max(12,Math.min(anchorRect.left,vw-w-12)),y=anchorRect.bottom+8;if(y+h>vh-12||anchorRect.bottom>vh/2&&anchorRect.top>=h+20)y=Math.max(12,anchorRect.top-h-8);host.style.left=x+'px';host.style.top=y+'px';host.style.width=w+'px';host.style.height=h+'px';}
  function open(payload,rect,pin=false){
    if(!enabled)return;
    clearTimeout(hoverTimer);cancelClose();const identity=payload.entry||payload.snippetId?JSON.stringify([payload.entry?.id||payload.snippetId,payload.request.selected,payload.request.before,payload.request.after]):'';if(frame&&identity&&lastKey===identity){if(pin)pinned=true;return;}
    close();pinned=pin;anchorRect=rect;lastKey=identity;nonce=crypto.randomUUID();
    host=document.createElement('div');host.id='context-reader-host';host.style.cssText='position:fixed;z-index:2147483647;display:block;pointer-events:auto;border:0;background:transparent;';
    shadow=host.attachShadow({mode:'closed'});const glass=document.createElement('div');glass.setAttribute('aria-hidden','true');glass.dataset.readerGlass='';glass.style.cssText='position:absolute;inset:10px;border-radius:20px;pointer-events:none;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);';glass.style.backgroundColor='color-mix(in srgb,'+(isDark()?slateDark:slate).slate2+' 35%,transparent)';shadow.append(glass);frame=document.createElement('iframe');frame.title=payload.mode==='selection'?'语境划选操作':'语境解释';frame.src=chrome.runtime.getURL('card.html')+'#'+nonce;frame.style.cssText='position:relative;display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:'+(isDark()?'dark':'light')+';';shadow.append(frame);document.documentElement.append(host);
    host.addEventListener('pointerenter',()=>{hovering=true;cancelClose();});host.addEventListener('pointerleave',()=>{hovering=false;if(!pinned)closeTimer=setTimeout(close,220);});
    frame.addEventListener('load',()=>{frame?.contentWindow.postMessage({type:'cr-init',nonce,payload:{...payload,maxHeight:Math.min(820,innerHeight-28)}},extensionOrigin);});position(payload.mode==='selection'?128:220);
  }
  window.addEventListener('message',event=>{if(!frame||event.source!==frame.contentWindow||event.origin!==extensionOrigin||!event.isTrusted||event.data?.nonce!==nonce)return;const message=event.data;if(message.type==='cr-ready')return;if(message.type==='cr-interaction'){geometryLocked=!!message.active;if(!geometryLocked&&pendingGeometry){const next=pendingGeometry;pendingGeometry=null;position(next.height,next.width);}return;}if(message.type==='cr-size'){frameExpanded=!!message.expanded;position(Math.max(88,Math.min(820,Number(message.height)||240)),frameExpanded?478:430);}if(message.type==='cr-pin'){pinned=true;window.getSelection()?.removeAllRanges();}if(message.type==='cr-background'){pinned=false;window.getSelection()?.removeAllRanges();}if(message.type==='cr-close')close();});
  function selectionPayload(text,range,kind){
    let node=range?.commonAncestorContainer;if(node?.nodeType===Node.TEXT_NODE)node=node.parentElement;const block=readingBlock(node);const original=norm(fragmentText(block)||text);text=range?norm(fragmentText(range.cloneContents())):text;let context=original;
    if(original.length>3000){const i=original.indexOf(norm(text));context=original.slice(Math.max(0,i-500),Math.max(0,i-500)+3000);}
    let before='',after='';if(range){try{const pre=document.createRange();pre.selectNodeContents(block);pre.setEnd(range.startContainer,range.startOffset);before=norm(fragmentText(pre.cloneContents())).slice(-400);const post=document.createRange();post.selectNodeContents(block);post.setStart(range.endContainer,range.endOffset);after=norm(fragmentText(post.cloneContents())).slice(0,400);}catch{}}
    return {kind:kind||((text.length>140||/[.!?]\s+\S/.test(text)||/\s/.test(text)&&/[.!?][\"'’”)]*$/.test(text))?'passage':'term'),selected:norm(text),sentence:original.slice(0,2200),context,before,after,source:{url:safeUrl(location.href),title:document.title}};
  }
  function showSelection(fallback=''){
    if(!enabled)return;
    const selection=window.getSelection();const text=norm(selection?.toString()||fallback);if(!text)return;
    if(text.length>1600){open({mode:'notice',message:'请选择较短的片段，最多 1600 个字符。'},selection?.rangeCount?selection.getRangeAt(0).getBoundingClientRect():{left:24,top:40,bottom:60},true);return;}
    const range=selection?.rangeCount?selection.getRangeAt(0):null;const rect=range?.getBoundingClientRect();const request=selectionPayload(text,range);open({mode:'selection',request},rect&&rect.width?rect:{left:24,top:40,bottom:60},true);
  }
  function clearHighlights(){for(const kind of Object.keys(markTypes))window.CSS?.highlights?.delete('context-reader-'+kind);}
  function scan(){
    clearTimeout(scanTimer);scanTimer=null;if(!enabled)return;
    const locationNow=safeUrl(location.href);if(locationNow!==lastLocation){lastLocation=locationNow;pageTasks=[];passages=[];lastAnchors='';void refresh();}
    marks=[];nodeHits=new WeakMap();if(!entries.length&&!pageTasks.length&&!passages.length){clearHighlights();return;}
    const root=document.body;if(!root)return;if(!style.isConnected)document.documentElement.append(style);
    const blocks=new Map(),allNodes=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){const p=node.parentElement;if(!p||!node.textContent||p.closest(outside)||!p.getClientRects().length||getComputedStyle(p).visibility!=='visible')return NodeFilter.FILTER_REJECT;return NodeFilter.FILTER_ACCEPT;}});
    let node;while((node=walker.nextNode())){allNodes.push(node);const block=readingBlock(node);if(!blocks.has(block))blocks.set(block,[]);blocks.get(block).push(node);}
    const segmentsFor=textScope;
    const add=(match,scope)=>{const {text,segments}=scope,first=segments.find(s=>match.start>=s.start&&match.start<s.end),last=segments.find(s=>match.end>s.start&&match.end<=s.end);if(!first||!last)return null;
      const range=document.createRange();range.setStart(first.node,match.start-first.start);range.setEnd(last.node,match.end-last.start);if(norm(range.toString()).replace(/\s/g,'')!==norm(text.slice(match.start,match.end)).replace(/\s/g,''))return null;
      return {range,...match,surface:range.toString(),hitNodes:segments.slice(segments.indexOf(first),segments.indexOf(last)+1).map(s=>s.node)};};
    const scopes=new Map([...blocks].map(([block,nodes])=>[block,segmentsFor(nodes)]));
    // A selection may span inline nodes or several paragraphs. Consider their
    // reading ancestors, and accept one unique range only. Repeated unchanged
    // paragraphs without enough positional evidence remain unmarked.
    const anchors=[...passages.map(p=>({passage:p,request:p.request})),...pageTasks.map(task=>({task,request:task.request}))];
    if(anchors.length){const parents=new Set(),anchorScopes=new Map(scopes);for(const block of blocks.keys())for(let p=block.parentElement;p;p=p.parentElement){if(p.matches(blockSelector))parents.add(p);if(p===root)break;}
      for(const parent of parents)if(anchors.some(a=>norm(fragmentText(parent)).includes(norm(a.request.context))))anchorScopes.set(parent,segmentsFor(allNodes.filter(n=>parent.contains(n))));
      const locate=request=>{const found=[];for(const scope of anchorScopes.values()){const match=locateOccurrence(scope.text,request);if(!match)continue;const mark=add(match,scope);if(mark&&!found.some(m=>m.range.compareBoundaryPoints(Range.START_TO_START,mark.range)===0&&m.range.compareBoundaryPoints(Range.END_TO_END,mark.range)===0))found.push(mark);}return found.length===1?found[0]:null;};
      for(const anchor of anchors){const match=locate(anchor.request);if(!match)continue;marks.push({...match,...anchor,kind:anchor.task?taskMark(anchor.task.state):'passage'});
        if(anchor.task?.state==='confirm'&&anchor.task.suggested){const expanded=expandSelection(anchor.request,anchor.task.suggested),proposed=expanded&&locate(expanded);if(proposed)marks.push({...proposed,...anchor,kind:'suggestion'});}
      }
    }
    for(const [block,nodes] of blocks){const scope=scopes.get(block);for(const match of matcher(scope.text)){const mark=add(match,scope);if(mark)marks.push({...mark,kind:match.entry.kind==='word'?'known':'phrase'});}}
    // Specific tasks win hit testing, then lexical entries, then broad passages.
    marks.sort((a,b)=>(a.task?2:a.entry?1:0)-(b.task?2:b.entry?1:0)||b.surface.length-a.surface.length);
    for(const mark of marks)for(const n of mark.hitNodes){const list=nodeHits.get(n)||[];list.push({from:n===mark.range.startContainer?mark.range.startOffset:0,to:n===mark.range.endContainer?mark.range.endOffset:n.textContent.length,mark});nodeHits.set(n,list);}
    if(window.CSS?.highlights&&window.Highlight)for(const [kind,type] of Object.entries(markTypes)){const name='context-reader-'+kind;if(visible){const ranges=marks.filter(m=>m.kind===kind||kind==='known'&&m.kind==='phrase').map(m=>m.range),highlight=new Highlight(...ranges);highlight.priority=type.priority;CSS.highlights.set(name,highlight);}else CSS.highlights.delete(name);}
    const found=[...new Set(marks.filter(m=>m.task).map(m=>m.task.id))],signature=JSON.stringify([pageTasks.map(t=>t.id),found]);if(pageTasks.length&&signature!==lastAnchors){lastAnchors=signature;void call('CR_TASK_ANCHORS',{found}).catch(()=>{lastAnchors='';});}
  }
  async function refresh(){if(!enabled)return;const revision=++refreshRevision;try{const [index,tasks,savedPassages]=await Promise.all([call('CR_GET_INDEX'),call('CR_PAGE_TASKS'),call('CR_PAGE_PASSAGES')]);if(!enabled||revision!==refreshRevision)return;entries=index;pageTasks=tasks;passages=savedPassages;matcher=makeMatcher(entries);if(entries.length||pageTasks.length||passages.length)observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-hidden','class','style']});else observer.disconnect();scan();}catch{}}
  const style=document.createElement('style');style.dataset.contextReader='highlights';
  function updateAppearance(){const dark=isDark();
    style.textContent=Object.keys(markTypes).map(kind=>`::highlight(context-reader-${kind}){${markStyle(kind)}}`).join('')+'@media(forced-colors:active){'+Object.keys(markTypes).map(kind=>`::highlight(context-reader-${kind}){background-color:Highlight;color:HighlightText;text-decoration-color:HighlightText;}`).join('')+'}';
    const glass=shadow?.querySelector('[data-reader-glass]');if(glass)glass.style.backgroundColor='color-mix(in srgb,'+(dark?slateDark:slate).slate2+' 35%,transparent)';if(frame)frame.style.colorScheme=dark?'dark':'light';}

  updateAppearance();void call('CR_APPEARANCE').then(value=>{appearancePreference=value;updateAppearance();}).catch(()=>{});
  themeMedia.addEventListener('change',()=>{if(appearancePreference==='system')updateAppearance();});
  function atPoint(x,y){const caret=document.caretPositionFromPoint?.(x,y);const r=caret?{startContainer:caret.offsetNode,startOffset:caret.offset}:document.caretRangeFromPoint?.(x,y);if(!r)return null;for(const hit of [...(nodeHits.get(r.startContainer)||[])].reverse()){if(r.startOffset<hit.from||r.startOffset>hit.to)continue;for(const rect of hit.mark.range.getClientRects())if(x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom)return hit.mark;}return null;}
  document.addEventListener('pointermove',event=>{if(!enabled||!visible||pinned||hovering||event.composedPath().includes(host)||window.getSelection()?.toString().trim())return;const mark=atPoint(event.clientX,event.clientY);if(mark){if(activeMark===mark&&frame){cancelClose();return;}clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>{if(!enabled)return;const request=mark.task?.request||mark.passage?.request||selectionPayload(mark.surface,mark.range,'term');if(mark.entry)request.entryId=mark.entry.id;open({mode:mark.task?'selection':mark.passage?'passage':'known',entry:mark.entry,snippetId:mark.passage?.id,request},mark.range.getBoundingClientRect());activeMark=mark;},260);}else{clearTimeout(hoverTimer);if(host&&!pinned&&!hovering)closeTimer ||= setTimeout(()=>{closeTimer=null;close();},220);}}, {passive:true});
  document.addEventListener('mouseup',event=>{if(!enabled||event.composedPath().includes(host))return;setTimeout(()=>{if(!enabled)return;const sel=window.getSelection();if(sel?.rangeCount&&norm(sel.toString())&&sel.anchorNode?.parentElement&&!sel.anchorNode.parentElement.closest('input,textarea,[contenteditable="true"]'))showSelection();},0);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  document.addEventListener('pointerdown',event=>{if(host&&!event.composedPath().includes(host)&&!window.getSelection()?.toString().trim())close();});
  window.addEventListener('popstate',scheduleScan);
  window.addEventListener('scroll',()=>{if(!pinned)close();if(enabled)scheduleScan();},{passive:true});window.addEventListener('resize',()=>{if(!frame)return;if(!pinned){close();return;}frame.contentWindow.postMessage({type:'cr-viewport',nonce,maxHeight:Math.min(820,innerHeight-28)},extensionOrigin);position(host.clientHeight,frameExpanded?478:430);});
  const observer=new MutationObserver(changes=>{if(!enabled||changes.every(c=>c.target===host||c.target===style||host?.contains(c.target)||(c.type==='childList'&&[...c.addedNodes,...c.removedNodes].length&&[...c.addedNodes,...c.removedNodes].every(n=>n.id==='context-reader-host'||n===style))))return;scheduleScan();});
  function applyEnabled(value){const next=!!value;if(next===enabled)return;enabled=next;refreshRevision++;visible=true;lastAnchors='';
    if(enabled){document.documentElement.append(style);void refresh();}
    else{observer.disconnect();clearTimeout(scanTimer);scanTimer=null;close();marks=[];nodeHits=new WeakMap();entries=[];passages=[];pageTasks=[];matcher=()=>[];clearHighlights();style.remove();}
  }
  const pageState=()=>({enabled,marks:enabled&&visible,count:marks.filter(m=>!m.task).length,pendingCount:marks.filter(m=>m.task).length});
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{if(message.type==='CR_APPEARANCE_CHANGED'){appearancePreference=message.appearance;updateAppearance();respond({ok:true});}if(message.type==='CR_INDEX_CHANGED'){void refresh();respond({ok:true});}if(message.type==='CR_EXPLAIN_SELECTION'){showSelection(message.text);respond({ok:enabled});}if(message.type==='CR_PAGE_STATE')respond(pageState());if(message.type==='CR_READING_CHANGED'){policyRevision++;applyEnabled(message.enabled);respond(pageState());}if(message.type==='CR_TOGGLE_MARKS'){if(enabled){visible=!visible;scan();close();}respond(pageState());}});
  void call('CR_READING_POLICY').then(policy=>{if(!policyRevision)applyEnabled(policy.enabled);if(enabled&&window.getSelection()?.toString().trim())showSelection();}).catch(()=>{});
})();
