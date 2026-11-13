import test from 'node:test';
import assert from 'node:assert/strict';
import {searchKnowledge,matchExcerpt} from '../src/ui/search.mjs';

const entry=(id,canonical,extra={})=>({id,canonical,aliases:[canonical],baseMeanings:[],createdAt:'2026-01-01',...extra});
const snapshot={entries:[
 entry('unrelated','humanity',{updatedAt:'2026-11-10',internalOutput:'out',learning:{usage:'描述人类'}}),
 entry('context','fellow',{updatedAt:'2026-11-11'}),
 entry('prefix','outside',{updatedAt:'2026-11-12'}),
 entry('exact','out',{updatedAt:'2026-01-01',baseMeanings:['向外']}),
 entry('alias','go',{aliases:['go','went'],baseMeanings:['去']})
],contexts:[{entryId:'context',meaning:'同伴',sentence:'They went out together.',context:'They went out together.'}],snippets:[{id:'passage',text:'A longer passage about study.',meaning:'关于学习',context:'A longer passage about study.',createdAt:'2026-01-01'}]};

test('search ranks exact expressions above prefixes and historical sentences and ignores internal fields',()=>{
 const results=searchKnowledge(snapshot,'entries',' OUT ');assert.deepEqual(results.map(r=>r.item.id),['exact','prefix','context']);assert.equal(results[2].match.label,'匹配原句');assert.match(matchExcerpt(results[2].match.text,'out'),/went out together/);
});
test('aliases, Chinese meanings, historical explanations and passage text remain searchable',()=>{
 assert.equal(searchKnowledge(snapshot,'entries','WENT')[0].item.id,'alias');assert.equal(searchKnowledge(snapshot,'entries','向外')[0].item.id,'exact');assert.equal(searchKnowledge(snapshot,'entries','同伴')[0].item.id,'context');assert.equal(searchKnowledge(snapshot,'snippets','study')[0].item.id,'passage');assert.equal(searchKnowledge(snapshot,'snippets','学习')[0].item.id,'passage');assert.equal(searchKnowledge(snapshot,'entries','internalOutput').length,0);
});
test('empty search keeps recent-first order and excerpts preserve text around a distant match',()=>{
 assert.equal(searchKnowledge(snapshot,'entries','  ')[0].item.id,'prefix');const excerpt=matchExcerpt('a'.repeat(300)+' target '+'b'.repeat(300),'target');assert.ok(excerpt.startsWith('…'));assert.ok(excerpt.includes('target'));assert.ok(excerpt.endsWith('…'));
});
