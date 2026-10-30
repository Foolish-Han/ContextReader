import {build} from 'esbuild';
import {readdir,mkdir} from 'node:fs/promises';
await mkdir('vendor/siwc-local/dist',{recursive:true});const entries=(await readdir('vendor/siwc-local/upstream')).filter(n=>n.endsWith('.ts')).map(n=>'vendor/siwc-local/upstream/'+n);
await build({entryPoints:entries,outdir:'vendor/siwc-local/dist',platform:'node',format:'esm',target:'node22',logLevel:'warning'});
