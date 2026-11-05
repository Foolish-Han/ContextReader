import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {learningHtml,termHeading} from '../src/ui/components.mjs';
import {QUICK_SCHEMA,parseResult,SYSTEM} from '../src/shared/model.mjs';
test('learning disclosures default open while remaining user-collapsible',()=>{const document=new JSDOM(learningHtml({learning:{status:'ready',usage:'用法',memory:'联想',examples:[]}})).window.document;assert.equal(document.querySelectorAll('details[open]').length,2);const first=document.querySelector('details');first.open=false;assert.equal(first.open,false);});
test('British and American IPA are separate; legacy IPA never gets silently relabeled',()=>{const doc=new JSDOM(termHeading({canonical:'hone',ipaUK:'/həʊn/',ipaUS:'/hoʊn/',partOfSpeech:'动词'})).window.document;assert.deepEqual([...doc.querySelectorAll('.ipa-pair')].map(x=>x.textContent),['英/həʊn/','美/hoʊn/']);const old=new JSDOM(termHeading({canonical:'hone',ipa:'/legacy/'})).window.document;assert.ok(old.body.textContent.includes('尚未区分英美'));assert.equal(old.querySelectorAll('.ipa-pair').length,1);assert.ok(QUICK_SCHEMA.properties.expression.required.includes('ipaUK'));assert.ok(QUICK_SCHEMA.properties.expression.required.includes('ipaUS'));assert.ok(SYSTEM.includes('默 tacit地'));});
test('a hyphenated expression with unconfirmed pronunciation is visibly a compound and retains uncertainty',()=>{
 const result=parseResult(JSON.stringify({kind:'term',expression:{canonical:'jack-all',surface:'jack-alls',kind:'word',ipaUK:'',ipaUS:'',partOfSpeech:'名词',baseMeanings:['待核对'],meaning:'所给语境不足',note:''},meaning:'所给语境不足',explanation:'保留完整拼写',uncertainty:'可能是非常规用法。',candidates:[]}),'quick');
 assert.equal(result.expression.kind,'compound');assert.match(result.uncertainty,/非常规用法/);assert.match(result.uncertainty,/未确认.*读音/);const document=new JSDOM(termHeading(result.expression)).window.document;assert.equal(document.querySelector('.expression-kind').textContent,'复合词');assert.equal(document.querySelector('.ipa-unavailable').textContent,'读音待确认');assert.equal(document.querySelectorAll('.ipa-pair').length,0);
});
