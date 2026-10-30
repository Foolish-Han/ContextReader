import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,cp,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateGoogleRelease} from '../scripts/google-config.mjs';
import {extensionId} from '../src/shared/extension-id.mjs';
const clientId='123456789-publisher-fixture.apps.googleusercontent.com',scope='https://www.googleapis.com/auth/drive.appdata';
test('release packaging rejects missing or stale application OAuth configuration',()=>{
 const manifest={permissions:['identity'],oauth2:{client_id:clientId,scopes:[scope]}};assert.equal(validateGoogleRelease(manifest,clientId),true);assert.throws(()=>validateGoogleRelease({...manifest,oauth2:undefined},clientId),/发布包/);assert.throws(()=>validateGoogleRelease(manifest,'99999-other.apps.googleusercontent.com'),/不一致/);assert.throws(()=>validateGoogleRelease({...manifest,oauth2:{...manifest.oauth2,scopes:['https://www.googleapis.com/auth/drive']}},clientId),/范围/);
});
test('publisher configuration updates the actual loaded copy with a different installation path',async()=>{
 const base=resolve('test-results');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'publisher-')),source=join(root,'source'),loaded=join(root,'installed'),chrome=join(root,'chrome');
 for(const path of [join(source,'dist'),join(source,'extension'),join(loaded,'dist'),join(loaded,'extension'),join(chrome,'Profile 1')])await mkdir(path,{recursive:true});
 const manifest=JSON.parse(await readFile('dist/manifest.json','utf8'));delete manifest.oauth2;const id=extensionId(manifest.key);await writeFile(join(source,'dist/manifest.json'),JSON.stringify(manifest));await writeFile(join(loaded,'dist/manifest.json'),JSON.stringify(manifest));await cp('configure-google.ps1',join(source,'configure-google.ps1'));
 const prefs=JSON.stringify({extensions:{settings:{[id]:{path:join(loaded,'dist'),location:4}}}}),prefsFile=join(chrome,'Profile 1/Secure Preferences');await writeFile(prefsFile,prefs);
 execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(source,'configure-google.ps1'),'-ClientId',clientId,'-ChromeUserDataPath',chrome],{windowsHide:true});
 for(const folder of [source,loaded]){const result=JSON.parse(await readFile(join(folder,'dist/manifest.json'),'utf8'));assert.equal(result.oauth2.client_id,clientId);assert.equal(extensionId(result.key),id);assert.equal(JSON.parse(await readFile(join(folder,'extension/google-oauth.json'),'utf8')).clientId,clientId);}
 assert.equal(await readFile(prefsFile,'utf8'),prefs);
});
test('publisher discovery cannot modify another extension or a packaged Web Store install',async()=>{
 const base=resolve('test-results');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'publisher-skip-')),source=join(root,'source'),loaded=join(root,'other'),chrome=join(root,'chrome');
 for(const path of [join(source,'dist'),join(source,'extension'),join(loaded,'dist'),join(chrome,'Default')])await mkdir(path,{recursive:true});
 const manifest=JSON.parse(await readFile('dist/manifest.json','utf8')),id=extensionId(manifest.key);await writeFile(join(source,'dist/manifest.json'),JSON.stringify(manifest));await cp('configure-google.ps1',join(source,'configure-google.ps1'));const unrelated=JSON.stringify({...manifest,key:'unrelated-extension-key'});await writeFile(join(loaded,'dist/manifest.json'),unrelated);await writeFile(join(chrome,'Default/Secure Preferences'),JSON.stringify({extensions:{settings:{[id]:{path:join(loaded,'dist'),location:4}}}}));
 execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(source,'configure-google.ps1'),'-ClientId',clientId,'-ChromeUserDataPath',chrome],{windowsHide:true});assert.equal(await readFile(join(loaded,'dist/manifest.json'),'utf8'),unrelated);
 const packaged={...manifest};delete packaged.oauth2;const original=JSON.stringify(packaged);await writeFile(join(loaded,'dist/manifest.json'),original);await writeFile(join(chrome,'Default/Secure Preferences'),JSON.stringify({extensions:{settings:{[id]:{path:join(loaded,'dist'),location:1}}}}));
 execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(source,'configure-google.ps1'),'-ClientId',clientId,'-ChromeUserDataPath',chrome],{windowsHide:true});assert.equal(await readFile(join(loaded,'dist/manifest.json'),'utf8'),original);
});
