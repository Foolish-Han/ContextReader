import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {slate} from '@radix-ui/colors';
import {icon} from '../src/ui/icons.mjs';
const root=resolve('.'),output=join(root,'extension/icons');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="128" height="128"><rect width="32" height="32" rx="10" fill="${slate.slate12}"/><g transform="translate(6 6) scale(.8333333333)" fill="none" stroke="${slate.slate1}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon('book').replace(/^<svg[^>]+>/,'').replace('</svg>','')}</g></svg>`;
await mkdir(output,{recursive:true});await writeFile(join(output,'context-reader.svg'),svg+'\n');
const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage();for(const size of [16,32,48,128]){await page.setViewportSize({width:size,height:size});await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);await page.screenshot({path:join(output,`icon-${size}.png`),omitBackground:true});}console.log('Rendered shared Lucide / Radix brand icons');}finally{await browser.close();}
