import test from 'node:test';import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {configureGoogle} from '../scripts/configure-google.mjs';
import {validateGoogleRelease} from '../scripts/google-config.mjs';
import {extensionId} from '../src/shared/extension-id.mjs';
const clientId='123456789-publisher-fixture.apps.googleusercontent.com',scope='https://www.googleapis.com/auth/drive.appdata';
test('release packaging rejects missing or stale application OAuth configuration',()=>{
 const manifest={permissions:['identity'],oauth2:{client_id:clientId,scopes:[scope]}};assert.equal(validateGoogleRelease(manifest,clientId),true);assert.throws(()=>validateGoogleRelease({...manifest,oauth2:undefined},clientId),/发布包/);assert.throws(()=>validateGoogleRelease(manifest,'99999-other.apps.googleusercontent.com'),/不一致/);assert.throws(()=>validateGoogleRelease({...manifest,oauth2:{...manifest.oauth2,scopes:['https://www.googleapis.com/auth/drive']}},clientId),/范围/);
});
async function fixture(){const base=resolve('test-results');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'publisher-')),source=join(root,'source'),loaded=join(root,'installed');for(const path of [join(source,'dist'),join(source,'extension'),join(loaded,'dist')])await mkdir(path,{recursive:true});const manifest=JSON.parse(await readFile('dist/manifest.json','utf8'));delete manifest.oauth2;for(const folder of [source,loaded])await writeFile(join(folder,'dist/manifest.json'),JSON.stringify(manifest));return {source,loaded,manifest};}
test('cross-platform publisher updates only explicit extension copies and never browser profiles',async()=>{
 const {source,loaded,manifest}=await fixture();const result=await configureGoogle({projectRoot:source,clientId,extensionDirectories:[join(loaded,'dist')]});assert.equal(result.extensionId,extensionId(manifest.key));for(const folder of [source,loaded])assert.equal(JSON.parse(await readFile(join(folder,'dist/manifest.json'),'utf8')).oauth2.client_id,clientId);assert.equal(JSON.parse(await readFile(join(source,'extension/google-oauth.json'),'utf8')).clientId,clientId);
});
test('publisher rejects an unrelated target before changing either configuration',async()=>{
 const {source,loaded,manifest}=await fixture(),path=join(loaded,'dist/manifest.json');await writeFile(path,JSON.stringify({...manifest,key:'unrelated-key'}));const before=await readFile(join(source,'dist/manifest.json'),'utf8');await assert.rejects(configureGoogle({projectRoot:source,clientId,extensionDirectories:[join(loaded,'dist')]}),/同一扩展/);assert.equal(await readFile(join(source,'dist/manifest.json'),'utf8'),before);assert.equal(JSON.parse(await readFile(path,'utf8')).key,'unrelated-key');await assert.rejects(configureGoogle({projectRoot:source,clientId:'invalid'}),/Client ID/);
});
