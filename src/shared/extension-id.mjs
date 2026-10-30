import {createHash} from 'node:crypto';
export function extensionId(key){return [...createHash('sha256').update(Buffer.from(key,'base64')).digest().subarray(0,16)].flatMap(b=>[b>>4,b&15]).map(n=>String.fromCharCode(97+n)).join('');}
