import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const script=join(dirname(fileURLToPath(import.meta.url)),'dpapi.ps1');
function transform(mode,value){return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Mode',mode],{stdio:['pipe','pipe','pipe'],windowsHide:true});let output='',errorBytes=0;child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{output+=part;if(output.length>3*1024*1024)child.kill();});child.stderr.on('data',part=>{errorBytes+=part.length;});child.on('error',()=>reject(new Error('Windows 凭据保护服务无法启动。')));child.on('exit',code=>code===0&&output?resolve(output):reject(new Error('Windows 无法保护或解密本应用的凭据；原文件已保留。')));child.stdin.end(value);});}
export function windowsCredentialEncryption(){return {id:'windows-dpapi-current-user-v1',isAvailable:()=>process.platform==='win32',encrypt:async plain=>Buffer.from(await transform('protect',plain),'base64'),decrypt:cipher=>transform('unprotect',Buffer.from(cipher).toString('base64'))};}
