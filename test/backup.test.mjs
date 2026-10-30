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
});
