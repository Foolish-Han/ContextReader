// OAuth credentials are separate from the knowledge database and all export/sync paths.
const DB='context-reader-auth',STORE='vault';
const aad=new TextEncoder().encode('context-reader:oauth:v1');
const unavailable=()=>Object.assign(new Error('无法读取或保存本机登录凭据。现有数据已保留，请重试。'),{code:'credential_storage_unavailable'});
export function indexedCredentialAdapter(indexedDB=globalThis.indexedDB){
 let opening;
 async function database(){
  opening??=new Promise((resolve,reject)=>{
   const request=indexedDB.open(DB,1);
   request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
   request.onerror=()=>reject(unavailable());request.onblocked=()=>reject(unavailable());
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=undefined;};resolve(db);};
  }).catch(error=>{opening=undefined;throw error;});return opening;
 }
 return {
  async read(){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE),key=store.get('key'),record=store.get('credentials');tx.oncomplete=()=>resolve({key:key.result,record:record.result});tx.onerror=tx.onabort=()=>reject(unavailable());});},
  async write(value){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);store.put(value.key,'key');store.put(value.record,'credentials');tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(unavailable());});}
 };
}
export function createCredentialVault({adapter=indexedCredentialAdapter(),crypto=globalThis.crypto}={}){
 return {
  async read(){
   try{const {key,record}=await adapter.read();if(!record)return {};
    if(!key||record.version!==1||!(record.iv instanceof Uint8Array)||!(record.bytes instanceof Uint8Array))throw unavailable();
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:aad},key,record.bytes),value=JSON.parse(new TextDecoder().decode(plain));
    if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();return value;
   }catch{throw unavailable();}
  },
  async write(connections){
   try{const previous=await adapter.read();if(previous.record&&!previous.key)throw unavailable();
    const key=previous.key||await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const iv=crypto.getRandomValues(new Uint8Array(12)),bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,new TextEncoder().encode(JSON.stringify(connections))));
    await adapter.write({key,record:{version:1,iv,bytes}});
   }catch{throw unavailable();}
  }
 };
}
