import {norm, safeUrl, locateOccurrence} from '../shared/core.mjs';

// All coordinates entering this module are canvas bitmap coordinates. Returned
// rectangles use viewport CSS pixels, like WeRead's native .wr_selection boxes.
const LIMIT = 16000;
const finite = Number.isFinite;
const median = values => { const sorted = [...values].sort((a,b)=>a-b); return sorted[Math.floor(sorted.length/2)] || 0; };
const unsupportedText = text => /[\p{Co}\u0000-\u0008\u000e-\u001f\u007f]/u.test(text);
function rectangle(value) {
  if (!value) return null;
  const left=value.left??value.x, top=value.top??value.y;
  const width=value.width??value.right-left, height=value.height??value.bottom-top;
  if (![left,top,width,height].every(finite)||width<0||height<0) return null;
  return {left,top,width,height,right:left+width,bottom:top+height,x:left,y:top};
}
function union(rects) {
  if (!rects.length) return null;
  const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top));
  return rectangle({left,top,width:Math.max(...rects.map(r=>r.right))-left,height:Math.max(...rects.map(r=>r.bottom))-top});
}
function fingerprint(text) {
  let a=2166136261,b=5381;
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
  return (a>>>0).toString(36)+(b>>>0).toString(36);
}
function sourceOf(source={}) { return {url:safeUrl(source.url),title:norm(source.title).slice(0,240)}; }
function normalizeMap(text) {
  if(text.normalize('NFC')!==text)return null;
  const chars=[],starts=[],ends=[];
  for(let i=0;i<text.length;i++){
    if(/\s/u.test(text[i])){if(!chars.length)continue;if(chars.at(-1)===' '){ends[ends.length-1]=i+1;continue;}chars.push(' ');}
    else chars.push(text[i]);
    starts.push(i);ends.push(i+1);
  }
  if(chars.at(-1)===' '){chars.pop();starts.pop();ends.pop();}
  return {text:chars.join(''),starts,ends};
}
function paragraphSources(paragraphs) {
  if(!Array.isArray(paragraphs))return [];
  let size=0;
  return paragraphs.slice(0,2000).flatMap((p,index)=>{
    if(!p||typeof p.text!=='string'||unsupportedText(p.text)||p.text.length>100000||(size+=p.text.length)>500000)return [];
    const text=norm(p.text);return text?[{offset:p.offset??index,text,index}]:[];
  });
}
function attachParagraph(scope,paragraphs) {
  const visible=normalizeMap(scope.text);if(!visible?.text)return;
  const matches=[];
  for(const paragraph of paragraphs){let at=-1;while((at=paragraph.text.indexOf(visible.text,at+1))>=0){matches.push({paragraph,at});if(matches.length>1)return;}}
  if(matches.length!==1)return;
  const {paragraph,at}=matches[0];
  scope.fullContext={text:paragraph.text,offset:paragraph.offset,index:paragraph.index,start:at,end:at+visible.text.length};
  scope.paragraphSources=paragraphs;scope.contextStatus='captured-paragraph';
}
function paragraphForLine(line,paragraphs) {
  const text=norm(line.glyphs.map(g=>g.text).join(''));if(!text)return null;
  let found=null;
  for(const paragraph of paragraphs)if(paragraph.text.includes(text)){if(found)return null;found=paragraph;}
  return found;
}

/** Build geometry-bounded paragraph fragments; no absent words or spaces are inferred. */
export function buildWeReadScopes(canvases, source={}, paragraphs=source.paragraphs) {
  if (!Array.isArray(canvases)) return [];
  const scopes=[],cleanSource=sourceOf(source),authoritative=paragraphSources(paragraphs);
  const ordered=canvases.slice(0,16).map((canvas,index)=>({canvas,index,rect:rectangle(canvas?.rect)}))
    .filter(item=>item.rect&&item.rect.width>0&&item.rect.height>0)
    .sort((a,b)=>Math.abs(a.rect.left-b.rect.left)>4?a.rect.left-b.rect.left:a.rect.top-b.rect.top||a.index-b.index);
  for(const {canvas,index,rect} of ordered){
    if (![canvas.width,canvas.height].every(n=>finite(n)&&n>0)||!Array.isArray(canvas.glyphs)||canvas.glyphs.length>LIMIT) continue;
    const rx=rect.width/canvas.width,ry=rect.height/canvas.height,glyphs=[];
    let invalid=false;
    for(const raw of canvas.glyphs){
      if(!raw||typeof raw.text!=='string'||!raw.text.length||raw.text.length>1600||unsupportedText(raw.text)||
        ![raw.x,raw.y,raw.width,raw.height,raw.baseline].every(finite)||raw.width<0||raw.height<=0){invalid=true;break;}
      if(raw.x+raw.width<=0||raw.y+raw.height<=0||raw.x>=canvas.width||raw.y>=canvas.height) continue;
      const glyphRect=rectangle({left:rect.left+raw.x*rx,top:rect.top+raw.y*ry,width:raw.width*rx,height:raw.height*ry});
      glyphs.push({...raw,rect:glyphRect,cssBaseline:rect.top+raw.baseline*ry,
        clipped:raw.x<-.5||raw.y<-.5||raw.x+raw.width>canvas.width+.5||raw.y+raw.height>canvas.height+.5});
    }
    // A partially decoded canvas would silently join the words around a bad run.
    if(invalid||!glyphs.length) continue;
    glyphs.sort((a,b)=>a.cssBaseline-b.cssBaseline||a.rect.left-b.rect.left);
    const lines=[];
    for(const glyph of glyphs){
      const last=lines.at(-1),tolerance=Math.max(.5,Math.min(2,glyph.rect.height*.1));
      if(!last||Math.abs(last.baseline-glyph.cssBaseline)>tolerance)lines.push({baseline:glyph.cssBaseline,glyphs:[glyph]});
      else last.glyphs.push(glyph);
    }
    for(const line of lines){line.glyphs.sort((a,b)=>a.rect.left-b.rect.left);line.rect=union(line.glyphs.map(g=>g.rect));line.left=line.glyphs.find(g=>/\S/u.test(g.text))?.rect.left??line.rect.left;line.sourceParagraph=paragraphForLine(line,authoritative);}
    const gaps=lines.slice(1).map((line,i)=>line.baseline-lines[i].baseline).filter(n=>n>0);
    const normalGap=median(gaps),normalLeft=Math.min(...lines.map(line=>line.left));
    let paragraph=[],paragraphIndex=0,boundary='canvas-start';
    const flush=endBoundary=>{
      if(!paragraph.length)return;
      let text='';const mapped=[],mappedLines=[];
      for(const line of paragraph){
        // Newlines represent observed line changes. They are not reconstructed
        // paragraph punctuation or an inferred missing word-space.
        if(text)text+='\n';const start=text.length,lineGlyphs=[];
        for(const glyph of line.glyphs){const mappedGlyph={...glyph,start:text.length,end:text.length+glyph.text.length};mapped.push(mappedGlyph);lineGlyphs.push(mappedGlyph);text+=glyph.text;}
        mappedLines.push({...line,start,end:text.length,glyphs:lineGlyphs});
      }
      const canvasId=String(canvas.id??index),id='weread-'+fingerprint(JSON.stringify([cleanSource.url,canvasId,paragraphIndex++,text]));
      const scope={id,canvasId,text,glyphs:mapped,lines:mappedLines,rect:union(mapped.map(g=>g.rect)),source:cleanSource,
        partial:true,boundaries:{start:boundary,end:endBoundary},contextStatus:'visible-fragment'};
      attachParagraph(scope,authoritative);scopes.push(scope);
      paragraph=[];boundary=endBoundary;
    };
    for(const line of lines){
      const previous=paragraph.at(-1),em=median(line.glyphs.map(g=>g.rect.height));
      const gap=previous&&line.baseline-previous.baseline;
      const indented=previous&&line.left-normalLeft>em*.75&&Math.abs(previous.left-line.left)>em*.5;
      const knownParagraph=paragraph.find(part=>part.sourceParagraph)?.sourceParagraph;
      const sourceChange=knownParagraph&&line.sourceParagraph&&knownParagraph!==line.sourceParagraph;
      const sourceContinuation=knownParagraph&&knownParagraph===line.sourceParagraph;
      if(sourceChange)flush('source-paragraph');
      else if(previous&&!sourceContinuation&&(normalGap&&gap>normalGap*1.45||gap>em*2||indented))flush(indented?'indent':'line-gap');
      paragraph.push(line);
    }
    flush('canvas-end');
  }
  return scopes;
}

function validRange(scope, start, end) {
  return !!scope&&typeof scope.text==='string'&&Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>start&&end<=scope.text.length;
}

/** Exact per-line rectangles; a partial multi-character drawing run is unknown. */
export function rectsForWeReadRange(scope, start, end) {
  if(!validRange(scope,start,end))return [];
  const glyphs=scope.glyphs.filter(g=>g.start<end&&g.end>start);
  if(glyphs.some(g=>g.clipped||g.start<start||g.end>end))return [];
  return scope.lines.map(line=>union(glyphs.filter(g=>line.glyphs.includes(g)).map(g=>g.rect))).filter(Boolean);
}

function compositeScope(scopes) {
  let text='';const glyphs=[],lines=[],parts=[];
  for(const scope of scopes){
    if(text)text+='\n\n';const offset=text.length;text+=scope.text;
    const mapped=scope.glyphs.map(g=>({...g,start:g.start+offset,end:g.end+offset}));
    const map=new Map(scope.glyphs.map((g,i)=>[g,mapped[i]]));glyphs.push(...mapped);
    lines.push(...scope.lines.map(line=>({...line,start:line.start+offset,end:line.end+offset,glyphs:line.glyphs.map(g=>map.get(g))})));
    parts.push({id:scope.id,start:offset,end:text.length,scope});
  }
  return {id:'weread-'+fingerprint(scopes.map(s=>s.id).join('|')),text,glyphs,lines,parts,source:scopes[0].source,
    rect:union(scopes.map(s=>s.rect)),partial:true,contextStatus:'visible-fragment'};
}

// Native boxes use advance widths but can be translated a few CSS pixels from
// the actual canvas run. Centre overlap alone can accidentally select a comma.
function candidatesForRect(scopes,rect) {
  const candidates=[];
  for(let scopeIndex=0;scopeIndex<scopes.length;scopeIndex++)for(const line of scopes[scopeIndex].lines){
    const cy=(line.rect.top+line.rect.bottom)/2;if(cy<rect.top-1||cy>rect.bottom+1)continue;
    const glyphs=line.glyphs;
    for(let first=0;first<glyphs.length;first++){
      const startGlyph=glyphs[first],dx=rect.left-startGlyph.rect.left;
      if(Math.abs(dx)>4||startGlyph.clipped)continue;
      for(let last=first;last<glyphs.length;last++){
        const endGlyph=glyphs[last],next=glyphs[last+1];
        const right=next?next.rect.left:endGlyph.rect.right,width=right-startGlyph.rect.left;
        if(width>rect.width+1)break;
        if(Math.abs(width-rect.width)>1||endGlyph.clipped)continue;
        const selected=glyphs.slice(first,last+1);
        if(selected.some(g=>g.clipped))continue;
        candidates.push({scopeIndex,start:startGlyph.start,end:endGlyph.end,glyphs:selected,dx,widthError:Math.abs(width-rect.width)});
        if(candidates.length>64)return [];
      }
    }
  }
  // Native DOM widths are quantized to CSS pixels independently of the canvas
  // scale. Prefer the half-pixel precision tier when available; at narrow widths
  // a shifted neighbouring substring can otherwise fit the broad 1px allowance.
  // Multiple precise candidates remain ambiguous, never a lexical best guess.
  const precise=candidates.filter(candidate=>candidate.widthError<=.5);
  return precise.length?precise:candidates;
}

/** Native selection rectangles must identify one uninterrupted glyph sequence. */
export function selectionFromWeReadRects(scopes, selectionRects) {
  if(!Array.isArray(scopes)||!scopes.length||!Array.isArray(selectionRects)||!selectionRects.length||selectionRects.length>200)return null;
  const rects=selectionRects.map(rectangle);if(rects.some(r=>!r||!r.width||!r.height))return null;
  const lists=rects.map(r=>candidatesForRect(scopes,r));if(lists.some(list=>!list.length))return null;
  // A common translation across lines can disambiguate a narrow letter. Keep
  // every consistent solution, then require one exact set of character ranges.
  const solutions=new Map();let visits=0,exhausted=false;
  const walk=(index,chosen,minDx,maxDx)=>{
    if(++visits>4096){exhausted=true;return;}
    if(solutions.size>1)return;
    if(index===lists.length){const sorted=[...chosen].sort((a,b)=>a.scopeIndex-b.scopeIndex||a.start-b.start),key=sorted.map(c=>[c.scopeIndex,c.start,c.end].join(':')).join('|');solutions.set(key,sorted);return;}
    for(const candidate of lists[index]){const lo=Math.min(minDx,candidate.dx),hi=Math.max(maxDx,candidate.dx);if(hi-lo<=1)walk(index+1,[...chosen,candidate],lo,hi);}
  };
  walk(0,[],Infinity,-Infinity);if(exhausted||solutions.size!==1)return null;
  const chosen=[...solutions.values()][0],hits=chosen.flatMap(c=>c.glyphs.map(glyph=>({scopeIndex:c.scopeIndex,glyph})));
  const first=hits[0],last=hits.at(-1),involved=scopes.slice(first.scopeIndex,last.scopeIndex+1);
  if(involved.some(s=>s.source?.url!==involved[0].source?.url))return null;
  const selected=new Set(hits.map(hit=>hit.glyph));
  for(let i=first.scopeIndex;i<=last.scopeIndex;i++)for(const g of scopes[i].glyphs){
    if(i===first.scopeIndex&&g.end<=first.glyph.start||i===last.scopeIndex&&g.start>=last.glyph.end)continue;
    if(/\S/u.test(g.text)&&!selected.has(g))return null;
  }
  if(first.scopeIndex===last.scopeIndex)return {scope:scopes[first.scopeIndex],start:first.glyph.start,end:last.glyph.end};
  const scope=compositeScope(scopes),start=scope.parts[first.scopeIndex].start+first.glyph.start,end=scope.parts[last.scopeIndex].start+last.glyph.end;
  return {scope,start,end};
}

function mappedContext(scope,start,end) {
  if(scope.fullContext){
    const map=normalizeMap(scope.text);if(!map)return null;
    const prefix=scope.text.slice(0,start),at=norm(prefix).length+(/\s$/u.test(prefix)&&norm(prefix)?1:0);
    return {text:scope.fullContext.text,start:scope.fullContext.start+at,end:scope.fullContext.start+at+norm(scope.text.slice(start,end)).length};
  }
  if(!scope.parts)return null;
  const first=scope.parts.find(p=>p.start<=start&&p.end>start),last=scope.parts.find(p=>p.start<end&&p.end>=end);
  if(!first?.scope.fullContext||!last?.scope.fullContext)return null;
  const sources=first.scope.paragraphSources;if(!sources||sources!==last.scope.paragraphSources)return null;
  const firstContext=mappedContext(first.scope,start-first.start,Math.min(first.end,end)-first.start),lastContext=mappedContext(last.scope,Math.max(last.start,start)-last.start,end-last.start);
  const firstIndex=sources.findIndex(p=>p.index===first.scope.fullContext.index),lastIndex=sources.findIndex(p=>p.index===last.scope.fullContext.index);
  if(firstIndex<0||lastIndex<firstIndex)return null;
  const selectedSources=sources.slice(firstIndex,lastIndex+1),text=selectedSources.map(p=>p.text).join(' ');
  const offset=selectedSources.slice(0,-1).reduce((sum,p)=>sum+p.text.length+1,0);
  const mapped={text,start:firstContext.start,end:offset+lastContext.end};
  return norm(text.slice(mapped.start,mapped.end))===norm(scope.text.slice(start,end))?mapped:null;
}

/** Project a saved full-paragraph occurrence back onto its captured page fragment. */
export function locateWeReadRequest(scopes,request) {
  if(!Array.isArray(scopes)||!request)return null;
  if(request.source?.url&&scopes.some(scope=>scope.source.url!==safeUrl(request.source.url)))return null;
  const found=[];
  for(const scope of scopes){
    if(request.source?.url&&safeUrl(request.source.url)!==scope.source.url)continue;
    if(!scope.fullContext){const match=locateOccurrence(scope.text,request);if(match&&rectsForWeReadRange(scope,match.start,match.end).length)found.push({scope,...match});continue;}
    const match=locateOccurrence(scope.fullContext.text,request),map=normalizeMap(scope.text);
    if(!match||!map||match.start<scope.fullContext.start||match.end>scope.fullContext.end)continue;
    const start=map.starts[match.start-scope.fullContext.start],end=map.ends[match.end-scope.fullContext.start-1];
    if(rectsForWeReadRange(scope,start,end).length)found.push({scope,start,end});
  }
  if(found.length===1)return found[0];
  if(found.length||scopes.length<2)return null;
  const scope=compositeScope(scopes),map=normalizeMap(scope.text),needle=norm(request.selected);
  if(!map||!needle)return null;
  const candidates=[];let at=-1;
  while((at=map.text.toLowerCase().indexOf(needle.toLowerCase(),at+1))>=0){
    const start=map.starts[at],end=map.ends[at+needle.length-1],candidate=requestForWeReadSelection(scope,{start,end});
    if(candidate&&candidate.before===norm(request.before)&&candidate.after===norm(request.after)&&
      (mappedContext(scope,start,end)?.text||norm(scope.text)).includes(norm(request.context)))candidates.push({scope,start,end});
    if(candidates.length>1)return null;
  }
  return candidates.length===1?candidates[0]:null;
}

const abbreviation=/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z]|\be\.g|\bi\.e)\.\s*$/iu;
function sentenceWindow(text,start,end) {
  const segments=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(text)],merged=[];
  for(const segment of segments){const prior=merged.at(-1);if(prior&&abbreviation.test(prior.segment))prior.segment+=segment.segment;else merged.push({...segment});}
  const first=merged.find(segment=>segment.index+segment.segment.length>start),last=[...merged].reverse().find(segment=>segment.index<end);
  return first&&last?{start:first.index,end:last.index+last.segment.length}:{start:0,end:text.length};
}
function boundedWindow(text,start,end,limit) {
  if(text.length<=limit)return norm(text);
  const remaining=limit-(end-start),left=Math.min(start,Math.floor(remaining/2)),right=Math.min(text.length-end,remaining-left);
  const from=Math.max(0,start-(remaining-right));
  return norm(text.slice(from,Math.min(text.length,end+right)));
}

/** Build a normal existing-task request from captured text, never from inferred text. */
export function requestForWeReadSelection(scope, range, source=scope?.source) {
  let {start,end}=range||{};if(!validRange(scope,start,end))return null;
  while(start<end&&/\s/u.test(scope.text[start]))start++;while(end>start&&/\s/u.test(scope.text[end-1]))end--;
  if(start===end||!rectsForWeReadRange(scope,start,end).length)return null;
  const selected=norm(scope.text.slice(start,end));if(!selected||selected.length>1600)return null;
  const full=mappedContext(scope,start,end),text=full?.text||norm(scope.text),prefix=scope.text.slice(0,start);
  const at=full?.start??norm(prefix).length+(/\s$/u.test(prefix)&&norm(prefix)?1:0),finish=full?.end??at+selected.length;
  if(norm(text.slice(at,finish))!==selected)return null;
  const before=norm(text.slice(0,at)).slice(-400),after=norm(text.slice(finish)).slice(0,400);
  const sentence=sentenceWindow(text,at,finish);
  return {kind:selected.length>140||/[.!?]\s+\S/u.test(selected)||/\s/u.test(selected)&&/[.!?]["'’”)]*$/u.test(selected)?'passage':'term',
    selected,sentence:boundedWindow(text.slice(sentence.start,sentence.end),at-sentence.start,finish-sentence.start,2200),
    context:boundedWindow(text,at,finish,3200),before,after,source:sourceOf(source)};
}
