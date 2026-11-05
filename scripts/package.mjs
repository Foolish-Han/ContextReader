import {mkdir,cp,copyFile,writeFile,readFile,lstat,rm,readdir} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {archiveDirectory} from './archive.mjs';
import {validateGoogleRelease} from './google-config.mjs';
import {validatePublishedPaths,assertNoSecrets,sha256} from './publication.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),release=join(root,'release');
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid package version');
const manifest=JSON.parse(await readFile(join(root,'dist/manifest.json'),'utf8')),google=JSON.parse(await readFile(join(root,'extension/google-oauth.json'),'utf8'));
validateGoogleRelease(manifest,google.clientId);if(manifest.version!==version)throw new Error('Build the current version before packaging');
const files=validatePublishedPaths(execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));if(!files.length)throw new Error('Release source must be tracked in Git');
execFileSync('git',['rev-parse','--verify','HEAD'],{cwd:root,stdio:'pipe'});
if(execFileSync('git',['status','--porcelain=v1','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim())throw new Error('Commit tracked source changes before packaging');
for(const file of files){const source=join(root,file);if((await lstat(source)).isSymbolicLink())throw new Error('Refusing a source symlink: '+file);if(/\.(?:mjs|js|ts|json|md|txt|ps1|cmd|yml|yaml|html|svg|css)$/.test(file))assertNoSecrets(file,await readFile(source,'utf8'));}
async function scanGenerated(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isSymbolicLink())throw new Error('Generated output must not contain a symlink');if(entry.isDirectory())await scanGenerated(path);else if(/\.(?:js|mjs|json|html|css|txt|svg)$/.test(entry.name)||entry.name.endsWith('LICENSE'))assertNoSecrets(relative(root,path),await readFile(path,'utf8'));}}
await scanGenerated(join(root,'dist'));
await mkdir(release,{recursive:true});const name='context-reader-'+version,folder=join(release,name);
if(relative(release,folder)!==name)throw new Error('Invalid release target');
try{if((await lstat(folder)).isSymbolicLink())throw new Error('Release must not be a symlink');await readFile(join(folder,'.context-reader-release'));await rm(folder,{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(folder,{recursive:true});await writeFile(join(folder,'.context-reader-release'),'Generated from tracked public source by scripts/package.mjs\n');
for(const file of files){const target=join(folder,file);await mkdir(dirname(target),{recursive:true});await copyFile(join(root,file),target);}
await cp(join(root,'dist'),join(folder,'dist'),{recursive:true});
await writeFile(join(folder,'先读我.txt'),`语境 Context Reader ${version}\r\n\r\nChrome：在 chrome://extensions 开启开发者模式，加载本目录的 dist。升级保留同一目录及扩展 ID，重新加载后刷新文章。\r\n\r\nAPI Key：设置中填写 Key、服务地址、模型名和协议；无需 Node.js。\r\nChatGPT 订阅：在设置点击 Continue with ChatGPT，本人在浏览器完成登录和订阅授权，无需脚本或本机服务。登录加密保存在本机，重启浏览器自动恢复。\r\n\r\nGoogle：设置中连接 Google Drive 并授权，随后自动同步。普通用户无需创建 Client ID。离线改动保留本机，确认上传后才显示已同步。\r\n\r\n已提交的解释任务在关闭文章后继续；完全退出 Chrome 会停止运行，未确认的已发送请求需要明确重试。\r\n\r\n自有代码 MIT；内含 DevKit 及其适配运行时保留非商业许可。详情见 LICENSE、THIRD_PARTY_NOTICES.md 与 README.md。\r\n`,'utf8');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();await writeFile(join(folder,'release-info.json'),JSON.stringify({version,commit,extensionId:'hndhiknbifkbmpebjflifdecfpcliddd',sourceFiles:files.length,includesNoncommercialDevKit:true},null,2)+'\n');
const zip=join(release,name+'.zip');await archiveDirectory(folder,zip);
const checksum=sha256(await readFile(zip));await writeFile(join(release,name+'.sha256'),checksum+'  '+name+'.zip\n');
console.log('Packaged: '+zip);console.log('SHA-256: '+checksum);
