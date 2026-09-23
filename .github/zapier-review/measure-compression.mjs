// Offline experiment only. Never imports SDK execution or sends repository content.
import {snapshot,hash} from './worker.mjs';
import {getEncoding} from 'js-tiktoken';
import {writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const enc=getEncoding('o200k_base');
const count=s=>enc.encode(s,[],[]).length;
const {files,inventory,errors}=await snapshot();
if(errors.length)throw Error(JSON.stringify(errors));
mkdirSync('.luna-output',{recursive:true});
console.log(`Loaded ${files.size} text paths; computing lossless block reuse locally.`);
function blocks(text){
  const out=[];let start=0,size=0;
  for(let end=0;end<text.length;end++){
    size++;
    if(text[end]!=='\n')continue;
    const lineStart=text.lastIndexOf('\n',end-1)+1;
    let h=2166136261;for(let p=lineStart;p<end;p++)h=Math.imul(h^text.charCodeAt(p),16777619);
    if(size>=8192||(size>=512&&(h&31)===0)){out.push(text.slice(start,end+1));start=end+1;size=0;}
  }
  if(start<text.length)out.push(text.slice(start));
  return out;
}
const cache=new Map(),dictionary=new Map(),rows=[];
let n=0,rawTokens=0,wholeDedupTokens=0,blockTokens=0,rawBytes=0,uniqueBytes=0,referenceTokens=0;
const groups=new Map();
for(const f of files.values()){
  const digest=hash(f.text);let record=cache.get(digest);
  if(!record){
    const pieces=blocks(f.text);
    if(pieces.join('')!==f.text)throw Error('Lossless check failed '+f.path);
    const ids=[];let sourceTokens=0;
    for(const text of pieces){
      const key=hash(text);let block=dictionary.get(key);
      if(!block){block={id:dictionary.size,tokens:count(text),bytes:Buffer.byteLength(text)};dictionary.set(key,block);blockTokens+=block.tokens;uniqueBytes+=block.bytes;}
      ids.push(block.id);sourceTokens+=block.tokens;
    }
    record={tokens:sourceTokens,bytes:Buffer.byteLength(f.text),ids};cache.set(digest,record);wholeDedupTokens+=sourceTokens;
  }
  const refCost=count(JSON.stringify({path:f.path,blocks:record.ids}));referenceTokens+=refCost;
  rows.push({path:f.path,sha256:f.sha256,blocks:record.ids,tokens:record.tokens,bytes:record.bytes});
  rawTokens+=record.tokens;rawBytes+=record.bytes;
  const category=f.path.split('/').slice(0,3).join('/');
  const summary=groups.get(category)||{files:0,tokens:0,bytes:0};summary.files++;summary.tokens+=record.tokens;summary.bytes+=record.bytes;groups.set(category,summary);
  if(++n%2000===0)console.log(`Measured ${n}/${files.size} paths`);
}
const report={commit:execFileSync('git',['rev-parse','HEAD']).toString().trim(),textPaths:files.size,binaryPaths:inventory.filter(x=>x.kind==='binary').length,rawBytes,uniqueBlockBytes:uniqueBytes,rawTokens,wholeFileDedupTokens:wholeDedupTokens,uniqueBlockTokens:blockTokens,blockReferenceTokens:referenceTokens,uniqueBlocks:dictionary.size,roundtripVerifiedTextPaths:n,notes:['Token counts are sums of o200k_base counts per lossless block; actual Luna tokenizer and input limits are unverified.','Global dictionary savings are an optimistic diagnostic: each live model request must carry all referenced blocks.','No source paths, comments, whitespace or vendor/generated contents removed; no model called.'],largestGroups:[...groups].sort((a,b)=>b[1].tokens-a[1].tokens).slice(0,15)};
writeFileSync('.luna-output/compression-measurement.json',JSON.stringify(report,null,2));
writeFileSync('.luna-output/block-index.json',JSON.stringify({blocks:[...dictionary.values()],files:rows}));
console.log(JSON.stringify(report,null,2));
