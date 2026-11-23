import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {learningHtml,termHeading,componentsHtml,candidatesHtml} from '../src/ui/components.mjs';
import {QUICK_SCHEMA,parseResult,SYSTEM} from '../src/shared/model.mjs';
test('learning disclosures default open while remaining user-collapsible',()=>{const document=new JSDOM(learningHtml({learning:{status:'ready',usage:'用法',memory:'联想',examples:[{english:'She tacitly agreed.',chinese:'她默许了。'}]}})).window.document;assert.equal(document.querySelectorAll('details[open]').length,2);assert.equal(document.querySelectorAll('.example-speak').length,1);const first=document.querySelector('details');first.open=false;assert.equal(first.open,false);});
test('British and American IPA are separate; legacy IPA never gets silently relabeled',()=>{const doc=new JSDOM(termHeading({canonical:'hone',ipaUK:'/həʊn/',ipaUS:'/hoʊn/',partOfSpeech:'动词'})).window.document;assert.deepEqual([...doc.querySelectorAll('.ipa-pair')].map(x=>x.textContent),['英/həʊn/','美/hoʊn/']);assert.equal(doc.querySelectorAll('.ipa-speak').length,2);const old=new JSDOM(termHeading({canonical:'hone',ipa:'/legacy/'})).window.document;assert.ok(old.body.textContent.includes('尚未区分英美'));assert.equal(old.querySelectorAll('.ipa-pair').length,1);assert.ok(QUICK_SCHEMA.properties.expression.required.includes('ipaUK'));assert.ok(QUICK_SCHEMA.properties.expression.required.includes('ipaUS'));assert.ok(QUICK_SCHEMA.properties.expression.required.includes('components'));assert.ok(SYSTEM.includes('默 tacit地'));assert.ok(SYSTEM.includes('Goldman Sachs Group'));});
test('a hyphenated expression with unconfirmed pronunciation is visibly a compound and retains uncertainty',()=>{
 const result=parseResult(JSON.stringify({kind:'term',expression:{canonical:'jack-all',surface:'jack-alls',kind:'word',ipaUK:'',ipaUS:'',partOfSpeech:'名词',baseMeanings:['待核对'],meaning:'所给语境不足',note:''},meaning:'所给语境不足',explanation:'保留完整拼写',uncertainty:'可能是非常规用法。',candidates:[]}),'quick');
 assert.equal(result.expression.kind,'compound');assert.match(result.uncertainty,/非常规用法/);assert.match(result.uncertainty,/未确认.*读音/);const document=new JSDOM(termHeading(result.expression)).window.document;assert.equal(document.querySelector('.expression-kind').textContent,'复合词');assert.equal(document.querySelector('.ipa-unavailable').textContent,'读音待确认');assert.equal(document.querySelectorAll('.ipa-pair').length,0);
});
test('word-by-word components normalize IPA, synthesize missing phrase IPA, strip IPA refusal noise and render breakdown cards',()=>{
 const raw={
  kind:'term',
  expression:{
   canonical:'Goldman Sachs Group',
   surface:'Goldman Sachs Group',
   kind:'compound',
   ipaUK:'',
   ipaUS:'[ˌɡoʊldmən ˈsæks ɡruːp]',
   partOfSpeech:'专有名词',
   baseMeanings:['高盛集团'],
   components:[
    {word:'Goldman',ipaUK:'ˈɡəʊldmən',ipaUS:'ˈɡoʊldmən',partOfSpeech:'专有名词',meaning:'姓氏“戈德曼”，高盛创始人之一 Marcus Goldman 的姓氏。'},
    {word:'Sachs',ipaUK:'/sæks/',ipaUS:'/sæks/',partOfSpeech:'专有名词',meaning:'姓氏“萨克斯”，联合创始人 Samuel Sachs 的姓氏。'},
    {word:'Group',ipaUK:'/ɡruːp/',ipaUS:'/ɡruːp/',partOfSpeech:'名词',meaning:'集团、群组；用于企业名称表示控股集团。'}
   ],
   meaning:'高盛集团',
   note:'此处指高盛集团的经济学家团队。'
  },
  meaning:'高盛集团',
  explanation:'后接 Inc. 与 economists，表明观点来自该机构经济学家。',
  uncertainty:'公司名称的 IPA 未填写。该名称的完整读音可能因说话者习惯而异。',
  candidates:[]
 };
 const parsed=parseResult(JSON.stringify(raw),'quick');
 assert.equal(parsed.expression.ipaUK,'/ˈɡəʊldmən sæks ɡruːp/');
 assert.equal(parsed.expression.ipaUS,'/ˌɡoʊldmən ˈsæks ɡruːp/');
 assert.equal(parsed.uncertainty,'');
 assert.equal(parsed.expression.components.length,3);
 assert.equal(parsed.expression.components[1].word,'Sachs');
 assert.equal(parsed.expression.components[1].ipaUS,'/sæks/');
 const doc=new JSDOM(componentsHtml(parsed.expression)).window.document;
 assert.equal(doc.querySelectorAll('.component-item').length,3);
 assert.match(doc.body.textContent,/Sachs/);
 assert.match(doc.body.textContent,/萨克斯/);
 const legacyDoc=new JSDOM(componentsHtml({canonical:'Goldman Sachs Group',kind:'compound',ipaUK:'',ipaUS:''},{showUpgradeHint:true})).window.document;
 assert.ok(legacyDoc.querySelector('[data-upgrade-entry]'));
 const candDoc=new JSDOM(candidatesHtml([parsed.expression])).window.document;
 assert.match(candDoc.querySelector('.candidate-breakdown').textContent,/Sachs/);
});
