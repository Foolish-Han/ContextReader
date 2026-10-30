import {readFile,stat,lstat} from 'node:fs/promises';
import {resolve,dirname,relative,join,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validatePublishedPaths,assertNoSecrets,sha256} from './publication.mjs';
import {validateGoogleRelease} from './google-config.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=validatePublishedPaths(execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));
if(!files.length)throw new Error('No tracked publication files. Stage the intended source before verification.');
const tracked=new Set(files),texts=new Set(['.md','.json','.js','.mjs','.ts','.txt','.ps1','.cmd','.html','.yml','.yaml','.css','.svg','.tap']);
for(const file of files){const p=join(root,file);if((await lstat(p)).isSymbolicLink())throw new Error('Symlinks need explicit publication review: '+file);if(texts.has(extname(file))||['LICENSE','.gitignore','.gitattributes'].includes(file))assertNoSecrets(file,await readFile(p,'utf8'));}
for(const file of ['README.md','LICENSE','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','.github/workflows/ci.yml','.github/workflows/release.yml'])if(!tracked.has(file))throw new Error('Required project file not tracked: '+file);
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8')),manifest=JSON.parse(await readFile(join(root,'dist/manifest.json'),'utf8')),google=JSON.parse(await readFile(join(root,'extension/google-oauth.json'),'utf8'));
if(pkg.version!==lock.version||pkg.version!==lock.packages[''].version||pkg.version!==manifest.version)throw new Error('Package, lockfile and build versions differ');
validateGoogleRelease(manifest,google.clientId);
if(process.env.GITHUB_REF_TYPE==='tag'&&process.env.GITHUB_REF_NAME!=='v'+pkg.version)throw new Error('Release tag does not match the package version');
const upstream=JSON.parse(await readFile(join(root,'vendor/siwc-local/UPSTREAM.json'),'utf8'));
for(const item of upstream.files){const p=join(root,'vendor/siwc-local',item.path);if(sha256(await readFile(p))!==item.sha256)throw new Error('Pinned upstream file changed: '+item.path);}
let links=0;
for(const file of files.filter(f=>extname(f)==='.md'&&(f.startsWith('docs/')||!f.includes('/')))){
 const markdown=await readFile(join(root,file),'utf8');
 for(const match of markdown.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)){
  let url=match[1].replace(/^<|>$/g,'');if(/^[a-z][a-z0-9+.-]*:/i.test(url)||url.startsWith('#'))continue;url=url.split('#')[0];if(!url)continue;
  const target=resolve(dirname(join(root,file)),decodeURIComponent(url)),path=relative(root,target).replaceAll('\\','/');
  if(path.startsWith('..')||!tracked.has(path))throw new Error('Unpublished local link from '+file+': '+url);
  await stat(target);links++;
 }
}
console.log(`Publication verified: ${files.length} tracked files, ${links} local links, ${upstream.files.length} pinned upstream files, version ${pkg.version}.`);
