import {readFile,writeFile,mkdir} from 'node:fs/promises';
const {version}=JSON.parse(await readFile('package.json','utf8'));const changelog=await readFile('CHANGELOG.md','utf8'),section=changelog.split(new RegExp('^## '+version.replaceAll('.','\\.')+'[^\\n]*\\n','m'))[1]?.split(/^## /m)[0]?.trim();
if(!section)throw new Error('Current version is missing from CHANGELOG.md');
await mkdir('.local',{recursive:true});await writeFile('.local/release-notes.md',`${section}\n\n### 安装\n\n下载 ZIP，解压到固定目录，在 Chrome 开发者模式加载其中的 dist。API Key 模式无需 Node.js；ChatGPT 订阅需要 Windows / Node.js 22+ 并运行 start-auth.cmd。\n\n自有代码 MIT，内含 DevKit 及适配运行时保留非商业许可，详见 THIRD_PARTY_NOTICES.md。回归使用模拟服务，不宣称已完成真实两设备恢复验收。\n\n同页 .sha256 提供 ZIP 的 SHA-256。\n`);
console.log('Generated .local/release-notes.md');
