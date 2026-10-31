import {readFile,readdir,lstat,writeFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {zipSync} from 'fflate';
export async function archiveDirectory(directory,output,{prefix=basename(directory)}={}){
 if(!/^[\w.-]+$/.test(prefix)||prefix==='.'||prefix==='..')throw new Error('Invalid archive prefix');
 const files=Object.create(null);
 async function visit(path,relative){for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const source=join(path,entry.name),name=relative+'/'+entry.name;if((await lstat(source)).isSymbolicLink())throw new Error('Archive must not contain symlinks');if(entry.isDirectory())await visit(source,name);else files[name]=new Uint8Array(await readFile(source));}}
 await visit(directory,prefix);const bytes=zipSync(files,{level:6,mtime:new Date('2000-01-01T00:00:00Z')});await writeFile(output,bytes);return bytes;
}
