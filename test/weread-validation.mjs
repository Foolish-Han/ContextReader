// Opt-in feasibility spike. The helper is injected only into an isolated test
// profile; neither it nor the live WeRead request belongs to the extension/CI.
// npm run build && npm run test:weread [-- --live]
import {chromium} from 'playwright';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {extensionId} from '../src/shared/extension-id.mjs';
import {installWeReadPrototype} from './helpers/weread-prototype.mjs';

const live=process.argv.includes('--live');
const out=resolve('test-results/weread-'+(live?'live-':'fixture-')+Date.now());
const extension=join(out,'extension');
await mkdir(out,{recursive:true});await cp('dist',extension,{recursive:true});
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
const origin='chrome-extension://'+extensionId(manifest.key);
const report={prototypeOnly:true,realWeRead:live,realLlm:false,personalProfile:false,checks:[],screenshots:[],errors:[],limitations:[
 'Experimental helper is not included in the shipped extension.',
 'The transparent layer replaces WeRead text-selection gestures over captured text.',
 'Context is limited to captured visible canvas text, not a verified whole paragraph.',
 'Validation covers readable 2D fillText rendering, not image/PDF/WebGL or obfuscated glyphs.'
]};
const pass=name=>{report.checks.push(name);console.log('PASS '+name);};
let calls=0;
let learningResponded;
const learningResponse=new Promise(resolve=>{learningResponded=resolve;});
const submitted=[];
const fixture=`<!doctype html><meta charset="utf-8"><title>WeRead synthetic canvas reader</title>
<style>body{margin:0;background:#202020;color:#eee;font:16px system-ui}header{padding:20px}main{display:flex;gap:40px;padding:20px 80px}canvas{width:440px;height:570px;background:#181818}button{font:inherit;margin:20px}</style>
<header>Synthetic reader: selectable canvas text</header><main><canvas width="880" height="1140"></canvas><canvas width="880" height="1140"></canvas></main><button id="next">Next page</button>
<script>
window.nativeSelections=0;document.addEventListener('mousedown',()=>window.nativeSelections++);document.addEventListener('selectstart',event=>event.preventDefault());
let next=false;
function paint(){document.querySelectorAll('canvas').forEach((c,index)=>{const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.setTransform(2,0,0,2,0,0);ctx.font='20px Georgia';ctx.textBaseline='middle';ctx.fillStyle='#eee';
 const lines=next?['A different page with no saved expression.']:index?['A second fortune appears here.','The word art must not match partial.']:['It is a truth universally acknowledged,','that a single man in possession of a good','fortune, must be in want of a wife.','A domain-agnostic reader can follow','a phrase across wrapped lines.'];
 lines.forEach((line,row)=>{let x=28;for(const glyph of line){ctx.fillText(glyph,x,60+row*38);x+=ctx.measureText(glyph).width;}});});}
requestAnimationFrame(paint);document.querySelector('#next').onclick=()=>{next=!next;paint();};
</script>`;
const server=http.createServer(async(req,res)=>{
 if(req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(fixture);return;}
 let body='';for await(const part of req)body+=part;
 try{
  const input=JSON.parse(body),learning=input.text?.format?.type==='json_object';
  const payload=JSON.parse(input.input.slice(input.input.indexOf('{')));calls++;
  if(!learning)submitted.push(payload);
  const selected=payload.selected||'fortune';
  const data=learning?{usage:'仅用于验证的学习资料',memory:'合成记忆',etymology:'',etymologySource:'',examples:[{english:'A small fortune.',chinese:'一笔财富。'},{english:'Good fortune.',chinese:'好运。'}]}:{kind:payload.kind,expression:{canonical:selected,surface:selected,kind:'word',ipaUK:'',ipaUS:'',partOfSpeech:'名词',baseMeanings:['合成测试释义'],meaning:'合成测试语境义',note:'本地模拟响应，不代表真实模型质量。'},meaning:'用于验证划词流程的合成解释。',explanation:'这是本地测试服务的响应。',uncertainty:'',candidates:[]};
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(data)})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:1,output_tokens:1}}})+'\n\n');
  if(learning)learningResponded();
 }catch(error){res.writeHead(500);res.end(error.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const site='http://127.0.0.1:'+server.address().port;
let context,page,library;
const rpc=(type,payload={})=>library.evaluate(async({type,payload})=>{const result=await chrome.runtime.sendMessage({type,payload});if(!result?.ok)throw new Error(result?.error||'No extension response');return result.data;},{type,payload});
const marked=()=>[...CSS.highlights.get('context-reader-known')||[]].filter(r=>r.startContainer.parentElement.closest('#context-reader-weread-prototype')).map(r=>({text:r.toString(),rect:r.getBoundingClientRect().toJSON()}));
async function closeCard(){const frame=page.frames().find(f=>f.url().startsWith(origin+'/card.html'));if(frame&&await frame.locator('#close').count())await frame.locator('#close').click();await page.mouse.move(1,1);await page.evaluate(()=>getSelection().removeAllRanges());await page.locator('#context-reader-host').waitFor({state:'detached'});}
async function card(){await page.locator('#context-reader-host').waitFor();await page.waitForFunction(origin=>[...document.querySelectorAll('#context-reader-host')].length>0,origin);for(let attempt=0;attempt<100;attempt++){const frame=page.frames().find(f=>f.url().startsWith(origin+'/card.html'));if(frame&&await frame.locator('#close').count()){await frame.locator('.loading-text').waitFor({state:'detached'});await frame.evaluate(()=>document.fonts.ready);await page.locator('#context-reader-host').evaluate(async host=>{let last='',stable=0;for(let n=0;n<120;n++){await new Promise(requestAnimationFrame);const r=host.getBoundingClientRect(),next=[r.x,r.y,r.width,r.height].join(',');stable=next===last?stable+1:0;last=next;if(stable===6)return;}throw new Error('Card geometry did not settle');});return frame;}await page.waitForTimeout(30);}throw new Error('Card iframe did not load');}
async function wordRange(word){return page.evaluate(word=>{for(const scope of document.querySelectorAll('[data-cr-weread-scope]')){const nodes=[],walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);let node,text='';while(node=walker.nextNode()){nodes.push({node,at:text.length});text+=node.textContent;}const at=text.indexOf(word);if(at<0)continue;const first=nodes.findLast(n=>n.at<=at),last=nodes.findLast(n=>n.at<at+word.length),r=document.createRange();r.setStart(first.node,at-first.at);r.setEnd(last.node,at+word.length-last.at);const rects=[...r.getClientRects()].filter(r=>r.width&&r.height);if(!rects.length)continue;return {text:r.toString(),first:rects[0].toJSON(),last:rects.at(-1).toJSON(),scope:text};}return null;},word);}
async function snapshot(name){const path=join(out,name+'.png');await page.screenshot({path});report.screenshots.push(path);}
async function assertFixtureAlignment(){
 const actual=await wordRange('fortune');
 const expected=await page.locator('canvas').first().evaluate(c=>{const r=c.getBoundingClientRect(),ctx=c.getContext('2d');return {x:r.x+28*r.width/440,y:r.y+(60+2*38)*r.height/570,width:ctx.measureText('fortune').width*r.width/440};});
 assert.ok(Math.abs(actual.first.x-expected.x)<1.5,'first selected glyph aligns with the independently known canvas paint x');
 assert.ok(Math.abs(actual.last.x+actual.last.width-expected.x-expected.width)<1.5,'last selected glyph aligns with the canvas word width');
 assert.ok(Math.abs(actual.first.y+actual.first.height/2-expected.y)<5,'glyph baseline aligns with the canvas row');
}
try{
 context=await chromium.launchPersistentContext(join(out,'profile'),{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1440,height:1000},deviceScaleFactor:2,args:['--load-extension='+extension,'--disable-extensions-except='+extension]});
 context.on('page',p=>p.on('pageerror',e=>report.errors.push(e.message)));
 // Pages may not call the public API. Extension worker requests are instead
 // constrained by the fresh profile's explicit local fixture configuration.
 await context.route('**/api.openai.com/**',route=>route.abort());
 await context.addInitScript(installWeReadPrototype);
 library=await context.newPage();await library.goto(origin+'/library.html');
 await rpc('CR_SAVE_SETTINGS',{mode:'api',apiKey:'WEREAD_FIXTURE_ONLY',baseUrl:site+'/v1',model:'fixture',protocol:'responses',rememberKey:true});
 page=await context.newPage();
 const url=live?'https://weread.qq.com/web/reader/b9f329705b6af5b9ffcf076k06932ec027e069059b7e512':site+'/web/reader/fixture';
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>document.querySelector('[data-cr-weread-scope]')?.textContent.length>30,null,{timeout:45000});
 let target=await wordRange('fortune');
 if(!target&&live){const next=page.getByRole('button',{name:'下一页',exact:true});if(await next.count()){await next.click();await page.waitForFunction(()=>[...document.querySelectorAll('[data-cr-weread-scope]')].some(e=>e.textContent.includes('fortune')),null,{timeout:30000});target=await wordRange('fortune');}}
 assert.ok(target,'The current public preview must contain the expected word; no paywall/login bypass is attempted.');
 assert.match(target.scope,/\sfortune|fortune,/);report.capture={canvasCount:await page.locator('canvas').count(),glyphCount:await page.locator('[data-cr-weread-glyph]').count(),target:target.text,explicitSpaces:/\w \w/.test(target.scope)};
 if(!live)await assertFixtureAlignment();
 pass('real readable glyphs, explicit English spaces and CSS-coordinate ranges are available');
 assert.equal(calls,0);
 const a=target.first,b=target.last;
 await page.mouse.move(a.x+1,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width-1,b.y+b.height/2,{steps:20});await page.mouse.up();
 assert.equal(await page.evaluate(()=>getSelection()?.toString()),'fortune');
 if(!live)assert.equal(await page.evaluate(()=>window.nativeSelections),0);
 let frame=await card();assert.equal(await frame.locator('.selection-preview').innerText(),'fortune');assert.equal(calls,0);
 pass('mouse dragging opens the existing selection card without inference');await snapshot('selection');
 await frame.locator('#run').click();await library.waitForFunction(async()=>{const r=await chrome.runtime.sendMessage({type:'CR_SNAPSHOT'});return r.data.entries.some(e=>e.canonical==='fortune'&&e.learning.status==='ready');});
 await Promise.race([learningResponse,new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(new Error('Learning fixture did not respond')),30000);timeout.unref();})]);
 await page.waitForFunction(()=>[...CSS.highlights.get('context-reader-known')||[]].some(r=>r.toString()==='fortune'));
 assert.equal(calls,2);assert.equal(submitted[0].selected,'fortune');assert.ok(submitted[0].context.includes('fortune'));
 report.explanation={selected:submitted[0].selected,contextContainsSelection:true,sourceHost:new URL(submitted[0].source.url).hostname};
 pass('explicit explain uses the existing task and library flow with the original page source');
 await closeCard();const matches=await page.evaluate(marked);assert.ok(matches.length>=1);report.markCount=matches.length;
 pass('saved words are automatically highlighted on the original canvas page');await snapshot('saved-highlights');
 const r=matches[0].rect;await page.mouse.move(r.x+r.width/2,r.y+r.height/2);frame=await card();await frame.locator('.term-title').filter({hasText:'fortune'}).waitFor();assert.equal(calls,2);
 pass('hover opens the existing saved-word card with zero extra model requests');await snapshot('hover');
 await closeCard();await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>[...CSS.highlights.get('context-reader-known')||[]].some(r=>r.toString()==='fortune'));
 assert.equal(calls,2);pass('reload reconstructs the layer and restores saved highlights without inference');
 if(!live){
  await rpc('CR_IMPORT',{version:1,entries:[{id:'phrase-fixture',canonical:'follow a phrase',aliases:[],kind:'phrase',baseMeanings:['合成短语']}],contexts:[],snippets:[]});
  await page.waitForFunction(()=>[...CSS.highlights.get('context-reader-phrase')||[]].some(r=>/follow\s+a phrase/.test(r.toString())));pass('saved phrases match across visible wrapped lines');
  pass('prototype text dragging avoids triggering the simulated native selection menu');
  const wrapped=await wordRange('follow\na phrase');assert.ok(wrapped);
  await page.mouse.move(wrapped.first.x+1,wrapped.first.y+wrapped.first.height/2);await page.mouse.down();await page.mouse.move(wrapped.last.x+wrapped.last.width-1,wrapped.last.y+wrapped.last.height/2,{steps:20});await page.mouse.up();
  assert.equal(await page.evaluate(()=>getSelection().toString().replace(/\s+/g,' ').trim()),'follow a phrase');
  frame=await card();assert.equal(await frame.locator('.selection-preview').innerText(),'follow a phrase');assert.equal(calls,2);await closeCard();pass('dragging across wrapped lines selects the exact phrase and opens the existing card without inference');
  await page.locator('#next').click();await page.waitForFunction(()=>document.querySelector('[data-cr-weread-scope]')?.textContent.includes('different page'));await page.waitForFunction(()=>!(CSS.highlights.get('context-reader-known')?.size));
  pass('canvas clear and reuse removes old text and highlights after a page turn');
  await page.locator('#next').click();await page.waitForFunction(()=>[...CSS.highlights.get('context-reader-known')||[]].filter(r=>r.toString()==='fortune').length===2);pass('returning to the previous page restores both saved occurrences');
  await page.setViewportSize({width:1100,height:900});await page.waitForFunction(()=>[...CSS.highlights.get('context-reader-known')||[]].every(r=>r.getBoundingClientRect().width>0));await assertFixtureAlignment();await snapshot('resized');pass('high-DPR range geometry stays aligned with actual canvas paint coordinates after resize');
  await page.evaluate(()=>{for(const c of document.querySelectorAll('canvas'))c.width=c.width;});
  await page.waitForFunction(()=>document.querySelector('#context-reader-weread-prototype')?.dataset.glyphCount==='0'&&!CSS.highlights.get('context-reader-known')?.size);
  await page.evaluate(()=>window.paint());await page.waitForFunction(()=>[...CSS.highlights.get('context-reader-known')||[]].filter(r=>r.toString()==='fortune').length===2);pass('equal-size canvas bitmap resets clear stale text before a later redraw');
 }
 report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;console.error(error.stack);if(page){await snapshot('failure').catch(()=>{});report.prototype=await page.locator('#context-reader-weread-prototype').evaluate(e=>({status:e.dataset.status,text:e.textContent.slice(0,1200)})).catch(()=>null);}process.exitCode=1;
}finally{
 report.modelRequests=calls;await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log('REPORT '+join(out,'report.json'));await context?.close();await new Promise(r=>server.close(r));
}
