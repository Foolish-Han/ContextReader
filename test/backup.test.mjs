import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../src/shared/store.mjs';

test('a backup keeps occurrence positions, provider provenance, word breakdowns and uncollected passage candidates',async()=>{
  const adapter=()=>{let d;return {read:async()=>d,write:async v=>{d=structuredClone(v);}};};
  const a=createRepository(adapter());
  const expression={canonical:'Goldman Sachs Group',surface:'Goldman Sachs Group',kind:'compound',ipa:'',ipaUK:'/ˌɡəʊldmən ˈsæks ɡruːp/',ipaUS:'/ˌɡoʊldmən ˈsæks ɡruːp/',partOfSpeech:'专有名词',baseMeanings:['高盛集团'],components:[{word:'Goldman',ipaUK:'/ˈɡəʊldmən/',ipaUS:'/ˈɡoʊldmən/',partOfSpeech:'专有名词',meaning:'戈德曼'},{word:'Sachs',ipaUK:'/sæks/',ipaUS:'/sæks/',partOfSpeech:'专有名词',meaning:'萨克斯'},{word:'Group',ipaUK:'/ɡruːp/',ipaUS:'/ɡruːp/',partOfSpeech:'名词',meaning:'集团'}],meaning:'高盛集团',note:''};
  const request={kind:'term',selected:'Goldman Sachs Group',sentence:'According to Goldman Sachs Group economists.',context:'According to Goldman Sachs Group economists.',before:'According to',after:'economists.',source:{url:'https://example.com/post',title:'Post'}};
  const provider={mode:'codex',model:'configured',service:'codex-sdk'};
  await a.saveTerm(expression,request,'one',provider);
  await a.saveSnippet({meaning:'句意',explanation:'结构',uncertainty:'',candidates:[expression]},request,'snippet',provider);
  const b=createRepository(adapter());await b.import(await a.snapshot());const d=await b.snapshot();
  assert.equal(d.contexts[0].before,'According to');assert.equal(d.contexts[0].after,'economists.');assert.deepEqual(d.contexts[0].provider,provider);assert.equal(d.entries[0].components.length,3);assert.equal(d.entries[0].components[1].word,'Sachs');assert.equal(d.snippets[0].candidates[0].canonical,'Goldman Sachs Group');assert.equal(d.snippets[0].candidates[0].components.length,3);assert.deepEqual(d.snippets[0].provider,provider);
  assert.equal(d.snippets[0].before,request.before);assert.equal(d.snippets[0].after,request.after);
});

test('legacy backups without components or UK/US IPA import cleanly and backfill components on later lookup',async()=>{
  const adapter=()=>{let d;return {read:async()=>d,write:async v=>{d=structuredClone(v);}};};
  const repo=createRepository(adapter());
  await repo.import({
    version:1,
    entries:[{id:'legacy-gs',canonical:'Goldman Sachs Group',aliases:['Goldman Sachs Group'],kind:'compound',ipa:'',ipaUK:'',ipaUS:'',partOfSpeech:'专有名词',baseMeanings:['高盛集团'],note:'旧版记录',createdAt:'2026-11-20T00:00:00.000Z'}],
    contexts:[{id:'legacy-ctx',entryId:'legacy-gs',hash:'legacy-hash',selected:'Goldman Sachs Group',surface:'Goldman Sachs Group',sentence:'According to Goldman Sachs Group Inc. economists.',context:'According to Goldman Sachs Group Inc. economists.',meaning:'高盛集团',explanation:'旧版解释',uncertainty:'公司名称的 IPA 未填写。',source:{url:'https://bloomberg.com/news',title:'News'},createdAt:'2026-11-20T00:00:00.000Z'}],
    snippets:[]
  });
  let snap=await repo.snapshot();
  assert.equal(snap.entries.length,1);
  assert.equal(snap.entries[0].components,undefined);
  await repo.saveTerm({
    canonical:'Goldman Sachs Group',
    surface:'Goldman Sachs Group',
    kind:'compound',
    ipaUK:'/ˌɡəʊldmən ˈsæks ɡruːp/',
    ipaUS:'/ˌɡoʊldmən ˈsæks ɡruːp/',
    partOfSpeech:'专有名词',
    baseMeanings:['高盛集团'],
    components:[
      {word:'Goldman',ipaUK:'/ˈɡəʊldmən/',ipaUS:'/ˈɡoʊldmən/',partOfSpeech:'专有名词',meaning:'戈德曼'},
      {word:'Sachs',ipaUK:'/sæks/',ipaUS:'/sæks/',partOfSpeech:'专有名词',meaning:'萨克斯'},
      {word:'Group',ipaUK:'/ɡruːp/',ipaUS:'/ɡruːp/',partOfSpeech:'名词',meaning:'集团'}
    ],
    meaning:'高盛集团',
    note:'新版解释'
  },{kind:'term',selected:'Goldman Sachs Group',sentence:'New sentence with Goldman Sachs Group.',context:'New sentence with Goldman Sachs Group.',before:'New sentence with',after:'.',source:{url:'https://example.com/2',title:'Two'}},'new-hash',{mode:'oauth',model:'gpt-6-luna',service:'openai-sdk-oauth'},snap.entries[0].id);
  snap=await repo.snapshot();
  assert.equal(snap.entries[0].ipaUS,'/ˌɡoʊldmən ˈsæks ɡruːp/');
  assert.equal(snap.entries[0].components.length,3);
  assert.equal(snap.contexts.length,2);
});

test('passage index is source-scoped, keeps selected positions and conservatively restores legacy anchors',async()=>{
 const repository=createRepository({read:async()=>undefined,write:async()=>{}}),source={url:'https://example.com/read',title:'Read'};
 await repository.saveSnippet({meaning:'句意',explanation:'',uncertainty:'',candidates:[]},{selected:'Read it.',context:'Read it. Read it.',sentence:'Read it. Read it.',before:'',after:'Read it.',source},'new',{});
 await repository.import({version:1,entries:[],contexts:[],snippets:[{id:'old',hash:'old',text:'A legacy sentence.',context:'A legacy sentence.',source},{id:'ambiguous',hash:'ambiguous',text:'Again.',context:'Again. Again.',source}]});
 const index=await repository.passageIndex(source.url);assert.equal(index.length,2);assert.equal(index[0].request.after,'Read it.');assert.equal(index[1].request.before,'');assert.deepEqual(await repository.passageIndex('https://example.com/other'),[]);assert.equal((await repository.getSnippet(index[0].id)).snippet.meaning,'句意');assert.equal('meaning' in index[0],false);
});

test('backup import keeps saved learning during an interrupted refresh and preserves human edits',async()=>{
 const repository=createRepository({read:async()=>undefined,write:async()=>{}});
 const previous={usage:'之前保存的用法',memory:'之前的记忆',examples:[{english:'An example.',chinese:'一个例句。'}]};
 await repository.import({version:1,entries:[
  {id:'refreshing',canonical:'refreshing',learning:{status:'pending',refreshing:true,...previous}},
  {id:'failed',canonical:'failed',learning:{status:'failed',...previous}},
  {id:'edited',canonical:'edited',learning:{status:'ready',edited:true,...previous}}
 ],contexts:[],snippets:[]});
 const saved=await repository.snapshot(),byName=name=>saved.entries.find(e=>e.canonical===name);
 for(const name of ['refreshing','failed']){
  const learning=byName(name).learning;
  assert.equal(learning.status,'failed');
  assert.equal(learning.usage,previous.usage);
  assert.deepEqual(learning.examples,previous.examples);
 }
 assert.equal(byName('edited').learning.edited,true);
 await repository.learning(byName('edited').id,{status:'ready',usage:'模型覆盖'});
 assert.equal((await repository.snapshot()).entries.find(e=>e.canonical==='edited').learning.usage,previous.usage);
 assert.equal((await repository.internal()).tasks?.length||0,0);
});
