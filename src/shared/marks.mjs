import {amber,teal,slate,orange,red} from '@radix-ui/colors';

// Opaque colors keep page ink legible regardless of the site's own theme.
// The underline carries meaning even when colors are hard to distinguish.
export const markTypes={
 passage:{label:'已解句段',sample:'a saved sentence',background:teal.teal5,ink:teal.teal12,line:'solid',priority:0},
 known:{label:'已收录单词',sample:'word',background:amber.amber9,ink:amber.amber12,line:'solid',priority:1},
 phrase:{label:'短语与复合词',sample:'full expression',background:amber.amber9,ink:amber.amber12,line:'double',priority:2},
 pending:{label:'排队或生成中',sample:'generating',background:slate.slate5,ink:slate.slate12,line:'dotted',priority:3},
 suggestion:{label:'建议补全范围',sample:'full expression',background:orange.orange4,ink:orange.orange12,line:'dashed',priority:4},
 confirm:{label:'待确认，尚未收录',sample:'selected',background:orange.orange9,ink:slate.slate12,line:'double',priority:5},
 attention:{label:'失败或中断，需处理',sample:'needs attention',background:red.red4,ink:red.red12,line:'wavy',priority:5}
};
export const markStyle=kind=>{const m=markTypes[kind];return `background-color:${m.background};color:${m.ink};text-decoration:underline ${m.line} ${m.ink} 2px;text-underline-offset:3px;text-shadow:none;`;};
export const taskMark=state=>state==='confirm'?'confirm':['queued','preparing','running'].includes(state)?'pending':'attention';
