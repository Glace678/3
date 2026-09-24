// Offline, fixed-snapshot planning. No model or paid action is called here.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {getEncoding} from 'js-tiktoken';
import {snapshot,hash} from './worker.mjs';
import {reusableBlocks,reconstruct,renderCompactBlocks,compactBlockInstructions} from './lossless-blocks.mjs';
import {nativeInputs,MODEL} from './native-sdk.mjs';
const target=Number(process.argv[2]||850000),start=Number(process.argv[3]||18);
if(target<100000||target>950000||start<18)throw Error('Invalid bounded audit plan');
const root='.luna-output/validation',audit='.luna-output/full-audit';
const job=process.env.LUNA_JOB_CONFIG?JSON.parse(readFileSync(process.env.LUNA_JOB_CONFIG,'utf8')):null;
if(existsSync(`${audit}/schedule.json`))throw Error('Do not overwrite a fixed audit schedule');
mkdirSync(audit,{recursive:true});
const commit=execFileSync('git',['rev-parse','HEAD']).toString().trim();
const encoder=getEncoding('o200k_base'),count=s=>encoder.encode(s,[],[]).length;
const promptReserve=14000+count(job?job.policy+job.issue.title+(job.issue.body||''):'');
const {files,inventory,errors}=await snapshot();if(errors.length)throw Error(errors.join('\n'));
console.log(JSON.stringify({phase:'snapshot',commit,textFiles:files.size,inventory:inventory.length}));
const blocks=new Map(),byHash=new Map(),segments=[],empty=[];let rawTokens=0,processed=0;
const blockId=text=>{const h=hash(text);if(byHash.has(h)){const id=byHash.get(h);if(blocks.get(id).text!==text)throw Error('Hash collision');return id;}const id=blocks.size.toString(36),tokens=count(text);blocks.set(id,{id,text,tokens,bytes:Buffer.byteLength(text)});byHash.set(h,id);return id;};
for(const f of files.values()){
  if(!f.text){empty.push(f.path);continue;}
  const firstSegment=segments.length;
  const pieces=reusableBlocks(f.text).flatMap(piece=>{
    const out=[];for(let at=0;at<piece.length;){let end=Math.min(at+24000,piece.length);if(end<piece.length&&/[\uD800-\uDBFF]/.test(piece[end-1]))end--;out.push(piece.slice(at,end));at=end;}return out;
  });
  let offset=0,line=1,current=null;
  for(const text of pieces){
    const id=blockId(text),b=blocks.get(id);rawTokens+=b.tokens;
    if(current&&current.cost+b.tokens+18>target-90000){segments.push(current);current=null;}
    if(!current)current={file:f.path,sha256:f.sha256,encoding:f.encoding,start_char:offset,start_line:line,block_ids:[],cost:0};
    current.block_ids.push(id);current.cost+=b.tokens+18;
    offset+=text.length;line+=(text.match(/\n/g)||[]).length;
    current.end_char=offset;current.end_line=line-(text.endsWith('\n')?1:0);
  }
  if(current)segments.push(current);
  const rebuilt=segments.slice(firstSegment).map(s=>reconstruct(s,blocks)).join('');
  if(rebuilt!==f.text)throw Error('File coverage reconstruction mismatch: '+f.path);
  if(++processed%2000===0)console.log(JSON.stringify({phase:'dictionary',files:processed,blocks:blocks.size}));
}
const items=segments.map(({cost,...m})=>({m,ids:[...new Set(m.block_ids)],meta:count(JSON.stringify(m))+24}));
for(const item of items)item.cost=item.meta+item.ids.reduce((n,id)=>n+blocks.get(id).tokens+18,0);
const bins=[];
for(const item of items.sort((a,b)=>b.cost-a.cost||a.m.file.localeCompare(b.m.file))){
  let best=null,delta=0,score=Infinity;
  for(const bin of bins){
    const add=item.meta+item.ids.filter(id=>!bin.ids.has(id)).reduce((n,id)=>n+blocks.get(id).tokens+18,0);
    if(bin.cost+add>target-promptReserve)continue;
    const rank=(add<item.cost?-target:0)+(target-bin.cost-add);
    if(rank<score){best=bin;delta=add;score=rank;}
  }
  if(!best){if(item.cost>target-promptReserve)throw Error('Oversize dictionary segment');best={entries:[],ids:new Set(),cost:0};bins.push(best);delta=item.cost;}
  best.entries.push(item.m);item.ids.forEach(id=>best.ids.add(id));best.cost+=delta;
}
console.log(JSON.stringify({phase:'packed',batches:bins.length,rawTokens,dictionaryTokens:[...blocks.values()].reduce((n,b)=>n+b.tokens,0)}));
// Place simple positive controls at beginning/middle/end. They are not repo findings.
const controls=job?[
  {file:'validation-fixtures/overflow.c',category:'heap overflow',text:'#include <stdlib.h>\n#include <string.h>\nchar *audit_copy(const char *s){char *p=malloc(strlen(s));if(p)strcpy(p,s);return p;}\n'},
  {file:'validation-fixtures/null.c',category:'null dereference',text:'#include <stddef.h>\nint audit_null(void){int *p=NULL;return *p;}\n'},
  {file:'validation-fixtures/double.c',category:'double free',text:'#include <stdlib.h>\nvoid audit_free(void){char *p=malloc(16);if(!p)return;free(p);free(p);}\n'}
]:JSON.parse(readFileSync(`${root}/010-quality/expected-quality.json`,'utf8')).filter((_,i)=>[0,5,6].includes(i));
const controlEntries=controls.map(f=>({file:f.file,start_line:1,end_line:(f.text.match(/\n/g)||[]).length,start_char:0,end_char:f.text.length,sha256:hash(f.text),encoding:'utf-8',block_ids:[blockId(f.text)]}));
const schedule=[];
for(let i=0;i<bins.length;i++){
  const id=String(start+i).padStart(3,'0')+'-audit',dir=`${root}/${id}`;
  if(existsSync(`${dir}/inputs.json`)||existsSync(`${dir}/source.txt`))throw Error('Existing audit batch');
  const original=bins[i].entries,mid=Math.floor(original.length/2),entries=[controlEntries[0],...original.slice(0,mid),controlEntries[1],...original.slice(mid),controlEntries[2]];
  const view=renderCompactBlocks(entries,blocks);
  const inputs={...nativeInputs({mode:'review',repo:'Glace678/3',commit,manifest:entries,source:view.source,issue:{title:'[review] Complete repository audit, fixed snapshot batch '+(i+1),body:'Audit all supplied original code including third-party, generated source, tests and config. Do not omit any supplied file or line. Report independently actionable correctness/security defects with exact evidence; do not invent caller behavior. This is one batch of a larger full repository audit. Request exact missing paths if needed. validation-fixtures are isolated quality checks, not repository changes. In transport_checks_json return the exact begin/middle/end values read in the attachment. If input or findings cannot be processed completely return incomplete.'}}),tools:'[]',knowledgeSources:'[]'};
  inputs.instructions+=compactBlockInstructions+' Also return transport_checks_json. Each finding must include evidence: an exact contiguous source substring, preserving whitespace, unique within its file. Evidence anchors claims; it does not prove correctness. Report all actionable findings, not a top-N list.';
  if(job){
    Object.assign(inputs.inputFields,{mode:job.mode,issue_title:job.issue.title,issue_body:job.issue.body||''});
    inputs.instructions+=' Owner configuration: '+job.policy+' Respond in Chinese. All JSON must parse: escape quotation marks inside code strings; line is an integer or null, never an approximate numeric literal. Always provide separate exact evidence strings. Validation fixtures are isolated checks and must never be patched.';
  }
  inputs.inputFields.manifest_entry_count=String(entries.length);inputs.inputFields.last_manifest_index=String(entries.length-1);
  inputs.instructions+=` There are exactly ${entries.length} manifest entries, inclusive indices 0 through ${entries.length-1}. Full coverage, only after actual review, is [[0,${entries.length-1}]]. Copy manifest_sha256 ${inputs.inputFields.manifest_sha256} exactly.`;
  inputs.outputFields=JSON.stringify([...JSON.parse(inputs.outputFields),{name:'transport_checks_json',type:'text',isRequired:true,description:'JSON object with exact begin, middle, end transport markers.'}]);
  const rawInputTokens=count(view.source)+count(inputs.inputFields.manifest_json)+count(inputs.instructions)+count(inputs.inputFields.issue_title+inputs.inputFields.issue_body)+5000;
  if(rawInputTokens>target)throw Error(`Exact rendered input exceeds target: ${id} ${rawInputTokens}`);
  mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/source.txt`,view.source);writeFileSync(`${dir}/pending-inputs.json`,JSON.stringify(inputs));
  writeFileSync(`${dir}/expected-transport.json`,JSON.stringify(view.checks));writeFileSync(`${dir}/expected-quality.json`,JSON.stringify(controls));
  const plan={id,model:MODEL,commit,files:entries.length,repositorySegments:original.length,rawInputTokens,estimatedInputTokens:rawInputTokens,targetTokens:target,representation:'compact lossless source block dictionary',attachmentBytes:Buffer.byteLength(view.source),attachmentSha256:hash(view.source),purpose:'Review a complete nonoverlapping fixed-snapshot repository batch while checking compact lossless transport and simple defect recall.',scope:'Full text inventory partition; no text file types excluded',batchIndex:i+1,batchCount:bins.length};
  writeFileSync(`${dir}/plan.json`,JSON.stringify(plan,null,2));schedule.push({id,...plan});
  console.log(JSON.stringify({phase:'rendered',id,rawInputTokens,segments:original.length}));
}
// Independent total character coverage: every nonempty text file exactly once.
for(const f of files.values()){
  const own=segments.filter(s=>s.file===f.path).sort((a,b)=>a.start_char-b.start_char);let next=0;
  for(const s of own){if(s.start_char!==next)throw Error('Missing/overlapping source chars');next=s.end_char;}
  if(next!==f.text.length)throw Error('Incomplete source partition');
}
writeFileSync(`${audit}/inventory.json`,JSON.stringify({commit,inventory,emptyTextFiles:empty,sourceReconstructionVerified:true},null,2));
writeFileSync(`${audit}/schedule.json`,JSON.stringify({commit,rawTokens,uniqueBlockTokens:[...blocks.values()].reduce((n,b)=>n+b.tokens,0),target,emptyTextFiles:empty.length,totalBatches:bins.length,schedule},null,2));
console.log(JSON.stringify({phase:'complete',batches:bins.length,textFiles:files.size,binaryFiles:inventory.filter(f=>f.kind==='binary').length,emptyTextFiles:empty.length,modelRequests:0}));
