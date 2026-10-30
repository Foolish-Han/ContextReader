import {readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extensionId} from '../src/shared/extension-id.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
console.log(extensionId(JSON.parse(await readFile(join(root,'dist','manifest.json'),'utf8')).key));
