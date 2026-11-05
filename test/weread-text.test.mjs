import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWeReadScopes,rectsForWeReadRange,selectionFromWeReadRects,requestForWeReadSelection,locateWeReadRequest} from '../src/content/weread-text.mjs';
import {locateOccurrence,norm} from '../src/shared/core.mjs';

const source={url:'https://weread.qq.com/web/reader/book/chapter?utm_source=test',title:'A real chapter'};
function canvas(lines,{id='page',left=100,top=40,ratio=1,width=2000,height=600}={}){
  const glyphs=[];
  for(let row=0;row<lines.length;row++){
    const line=typeof lines[row]==='string'?{text:lines[row]}:lines[row];let x=line.x??20;
    const baseline=line.baseline??40+row*30;
    for(const text of line.text){const advance=text===' '?6:text===','?4:10;glyphs.push({text,x,y:baseline-10,width:advance,height:20,baseline,font:'20px serif'});x+=advance;}
  }
  return {id,width,height,rect:{left,top,width:width*ratio,height:height*ratio},glyphs};
}
const scopes=(lines,options,paragraphs)=>buildWeReadScopes([canvas(lines,options)],source,paragraphs);
function range(scope,text,from=0){const start=scope.text.indexOf(text,from);assert.ok(start>=0);return {start,end:start+text.length};}
const shifted=(rect,dx=2,dy=-2)=>({left:rect.left+dx,top:rect.top+dy,width:rect.width,height:rect.height+4});

test('bitmap geometry maps to CSS pixels and preserves explicit spaces, ligatures and UTF-16 offsets',()=>{
  const [scope]=scopes(['A  ﬁne 😀 example.','A second line.'],{ratio:.5});
  assert.equal(scope.text,'A  ﬁne 😀 example.\nA second line.');
  const selected=range(scope,'😀'),rects=rectsForWeReadRange(scope,selected.start,selected.end);
  assert.equal(rects.length,1);assert.equal(rects[0].left,scope.glyphs.find(g=>g.text==='😀').x*.5+100);
  assert.equal(rects[0].height,10);
  assert.equal(rectsForWeReadRange(scope,selected.start,selected.end-1).length,0,'never split a surrogate glyph');
  assert.equal(scope.contextStatus,'visible-fragment');assert.equal(scope.partial,true);
});

test('only observed indentation and line gaps split paragraph fragments',()=>{
  const result=scopes([{text:'First paragraph.',x:20},{text:'continues here.',x:20},{text:'Indented paragraph.',x:45},{text:'its second line.',x:20},{text:'Separated line.',x:20,baseline:200}]);
  assert.equal(result.length,3);
  assert.equal(result[0].text,'First paragraph.\ncontinues here.');
  assert.deepEqual(result.map(s=>s.boundaries),[{start:'canvas-start',end:'indent'},{start:'indent',end:'line-gap'},{start:'line-gap',end:'canvas-end'}]);
});

test('scope identity survives scrolling but changes with chapter or visible text',()=>{
  const [a]=scopes(['A saved expression.']),[scrolled]=scopes(['A saved expression.'],{top:-200});
  assert.equal(a.id,scrolled.id);
  assert.notEqual(a.id,scopes(['A changed expression.'])[0].id);
  assert.notEqual(a.id,buildWeReadScopes([canvas(['A saved expression.'])],{...source,url:'https://weread.qq.com/web/reader/next'})[0].id);
});

test('bad geometry and obfuscated runs fail closed rather than deleting a character from a word',()=>{
  const broken=canvas(['A true word.']);broken.glyphs[3].text='\ue001';
  assert.deepEqual(buildWeReadScopes([broken],source),[]);
  broken.glyphs[3].text='x';broken.glyphs[3].x=NaN;
  assert.deepEqual(buildWeReadScopes([broken],source),[]);
  assert.deepEqual(buildWeReadScopes([{...canvas(['test']),rect:{left:0,top:0,width:Infinity,height:1}}],source),[]);
});

test('native +2px translated word rectangles exclude adjacent punctuation by advance width',()=>{
  const [scope]=scopes(['A fortune, appears.']),selected=range(scope,'fortune');
  const box=rectsForWeReadRange(scope,selected.start,selected.end)[0];
  const mapped=selectionFromWeReadRects([scope],[shifted(box)]);
  assert.equal(mapped.scope.text.slice(mapped.start,mapped.end),'fortune');
  assert.equal(requestForWeReadSelection(mapped.scope,mapped).selected,'fortune');
  assert.equal(selectionFromWeReadRects([scope],[{...shifted(box),width:box.width+2.5}]),null,'uncertain endpoint is not rounded to a neighbouring glyph');
});

test('narrow scaled native boxes prefer precise advance widths without selecting ortune comma',()=>{
  // Actual DPR-two fixture measurements at viewport width 390. The broad 1px
  // allowance also fits "ortune," (49.9458px), while "fortune" is 50.8112px.
  const positions=[56,69.0078125,90.5703125,106.95703125,120.765625,143.7734375,167.40625,186.7421875,197.5234375,207.171875];
  const glyphs=[...'fortune, '].map((text,index)=>({text,x:positions[index],y:249.09375,width:positions[index+1]-positions[index],height:40,baseline:272}));
  const [scope]=buildWeReadScopes([{id:'narrow',width:880,height:1140,rect:{left:24,top:92,width:342,height:570},glyphs}],source);
  const selected=selectionFromWeReadRects([scope],[{left:47.75,top:215.5,width:50.796875,height:25}]);
  assert.equal(scope.text.slice(selected.start,selected.end),'fortune');
});

test('a unique broad-width candidate remains usable when no half-pixel candidate exists',()=>{
  const [scope]=scopes(['fortune, appears.']),selected=range(scope,'fortune'),box=rectsForWeReadRange(scope,selected.start,selected.end)[0];
  const mapped=selectionFromWeReadRects([scope],[{...shifted(box),width:box.width+.8}]);
  assert.equal(scope.text.slice(mapped.start,mapped.end),'fortune');
});

test('native mapping uses justified space advances and a common shift across wrapped lines',()=>{
  const page=canvas(['A saved phrase','continues here.']);
  // Drawing the space still measures 6px, but justification advances by 20px.
  const firstSpace=page.glyphs.findIndex(g=>g.text===' ');
  for(let i=firstSpace+1;i<page.glyphs.length&&page.glyphs[i].baseline===40;i++)page.glyphs[i].x+=14;
  const [scope]=buildWeReadScopes([page],source),selected=range(scope,'saved phrase\ncontinues');
  const rects=rectsForWeReadRange(scope,selected.start,selected.end).map(rect=>shifted(rect));
  const mapped=selectionFromWeReadRects([scope],rects);
  assert.equal(norm(mapped.scope.text.slice(mapped.start,mapped.end)),'saved phrase continues');
  assert.equal(selectionFromWeReadRects([scope],[rects[0],{...rects[1],left:rects[1].left+3}]),null,'different line shifts are not silently combined');
});

test('native selection rejects unknown rectangles, skipped text, overlapping canvases and partial drawing runs',()=>{
  const [scope]=scopes(['First middle last.']),first=range(scope,'First'),last=range(scope,'last');
  const rects=[...rectsForWeReadRange(scope,first.start,first.end),...rectsForWeReadRange(scope,last.start,last.end)].map(r=>shifted(r));
  assert.equal(selectionFromWeReadRects([scope],rects),null);
  assert.equal(selectionFromWeReadRects([scope],[rects[0],{left:0,top:0,width:40,height:20}]),null);
  assert.equal(selectionFromWeReadRects([scope,{...scope,id:'duplicate'}],[rects[0]]),null);
  const run=canvas([]);run.glyphs=[{text:'fortune',x:20,y:30,width:70,height:20,baseline:40}];
  const [runScope]=buildWeReadScopes([run],source);
  assert.equal(selectionFromWeReadRects([runScope],[{left:122,top:68,width:30,height:24}]),null);
});

test('native mapping rejects an ambiguous narrow letter instead of guessing its occurrence',()=>{
  const page=canvas([]);page.glyphs=[0,1,2].map(i=>({text:'i',x:20+i*2,y:30,width:2,height:20,baseline:40}));
  const [scope]=buildWeReadScopes([page],source);
  assert.equal(selectionFromWeReadRects([scope],[{left:122,top:68,width:2,height:24}]),null);
});

test('selection across adjacent paragraph scopes retains global surroundings and exact offsets',()=>{
  const result=scopes([{text:'First paragraph begins.',x:20},{text:'Second paragraph continues.',x:45},{text:'Third finishes.',x:20,baseline:200}]);
  const first=range(result[0],'begins.'),last=range(result[1],'Second');
  const mapped=selectionFromWeReadRects(result,[...rectsForWeReadRange(result[0],first.start,first.end),...rectsForWeReadRange(result[1],last.start,last.end)].map(r=>shifted(r)));
  assert.equal(norm(mapped.scope.text.slice(mapped.start,mapped.end)),'begins. Second');
  const request=requestForWeReadSelection(mapped.scope,mapped);
  assert.deepEqual(locateOccurrence(mapped.scope.text,request),{start:mapped.start,end:mapped.end});
  assert.equal(request.after,'paragraph continues. Third finishes.');
});

test('full authoritative paragraph supplies sentence and surrounding text across page fragments',()=>{
  const paragraph='Mr. Bennet read the first note. He kept the bank near the river bank in view. Mrs. Bennet agreed.';
  const [scope]=scopes(['the bank near the river bank in view.'],undefined,[{offset:300,text:paragraph}]);
  assert.equal(scope.contextStatus,'captured-paragraph');
  const chosen=range(scope,'bank',scope.text.indexOf('bank')+1),request=requestForWeReadSelection(scope,chosen);
  assert.equal(request.context,paragraph);assert.equal(request.sentence,'He kept the bank near the river bank in view.');
  assert.equal(request.before,'Mr. Bennet read the first note. He kept the bank near the river');
  assert.equal(request.after,'in view. Mrs. Bennet agreed.');
  assert.equal(request.source.url,'https://weread.qq.com/web/reader/book/chapter');
  const located=locateWeReadRequest([scope],request);assert.equal(located.start,chosen.start);assert.equal(located.end,chosen.end);
  assert.equal(locateOccurrence(scope.text,request),null,'full paragraph history must not be guessed from fragment-only anchors');
  const [later]=scopes(['He kept the bank near the river bank in view.'],{id:'later'},[{offset:300,text:paragraph}]);
  const restored=locateWeReadRequest([later],request);assert.equal(later.text.slice(restored.start,restored.end),'bank');assert.equal(restored.start,later.text.lastIndexOf('bank'));
});

test('repeated paragraph alignments are uncertain, and duplicate visible anchors remain ambiguous',()=>{
  const paragraph='A true word is repeated.';
  const [uncertain]=scopes(['true word'],undefined,[{offset:0,text:paragraph},{offset:100,text:paragraph}]);
  assert.equal(uncertain.fullContext,undefined);
  const [scope]=scopes(['true word'],undefined,[{offset:0,text:paragraph}]);
  const selected=range(scope,'word'),request=requestForWeReadSelection(scope,selected);
  assert.equal(locateWeReadRequest([scope,{...scope,id:'duplicate'}],request),null);
  assert.equal(locateWeReadRequest([scope],{...request,source:{url:'https://weread.qq.com/web/reader/other'}}),null);
});

test('full-paragraph sentence segmentation retains English titles and does not invent unseen text',()=>{
  const paragraph='Mrs. Bennet listened. Mr. Bennet answered the question. Then he left.';
  const [scope]=scopes(['Mr. Bennet answered the question.'],undefined,[{offset:0,text:paragraph}]);
  assert.equal(requestForWeReadSelection(scope,range(scope,'Bennet')).sentence,'Mr. Bennet answered the question.');
  const [fragment]=scopes(['only the captured fragment']);const request=requestForWeReadSelection(fragment,range(fragment,'captured'));
  assert.equal(request.context,'only the captured fragment');assert.equal(fragment.fullContext,undefined);
});

test('long full contexts retain bounded surroundings and repeated-word anchor identity',()=>{
  const prefix='A long known context. '.repeat(150),suffix='A second known context. '.repeat(150),paragraph=prefix+'target phrase'+suffix;
  const [scope]=scopes(['target phrase'],undefined,[{offset:0,text:paragraph}]);
  const chosen=range(scope,'target phrase'),request=requestForWeReadSelection(scope,chosen);
  assert.ok(request.context.length<=3200);assert.ok(request.sentence.length<=2200);assert.equal(request.before.length,400);assert.equal(request.after.length,400);
  assert.ok(locateOccurrence(paragraph,request));assert.equal(locateWeReadRequest([scope],request).start,0);
});

test('full paragraph multi-line text aligns using deterministic newline whitespace only',()=>{
  const paragraph='A phrase crosses a wrapped line without an invented word.';
  const [scope]=scopes(['A phrase crosses a','wrapped line without an invented word.'],undefined,[{offset:0,text:paragraph}]);
  const selected=range(scope,'a\nwrapped line'),request=requestForWeReadSelection(scope,selected);
  assert.equal(request.selected,'a wrapped line');assert.equal(request.context,paragraph);
  assert.equal(locateWeReadRequest([scope],request).start,selected.start);
});

test('full context multi-paragraph selections restore without inserting unseen words in the page',()=>{
  const paragraphs=[{offset:0,text:'Earlier unseen sentence. First paragraph ends.'},{offset:100,text:'Second paragraph starts. A following sentence.'},{offset:200,text:'Third paragraph.'}];
  const result=scopes([{text:'First paragraph ends.',x:20},{text:'Second paragraph starts.',x:45},{text:'Third paragraph.',x:20,baseline:200}],undefined,paragraphs);
  const first=range(result[0],'ends.'),last=range(result[1],'Second');
  const selected=selectionFromWeReadRects(result,[...rectsForWeReadRange(result[0],first.start,first.end),...rectsForWeReadRange(result[1],last.start,last.end)].map(r=>shifted(r)));
  const request=requestForWeReadSelection(selected.scope,selected);
  assert.equal(request.before,'Earlier unseen sentence. First paragraph');
  assert.equal(request.after,'paragraph starts. A following sentence.');
  assert.equal(request.context,paragraphs[0].text+' '+paragraphs[1].text);
  const restored=locateWeReadRequest(result,request);
  assert.equal(norm(restored.scope.text.slice(restored.start,restored.end)),'ends. Second');
  assert.equal(restored.scope.text.includes('unseen'),false);
  assert.equal(locateWeReadRequest(result,{...request,source:{url:'https://weread.qq.com/web/reader/other'}}),null);
});

test('authoritative dialogue paragraphs split even when every baseline gap equals the median',()=>{
  const paragraphs=[{offset:0,text:'"A first answer."'},{offset:50,text:'"A second reply."'},{offset:100,text:'"A third question?"'}];
  const result=scopes(paragraphs.map((paragraph,index)=>({text:paragraph.text,x:20,baseline:40+index*35})),undefined,paragraphs);
  assert.equal(result.length,3);
  assert.deepEqual(result.map(s=>s.text),paragraphs.map(p=>p.text));
  assert.deepEqual(result.map(s=>s.fullContext.offset),[0,50,100]);
  assert.deepEqual(result.map(s=>s.contextStatus),['captured-paragraph','captured-paragraph','captured-paragraph']);
  assert.equal(result[0].boundaries.end,'source-paragraph');
  assert.equal(result[1].boundaries.start,'source-paragraph');
});

test('unique authoritative paragraph continuity overrides a centered line indentation',()=>{
  const paragraphs=[{offset:0,text:'A normal line continues with centered emphasis.'},{offset:100,text:'A separate paragraph.'}];
  const result=scopes([{text:'A normal line continues',x:20},{text:'with centered emphasis.',x:80},{text:'A separate paragraph.',x:20}],undefined,paragraphs);
  assert.equal(result.length,2);
  assert.equal(result[0].text,'A normal line continues\nwith centered emphasis.');
  assert.equal(result[0].fullContext.text,paragraphs[0].text);
  assert.equal(result[1].fullContext.offset,100);
});

test('ambiguous repeated source lines do not claim paragraph boundaries or full context',()=>{
  const result=scopes([{text:'"Yes."',baseline:40},{text:'"Yes."',baseline:75}],undefined,[{offset:0,text:'"Yes."'},{offset:100,text:'"Yes."'}]);
  assert.equal(result.length,1);
  assert.equal(result[0].text,'"Yes."\n"Yes."');
  assert.equal(result[0].contextStatus,'visible-fragment');
  assert.equal(result[0].fullContext,undefined);
});
