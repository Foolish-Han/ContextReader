import test from 'node:test';import assert from 'node:assert/strict';
import {createCredentialVault} from '../src/background/oauth-vault.mjs';
function fixture(){let saved={},fail=false;const adapter={async read(){return structuredClone(saved);},async write(value){if(fail)throw new Error('Synthetic disk failure');saved=structuredClone(value);}};return {vault:createCredentialVault({adapter}),adapter,saved:()=>saved,fail:()=>fail=true};}
test('encrypted credentials survive a new vault instance with a nonextractable persistent key',async()=>{
 const f=fixture(),credentials={reader:{accessToken:'ACCESS_FIXTURE',refreshToken:'REFRESH_FIXTURE',idToken:'ID_FIXTURE'}};assert.deepEqual(await f.vault.read(),{});await f.vault.write(credentials);assert.deepEqual(await createCredentialVault({adapter:f.adapter}).read(),credentials);assert.equal(f.saved().key.extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',f.saved().key));assert.equal(JSON.stringify(f.saved()).includes('REFRESH_FIXTURE'),false);
});
test('tampered ciphertext and failed writes preserve the original record',async()=>{
 const f=fixture();await f.vault.write({reader:{refreshToken:'FIRST_FIXTURE'}});const original=structuredClone(f.saved());f.fail();await assert.rejects(f.vault.write({reader:{refreshToken:'NEXT_FIXTURE'}}));assert.deepEqual(f.saved().record,original.record);assert.deepEqual(await f.vault.read(),{reader:{refreshToken:'FIRST_FIXTURE'}});f.saved().record.bytes[0]^=1;const tampered=structuredClone(f.saved().record);await assert.rejects(f.vault.read(),/现有数据已保留/);assert.deepEqual(f.saved().record,tampered);
});
