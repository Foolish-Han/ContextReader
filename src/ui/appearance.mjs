import {icon} from './icons.mjs';

const modes=['system','light','dark'],names={system:'跟随系统',light:'浅色',dark:'深色'},media=matchMedia('(prefers-color-scheme: dark)');
let preference='system',settleFrame;
function apply(){document.documentElement.classList.add('theme-changing');cancelAnimationFrame(settleFrame);const theme=preference==='system'?(media.matches?'dark':'light'):preference;document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.classList.toggle('light',theme==='light');refreshControls();document.dispatchEvent(new CustomEvent('cr-appearance',{detail:theme}));settleFrame=requestAnimationFrame(()=>{settleFrame=requestAnimationFrame(()=>document.documentElement.classList.remove('theme-changing'));});}
function refreshControls(){document.querySelectorAll('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===preference)));document.querySelectorAll('[data-theme-toggle]').forEach(button=>{const dark=document.documentElement.dataset.theme==='dark';button.innerHTML=icon(dark?'sun':'moon');button.title=dark?'切换浅色':'切换深色';button.setAttribute('aria-label',button.title);});}
export async function setAppearance(value){if(!modes.includes(value))return;preference=value;apply();await chrome.storage.local.set({appearance:value});}
export function themeButton(){const dark=document.documentElement.dataset.theme==='dark';return `<button type="button" class="icon-button theme-toggle" data-theme-toggle aria-label="${dark?'切换浅色':'切换深色'}" title="${dark?'切换浅色':'切换深色'}">${icon(dark?'sun':'moon')}</button>`;}
export function appearanceChoices(){return `<div class="appearance-choices" role="group" aria-label="界面外观">${modes.map(mode=>`<button type="button" data-theme-choice="${mode}" aria-pressed="${preference===mode}">${icon(mode==='light'?'sun':mode==='dark'?'moon':'system')}<span>${names[mode]}</span></button>`).join('')}</div>`;}
apply();
void chrome.storage.local.get('appearance').then(data=>{preference=modes.includes(data.appearance)?data.appearance:'system';apply();}).catch(()=>{});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.appearance){preference=modes.includes(changes.appearance.newValue)?changes.appearance.newValue:'system';apply();}});
media.addEventListener('change',()=>{if(preference==='system')apply();});
document.addEventListener('click',event=>{const button=event.target.closest('[data-theme-choice],[data-theme-toggle]');if(!button)return;void setAppearance(button.dataset.themeChoice||(document.documentElement.dataset.theme==='dark'?'light':'dark'));});
