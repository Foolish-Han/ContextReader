// The injected DevKit modification below is licensed under the Sign-in with ChatGPT
// DevKit Noncommercial License v1.0 (vendor/siwc-local/LICENSE); orchestration is MIT.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),upstream=join(root,'vendor/siwc-local/upstream');
const original=await readFile(join(upstream,'index.ts'),'utf8');
const needle='    async listModels(options = {}) { return authenticated(listModels, options.signal); },';
if(original.split(needle).length!==2)throw new Error('Pinned DevKit adaptation point changed. Review before building.');
const source=original.replace(needle,`    // Context Reader adaptation: privileged extension-worker credential broker.
    // It never returns refresh/ID tokens and never accepts inference payloads.
    async acquireAccessToken(expectedProfileId: string, options: { signal?: AbortSignal } = {}) {
      return authenticated(async (accessToken) => {
        const session = snapshot();
        if (!expectedProfileId || session.profileId !== expectedProfileId) {
          throw new ChatGPTError("account_mismatch", "The active ChatGPT account changed. Select the account again.");
        }
        return { accessToken, profileId: session.profileId };
      }, options.signal);
    },
${needle}`);
await mkdir(join(root,'auth'),{recursive:true});
await build({stdin:{contents:source,resolveDir:upstream,sourcefile:'index.context-reader.ts',loader:'ts'},bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',outfile:join(root,'auth/siwc-runtime.mjs'),banner:{js:'// OpenAI Sign-in with ChatGPT DevKit, pinned source and adaptation in vendor/siwc-local.\n// Noncommercial License v1.0: see vendor/siwc-local/LICENSE.'}});
console.log('Built independent ChatGPT OAuth runtime (no Codex).');
