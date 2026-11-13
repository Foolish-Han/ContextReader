import {keyOf, norm} from '../shared/core.mjs';

// Search only reader-facing knowledge, never JSON keys, IDs, timestamps or URLs.
// A direct expression match should remain above incidental matches in history.
export function searchKnowledge(snapshot,view,query){
 const needle=keyOf(query),contexts=new Map();
 if(view==='entries')for(const context of snapshot.contexts){const group=contexts.get(context.entryId)||[];group.push(context);contexts.set(context.entryId,group);}
 const match=(item)=>{
  if(!needle)return {score:0};
  let best=null;
  const check=(value,score,label='',exactScore=score)=>{
   if(typeof value!=='string')return;const normalized=keyOf(value),at=normalized.indexOf(needle);if(at<0)return;
   const rank=normalized===needle?exactScore:score;if(!best||rank<best.score)best={score:rank,label,text:value};
  };
  if(view==='entries'){
   check(item.canonical,2,'',0);
   if(keyOf(item.canonical).startsWith(needle)&&keyOf(item.canonical)!==needle)check(item.canonical,1);
   for(const alias of item.aliases||[])check(alias,3,'匹配词形',1);
   for(const meaning of item.baseMeanings||[])check(meaning,4);
   check(item.note,5,'匹配释义');
   for(const context of contexts.get(item.id)||[]){check(context.meaning,6,'匹配语境');check(context.explanation,6,'匹配语境');check(context.sentence,7,'匹配原句');check(context.context,7,'匹配原文');}
   check(item.learning?.usage,8,'匹配用法');check(item.learning?.memory,8,'匹配记忆');
   for(const example of item.learning?.examples||[]){check(example.english,8,'匹配例句');check(example.chinese,8,'匹配例句');}
  }else{
   check(item.text,1,'匹配原文',0);check(item.meaning,2);check(item.explanation,3,'匹配释义');check(item.context,4,'匹配原文');
  }
  return best;
 };
 return (view==='entries'?snapshot.entries:snapshot.snippets).map(item=>({item,match:match(item)})).filter(result=>result.match).sort((a,b)=>a.match.score-b.match.score||String(b.item.updatedAt||b.item.createdAt||'').localeCompare(String(a.item.updatedAt||a.item.createdAt||'')));
}

export function matchExcerpt(value,query){
 const text=norm(value),at=keyOf(text).indexOf(keyOf(query));if(at<0)return text.slice(0,140);
 const start=Math.max(0,at-45),end=Math.min(text.length,at+norm(query).length+75);
 return (start?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
}
