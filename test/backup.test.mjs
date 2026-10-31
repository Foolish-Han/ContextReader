import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../src/shared/store.mjs';

test('a backup keeps occurrence positions, provider provenance and uncollected passage candidates',async()=>{
  const adapter=()=>{let d;return {read:async()=>d,write:async v=>{d=structuredClone(v);}};};
  const a=createRepository(adapter());
  const expression={canonical:'hone',surface:'honed',kind:'word',ipa:'',partOfSpeech:'verb',baseMeanings:['磨练'],meaning:'技能得到磨练',note:''};
  const request={kind:'term',selected:'honed',sentence:'Skills can be honed.',context:'Skills can be honed.',before:'Skills can be',after:'.',source:{url:'https://example.com/post',title:'Post'}};
  const provider={mode:'codex',model:'configured',service:'codex-sdk'};
  await a.saveTerm(expression,request,'one',provider);
  await a.saveSnippet({meaning:'句意',explanation:'结构',uncertainty:'',candidates:[expression]},request,'snippet',provider);
  const b=createRepository(adapter());await b.import(await a.snapshot());const d=await b.snapshot();
  assert.equal(d.contexts[0].before,'Skills can be');assert.equal(d.contexts[0].after,'.');assert.deepEqual(d.contexts[0].provider,provider);assert.equal(d.snippets[0].candidates[0].canonical,'hone');assert.deepEqual(d.snippets[0].provider,provider);
  assert.equal(d.snippets[0].before,request.before);assert.equal(d.snippets[0].after,request.after);
});

test('passage index is source-scoped, keeps selected positions and conservatively restores legacy anchors',async()=>{
 const repository=createRepository({read:async()=>undefined,write:async()=>{}}),source={url:'https://example.com/read',title:'Read'};
 await repository.saveSnippet({meaning:'句意',explanation:'',uncertainty:'',candidates:[]},{selected:'Read it.',context:'Read it. Read it.',sentence:'Read it. Read it.',before:'',after:'Read it.',source},'new',{});
 await repository.import({version:1,entries:[],contexts:[],snippets:[{id:'old',hash:'old',text:'A legacy sentence.',context:'A legacy sentence.',source},{id:'ambiguous',hash:'ambiguous',text:'Again.',context:'Again. Again.',source}]});
 const index=await repository.passageIndex(source.url);assert.equal(index.length,2);assert.equal(index[0].request.after,'Read it.');assert.equal(index[1].request.before,'');assert.deepEqual(await repository.passageIndex('https://example.com/other'),[]);assert.equal((await repository.getSnippet(index[0].id)).snippet.meaning,'句意');assert.equal('meaning' in index[0],false);
});
