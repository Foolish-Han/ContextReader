import {createHash} from 'node:crypto';
export const PUBLIC_DOCS=new Set(['architecture.md','development.md','releases.md','roadmap.md','privacy.md','troubleshooting.md','ui-review.md','model-calling.md','google-sync-setup.md']);
const forbiddenDirectories=new Set(['.git','.local','node_modules','test-results','release','coverage','oauth-vault','trial-profile']);
export function validatePublishedPaths(files){
 for(const file of files){
  const path=file.replaceAll('\\','/'),parts=path.split('/');
  if(path!==file||path.startsWith('/')||/^[A-Za-z]:/.test(path)||parts.includes('..')||parts.some(part=>forbiddenDirectories.has(part.toLowerCase())))throw new Error('Private/runtime path cannot be published: '+file);
  if(path.startsWith('dist/')||path==='auth/siwc-runtime.mjs'||path.startsWith('vendor/siwc-local/dist/'))throw new Error('Generated file cannot be committed: '+file);
  if(/(?:^|\/)(?:\.env(?:\..*)?|credentials\.json|tokens?\.json)$|\.(?:pem|pfx|p12)$/i.test(path)&&!path.endsWith('.env.example'))throw new Error('Credential filename cannot be published: '+file);
  if(path.startsWith('docs/')){const relative=path.slice(5);if(!PUBLIC_DOCS.has(relative)&&!relative.startsWith('assets/v0.7/')&&!/^verification\/(?:project-v0\.7\.tap|(?:ui|cloud|async|auto-enable)-v0\.7\.json)$/.test(relative))throw new Error('Document is outside the public allowlist: '+file);}
 }
 return [...new Set(files)];
}
const secretPatterns=[['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['GitHub token',/\b(?:ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],['API key',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{28,}\b/],['JWT',/\beyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/]];
export function assertNoSecrets(path,text){for(const [kind,pattern] of secretPatterns)if(pattern.test(text))throw new Error(kind+' pattern found in '+path+' (content omitted)');}
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
