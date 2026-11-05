import test from 'node:test';import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
import {unzipSync,strFromU8} from 'fflate';import {archiveDirectory} from '../scripts/archive.mjs';
test('release ZIP preserves nested files, UTF-8 names, empty files and binary bytes on every platform',async()=>{
 const base=resolve('test-results');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'archive-')),source=join(root,'source');await mkdir(join(source,'dist'),{recursive:true});await writeFile(join(source,'先读我.txt'),'语境安装说明');await writeFile(join(source,'dist','empty.txt'),'');await writeFile(join(source,'dist','icon.bin'),new Uint8Array([0,255,13,10]));const bytes=await archiveDirectory(source,join(root,'result.zip'),{prefix:'context-reader-test'}),files=unzipSync(bytes);assert.equal(strFromU8(files['context-reader-test/先读我.txt']),'语境安装说明');assert.equal(files['context-reader-test/dist/empty.txt'].length,0);assert.deepEqual(files['context-reader-test/dist/icon.bin'],new Uint8Array([0,255,13,10]));await assert.rejects(archiveDirectory(source,join(root,'bad.zip'),{prefix:'../escape'}));
});
