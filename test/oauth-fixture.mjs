// Run only in an isolated extension worker. Manipulates synthetic encrypted
// credentials to exercise expiry/restart using Chrome's actual IndexedDB.
export async function inspectOAuthVault({replace,expire=false}={}){
 const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('context-reader-auth',1);request.onupgradeneeded=()=>request.result.createObjectStore('vault');request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});
 try{
  let key,record;await new Promise((resolve,reject)=>{const tx=db.transaction('vault','readonly'),store=tx.objectStore('vault'),k=store.get('key'),r=store.get('credentials');tx.oncomplete=()=>{key=k.result;record=r.result;resolve();};tx.onerror=()=>reject(tx.error);});
  const aad=new TextEncoder().encode('context-reader:oauth:v1');let value=replace;
  if(!value)value=record?JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:aad},key,record.bytes))):{};
  if(expire)for(const connection of Object.values(value))connection.expiresAt=Date.now()-1000;
  if(replace||expire){key??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);const iv=crypto.getRandomValues(new Uint8Array(12)),bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,new TextEncoder().encode(JSON.stringify(value))));record={version:1,iv,bytes};await new Promise((resolve,reject)=>{const tx=db.transaction('vault','readwrite'),store=tx.objectStore('vault');store.put(key,'key');store.put(record,'credentials');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
  return {accounts:Object.keys(value).length,keyExtractable:key?.extractable,encrypted:record?.bytes instanceof Uint8Array,containsPlainFixture:JSON.stringify(record).includes('BROWSER_FIXTURE')};
 }finally{db.close();}
}
