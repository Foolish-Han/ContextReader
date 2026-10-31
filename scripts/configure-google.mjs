import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extensionId} from '../src/shared/extension-id.mjs';
const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function configureGoogle({clientId,projectRoot=defaultRoot,extensionDirectories=[]}){
 clientId=String(clientId||'').trim();if(!/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(clientId))throw new Error('Client ID 格式不正确。');
 const root=resolve(projectRoot),mainPath=join(root,'dist','manifest.json'),main=JSON.parse(await readFile(mainPath,'utf8'));
 const valid=manifest=>['语境 Context Reader','语境 · Context Reader'].includes(manifest.name)&&manifest.key&&manifest.permissions?.includes('identity');
 if(!valid(main))throw new Error('目标不是支持 Google 同步的语境扩展。');
 const targets=new Map([[mainPath,main]]);
 for(const directory of extensionDirectories){const path=join(resolve(directory),'manifest.json'),manifest=JSON.parse(await readFile(path,'utf8'));if(!valid(manifest)||manifest.key!==main.key)throw new Error('目标不是同一扩展的开发副本：'+path);targets.set(path,manifest);}
 // All destinations are explicit and validated before any write. Browser
 // profiles, Preferences and Web Store installations are never discovered.
 for(const [path,manifest] of targets){manifest.oauth2={client_id:clientId,scopes:['https://www.googleapis.com/auth/drive.appdata']};await writeFile(path,JSON.stringify(manifest,null,2)+'\n');}
 await mkdir(join(root,'extension'),{recursive:true});await writeFile(join(root,'extension','google-oauth.json'),JSON.stringify({clientId},null,2)+'\n');
 return {extensionId:extensionId(main.key),updated:[...targets.keys()]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),input={extensionDirectories:[]};
 for(let i=0;i<args.length;i++){const value=args[++i];if(!value)throw new Error('参数缺少值。');if(args[i-1]==='--client-id')input.clientId=value;else if(args[i-1]==='--project')input.projectRoot=value;else if(args[i-1]==='--extension-dir')input.extensionDirectories.push(value);else throw new Error('未知参数。');}
 if(!input.clientId){const {createInterface}=await import('node:readline/promises');const prompt=createInterface({input:process.stdin,output:process.stdout});try{input.clientId=await prompt.question('Google OAuth Client ID（无需 Client Secret）：');}finally{prompt.close();}}
 const result=await configureGoogle(input);console.log('公开配置已更新。请重新加载扩展并刷新设置页。');console.log('Extension ID: '+result.extensionId);
}
