import {chromium} from 'playwright';
import {inspectOAuthVault} from './oauth-fixture.mjs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {readFile,mkdir,writeFile,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {extensionId} from '../src/shared/extension-id.mjs';
const out=resolve('test-results/oauth-browser-'+Date.now()),extension=join(out,'extension');await mkdir(out,{recursive:true});await cp('dist',extension,{recursive:true});
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8')),origin='chrome-extension://'+extensionId(manifest.key),issuer='https://auth.openai.com';
const {privateKey,publicKey}=await generateKeyPair('RS256'),key=await exportJWK(publicKey);key.kid='browser-fixture';
const report={realBrowser:true,realOAuth:false,realLlm:false,checks:[]},pass=name=>{report.checks.push(name);console.log('PASS '+name);};
let context;const launch=()=>chromium.launchPersistentContext(join(out,'profile'),{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--load-extension='+extension,'--disable-extensions-except='+extension]});
context=await launch();
const rpc=(page,type,payload={})=>page.evaluate(async({type,payload})=>{const r=await chrome.runtime.sendMessage({type,payload});if(!r?.ok)throw new Error(r?.error||'No response');return r.data;},{type,payload});
try{
 // Every auth navigation is synthetic. No person is signed in or authorized.
 await context.route(issuer+'/**',async route=>{
  const auth=new URL(route.request().url());if(auth.pathname==='/finish'){await route.fulfill({status:302,headers:{Location:auth.searchParams.get('callback')}});return;}const callback=new URL('http://127.0.0.1:43821/auth/callback');callback.search=new URLSearchParams({state:auth.searchParams.get('state'),code:'BROWSER_FIXTURE_CODE',client_id:'oaiapp_browser_fixture'});
  await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic consent</title><a id="allow" href="'+(issuer+'/finish?callback='+encodeURIComponent(callback.href)).replaceAll('&','&amp;')+'">Allow synthetic account</a>'});
 });
 let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const installMock=async worker=>worker.evaluate(({key,issuer})=>{
  globalThis.fixtureToken='';globalThis.fixtureCalls=[];globalThis.fetch=async(url,init={})=>{
   const raw=String(url?.url||url),path=new URL(raw).pathname;globalThis.fixtureCalls.push(path);
   if(raw===issuer+'/.well-known/openid-configuration')return Response.json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',revocation_endpoint:issuer+'/revoke'});
   if(raw===issuer+'/jwks')return Response.json({keys:[key]});
   if(raw===issuer+'/token')return Response.json({access_token:'BROWSER_FIXTURE_ACCESS',refresh_token:'BROWSER_FIXTURE_REFRESH',token_type:'Bearer',expires_in:3600,scope:'openid offline_access chatgpt.tokens.use.direct',id_token:globalThis.fixtureToken});
   if(raw===issuer+'/revoke')return new Response('',{status:200});
   if(raw==='https://api.openai.com/v1/models')return Response.json({models:[{slug:'gpt-6-luna',display_name:'GPT-6 Luna',visibility:'list'}]});
   throw new Error('Unexpected network request in OAuth fixture');
  };
 },{key,issuer});
 await installMock(worker);
 let options=await context.newPage();await options.goto(origin+'/options.html');
 await options.getByRole('button',{name:'Continue with ChatGPT'}).click();
 await options.getByRole('heading',{name:'正在等待 OpenAI 授权'}).waitFor();
 const consent=context.pages().find(p=>p!==options&&p.url()!=='about:blank')||context.pages().at(-1);await consent.waitForURL(issuer+'/**');
 const nonce=new URL(consent.url()).searchParams.get('nonce');
 const token=await new SignJWT({nonce,email:'synthetic@example.com'}).setProtectedHeader({alg:'RS256',kid:key.kid}).setIssuer(issuer).setAudience('oaiapp_browser_fixture').setSubject('synthetic-reader').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 await worker.evaluate(token=>globalThis.fixtureToken=token,token);
 // Reload the settings page during login to verify attempt recovery and polling.
 await options.reload();await options.getByRole('heading',{name:'正在等待 OpenAI 授权'}).waitFor();
 await consent.locator('#allow').click();
 await options.getByRole('heading',{name:'ChatGPT 已登录'}).waitFor({timeout:15000});
 await options.locator('#oauth-model option[value="gpt-6-luna"]').waitFor({state:'attached'});
 assert.equal(consent.url(),origin+'/oauth-result.html');
 assert.equal((await rpc(options,'CR_OAUTH_STATE')).session.sharing,true);
 assert.equal((await rpc(options,'CR_GET_SETTINGS')).oauthModel,'gpt-6-luna');
 pass('actual Chrome callback observation completes PKCE/OIDC login with no loopback helper listening');
 const state=await rpc(options,'CR_OAUTH_STATE'),exported=await rpc(options,'CR_EXPORT');
 assert.equal(/Token|BROWSER_FIXTURE_(?:ACCESS|REFRESH)/.test(JSON.stringify({state,exported})),false);
 assert.equal(await options.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null)).includes('BROWSER_FIXTURE_REFRESH')),false);
 const calls=await worker.evaluate(()=>globalThis.fixtureCalls);assert.equal(calls.filter(p=>p==='/token').length,1);assert.equal(calls.some(p=>p==='/responses'),false);
 await options.screenshot({path:join(out,'settings-connected-light.png'),fullPage:true});
 await options.getByRole('button',{name:'深色',exact:true}).click();await options.screenshot({path:join(out,'settings-connected-dark.png'),fullPage:true});
 pass('settings reload preserves pending login; account/model state and exports expose no credentials');
 // Closing the persistent context terminates the browser process and worker.
 // The replacement context uses the same isolated profile, no session state.
 const originalProfile=(await rpc(options,'CR_OAUTH_STATE')).session.profileId;
 assert.deepEqual(await worker.evaluate(inspectOAuthVault),{accounts:1,keyExtractable:false,encrypted:true,containsPlainFixture:false});
 await context.close();context=await launch();worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await installMock(worker);
 options=await context.newPage();await options.goto(origin+'/options.html');await options.getByRole('heading',{name:'ChatGPT 已登录'}).waitFor();await options.locator('#oauth-model option[value="gpt-6-luna"]').waitFor({state:'attached'});
 assert.equal((await rpc(options,'CR_OAUTH_STATE')).session.profileId,originalProfile);
 assert.equal(await worker.evaluate(()=>globalThis.fixtureCalls.filter(p=>p==='/token').length),0);
 assert.equal(context.pages().some(p=>p.url().startsWith(issuer)),false);
 pass('full Chrome shutdown and restart retain the login without new consent or premature refresh');
 // Expired access is renewed using the retained rotating grant, without login.
 const refreshed=await new SignJWT({email:'synthetic@example.com'}).setProtectedHeader({alg:'RS256',kid:key.kid}).setIssuer(issuer).setAudience('oaiapp_browser_fixture').setSubject('synthetic-reader').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 await worker.evaluate(value=>globalThis.fixtureToken=value,refreshed);await worker.evaluate(inspectOAuthVault,{expire:true});await rpc(options,'CR_OAUTH_MODELS');
 assert.equal(await worker.evaluate(()=>globalThis.fixtureCalls.filter(p=>p==='/token').length),1);
 assert.equal(context.pages().some(p=>p.url().startsWith(issuer)),false);pass('expired access refreshes automatically after restart without repeating browser authentication');
 await context.route(issuer+'/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic pending sign-in</title>'}));
 await options.locator('#logout').click();await options.getByRole('button',{name:'Continue with ChatGPT'}).waitFor();
 await options.getByRole('button',{name:'Continue with ChatGPT'}).click();await options.locator('#cancel-auth').waitFor();await options.locator('#cancel-auth').click();await options.getByRole('button',{name:'Continue with ChatGPT'}).waitFor();
 assert.equal((await rpc(options,'CR_OAUTH_STATE')).session.status,'disconnected');assert.equal((await worker.evaluate(inspectOAuthVault)).accounts,0);pass('logout and cancel controls clear credentials and close the pending login tab');
 const ordinary=await context.newPage();await context.route('http://example.test/**',route=>route.fulfill({body:'<p>Offline article</p>',contentType:'text/html'}));await ordinary.goto('http://example.test/article');
 const denied=await worker.evaluate(async()=>{const tab=(await chrome.tabs.query({})).find(t=>t.url==='http://example.test/article');const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>chrome.runtime.sendMessage({type:'CR_OAUTH_STATE'}).then(r=>!r.ok)});return result.result;});assert.equal(denied,true);pass('content scripts cannot read credential or account RPCs');
 report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;console.error(error.stack);process.exitCode=1;}
finally{await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));await context.close();console.log('REPORT '+out);}
