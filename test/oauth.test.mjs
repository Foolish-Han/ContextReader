import test from 'node:test';import assert from 'node:assert/strict';
import {infer,listOAuthModels} from '../src/background/provider.mjs';
const datum={kind:'term',expression:{canonical:'hone',surface:'honed',kind:'word',ipa:'',partOfSpeech:'verb',baseMeanings:['磨练'],meaning:'磨练',note:''},meaning:'技能可以磨练',explanation:'被动表达',uncertainty:'',candidates:[]};
const input={kind:'term',selected:'honed',sentence:'Skills can be honed.',context:'Skills can be honed.',before:'Skills can be',after:'.',source:{url:'https://example.com',title:'Test'}};
const stream=()=>new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(datum)})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{id:'synthetic-response',usage:{input_tokens:5,output_tokens:5}}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});

test('OAuth inference goes directly to the public Responses route and never uses a configured API key',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0,body;
 globalThis.fetch=async(request,init)=>{calls++;assert.equal(String(request),'https://api.openai.com/v1/responses');const headers=new Headers(init.headers);assert.equal(headers.get('authorization'),'Bearer synthetic-oauth-access');body=JSON.parse(init.body);return stream();};
 const result=await infer({mode:'oauth',model:'account-visible-model',baseUrl:'https://never-use-this.invalid',protocol:'chat'},'api-key-must-not-be-used','quick',input,{authorize:async()=>({accessToken:'synthetic-oauth-access',profileId:'one'})});assert.equal(result.provider,'openai-sdk-oauth');assert.equal(result.data.meaning,datum.meaning);assert.equal(body.stream,true);assert.equal(body.store,false);assert.equal(Array.isArray(body.input),true);assert.equal(body.input[0].role,'user');assert.equal(body.conversation,undefined);assert.equal(body.previous_response_id,undefined);assert.equal(calls,1);
 await assert.rejects(infer({mode:'oauth',model:'visible'},'api-key-must-not-be-used','quick',input,{authorize:async()=>{throw new Error('sharing_not_enabled');}}),/sharing_not_enabled/);assert.equal(calls,1);
});

test('OAuth model discovery uses the account token and filters hidden models',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/models');assert.equal(init.headers.Authorization,'Bearer synthetic-catalog-token');return Response.json({models:[{slug:'visible',display_name:'Visible model',visibility:'list'},{slug:'hidden',display_name:'Hidden',visibility:'hidden'}]});};
 assert.deepEqual(await listOAuthModels(async()=>({accessToken:'synthetic-catalog-token'})),[{slug:'visible',displayName:'Visible model'}]);
});

test('learning JSON mode declares JSON in the user input and validates the completed card locally',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let body;
 const learning={usage:'hone 搭配 skills 表示磨练技能。',memory:'把练习想成磨刀。',etymology:'',etymologySource:'',examples:[{english:'Practice hones skills.',chinese:'练习磨练技能。'},{english:'She honed her craft.',chinese:'她磨练了技艺。'}]};
 globalThis.fetch=async(_url,init)=>{body=JSON.parse(init.body);return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(learning)})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{usage:{}}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});};
 const result=await infer({mode:'oauth',model:'gpt-6-luna'},'','learn',{canonical:'hone'},{authorize:async()=>({accessToken:'synthetic-access',profileId:'one'})});
 assert.equal(body.text.format.type,'json_object');assert.match(body.input[0].content,/JSON/);assert.match(body.instructions,/JSON 的结构/);assert.equal(body.model,'gpt-6-luna');assert.deepEqual(result.data,learning);
});

test('OAuth never accepts a valid-looking JSON body from an interrupted stream',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async()=>new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(datum)})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 await assert.rejects(infer({mode:'oauth',model:'visible'},'','quick',input,{authorize:async()=>({accessToken:'synthetic-access',profileId:'one'})}),/未正常完成/);
});
