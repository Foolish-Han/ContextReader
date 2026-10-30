import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {extensionId} from '../src/shared/extension-id.mjs';
import {createAuthService,publicError} from './service.mjs';
import {windowsCredentialEncryption} from './encryption.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function createAuthServer({origin,service,port=43821}={}){
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  const host='127.0.0.1:'+port;
  if(req.headers.host!==host){res.writeHead(403).end();return;}
  if(req.method==='GET'&&req.url==='/health'){
   if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403).end();return;}
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({provider:'context-reader-oauth',version:'0.4.0',inferenceProxy:false}));return;
  }
  if(req.headers.origin!==origin){res.writeHead(403).end();return;}
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Context-Reader'}).end();return;}
  const routes=new Set(['/session','/signin/start','/signin/poll','/signin/cancel','/profiles/select','/profiles/logout','/access']);
  if(req.method!=='POST'||!routes.has(req.url)||req.headers['x-context-reader']!=='1'||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(404).end();return;}
  try{
   let body='';for await(const part of req){body+=part.toString();if(Buffer.byteLength(body)>5000)throw new Error('请求内容过长。');}const input=JSON.parse(body||'{}');
   if(input.payload||input.messages||input.input||input.task)throw new Error('认证助手不接受模型推理请求。');
   let result;
   if(req.url==='/session')result=await service.state();
   if(req.url==='/signin/start')result=await service.begin({profileId:input.profileId,reconsent:!!input.reconsent});
   if(req.url==='/signin/poll')result=await service.poll(String(input.attemptId||''));
   if(req.url==='/signin/cancel')result=await service.cancel(String(input.attemptId||''));
   if(req.url==='/profiles/select')result=await service.select(String(input.profileId||''));
   if(req.url==='/profiles/logout')result=await service.disconnect(String(input.profileId||''));
   if(req.url==='/access'){const credential=await service.access(String(input.profileId||''));result={accessToken:credential.accessToken,profileId:credential.profileId};}
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,data:result}));
  }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:publicError(error)}));}
 });
 server.requestTimeout=90000;server.headersTimeout=10000;server.on('close',()=>service.close());return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const manifest=JSON.parse(await readFile(join(root,'dist/manifest.json'),'utf8')),origin='chrome-extension://'+extensionId(manifest.key),port=43821;
 const directory=join(process.env.LOCALAPPDATA||join(homedir(),'AppData/Local'),'ContextReader','OAuth');
 const service=createAuthService({directory,encryption:windowsCredentialEncryption()});
 const server=createAuthServer({origin,service,port});
 server.listen(port,'127.0.0.1',()=>{console.log('Context Reader 独立 OAuth 认证助手已启动：http://127.0.0.1:'+port);console.log('仅处理登录与加密凭据；不转发模型请求，不依赖 Codex。');});
 server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'43821 端口已被占用，请先停止旧版连接服务。':'认证助手无法启动。');process.exitCode=1;});
 const shutdown=()=>{service.close();server.close();setTimeout(()=>process.exit(0),1000).unref();};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
