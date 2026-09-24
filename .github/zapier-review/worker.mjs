// All inference uses Zapier-managed Luna through the official Zapier SDK.
// No local model or external model-provider API is used.
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {getEncoding} from 'js-tiktoken';
import {createZapierSdk} from '@zapier/zapier-sdk';
import iconv from 'iconv-lite';
import {requireFreeSdk,nativeInputs,executeNative,validateCompactCoverage} from './native-sdk.mjs';
import {storeResult,loadResult} from './result-store.mjs';
import {journalFetch} from './request-journal.mjs';

export function conservativeCallCap(configuredCalls,taskCeiling){
  if(!Number.isSafeInteger(configuredCalls)||configuredCalls<1||configuredCalls>1000)throw new Error('Invalid model-call ceiling');
  if(!Number.isSafeInteger(taskCeiling)||taskCeiling<0||taskCeiling>49)throw new Error('Production task reservation must remain below 50');
  // This worker is fixed to native Standard Luna: reserve 1 task per call.
  // SDK beta observations never reduce that reservation to zero.
  return Math.min(configuredCalls,taskCeiling);
}

export const hash = s => createHash('sha256').update(s).digest('hex');
const git = (...args) => execFileSync('git',args,{maxBuffer:512*1024*1024});
const enc = getEncoding('o200k_base');
const tokens = s => enc.encode(s,[],[]).length;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const sourceExtension = /\.(?:[cm]?[jt]sx?|[ch](?:pp|xx|h)?|cs|fs|vb|java|kt|kts|py|pyw|rs|go|rb|php|swift|m|mm|lua|sql|sh|bash|ps1|bat|cmd|vue|svelte|html?|css|scss|sass|less|xml|json|ya?ml|toml|ini|conf|config|cmake|gradle|proto|asm|s|r|jl|pl|exs?|erl|hrl|clj|dart|pas|dpr|dfm)$/i;

export function decodeFile(path, bytes, declaredBinary=false) {
  // This repository documents BMD as encrypted game assets in MuMain/.gitattributes.
  // Localisation build copies outside MuMain retain the same binary format.
  if(/\.bmd$/i.test(path))return null;
  if(declaredBinary){
    if(sourceExtension.test(path))throw new Error(`Source file declared binary requires inspection: ${path}`);
    return null;
  }
  if (bytes.subarray(0,100).toString().startsWith('version https://git-lfs.github.com/spec/'))
    throw new Error(`LFS pointer requires materialization: ${path}`);
  let text, encoding='utf-8';
  try {
    if(bytes[0]===255 && bytes[1]===254){encoding='utf-16le';text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}
    else if(bytes[0]===254 && bytes[1]===255){encoding='utf-16be';text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}
    else if(bytes.includes(0)) {if(sourceExtension.test(path)) throw new Error('binary source'); return null;}
    else text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  } catch {
    // Confirmed legacy Korean source and Western upstream author/UI strings.
    const candidate=/\.html?$/i.test(path)&&/charset\s*=\s*["']?iso-8859-1/i.test(bytes.subarray(0,2048).toString('ascii'))?'iso-8859-1':path.startsWith('MuMain/src/source/')?'cp949':
      /MuMain\/src\/ThirdParty\/SDL_mixer\/external\/(flac\/src\/(plugin_common\/replaygain\.[ch]|plugin_xmms\/fileinfo\.c)|libxmp\/src\/mkstemp\.c|wavpack\/xmms\/src\/ui\.cpp)$/.test(path)?'windows1252':null;
    if(candidate){
      const decoded=iconv.decode(bytes,candidate);
      if(iconv.encode(decoded,candidate).equals(bytes))return {text:decoded,encoding:candidate};
    }
    if(sourceExtension.test(path))throw new Error(`Unresolved source encoding: ${path}`);
    if(bytes.includes(0))return null;
    // Preserve every non-ASCII byte in non-source fixtures/docs; never silently discard it.
    return {text:[...bytes].map(b=>b>=128?'\\x'+b.toString(16).padStart(2,'0'):String.fromCharCode(b)).join(''),encoding:'byte-escaped-unknown'};
  }
  return {text,encoding};
}

export function splitFile(file,maxTokens=650000,maxBytes=4000000) {
  const lines=file.text.match(/[^\n]*\n|[^\n]+$/g)||[];
  if(!lines.length)return [];
  const output=[];
  function split(lo,hi){
    const text=lines.slice(lo,hi).join('');
    if(Buffer.byteLength(text)>maxBytes || tokens(text)>maxTokens){
      if(hi-lo===1)throw new Error(`A single line exceeds the input limit: ${file.path}:${lo+1}`);
      const mid=lo+Math.floor((hi-lo)/2);split(lo,mid);split(mid,hi);return;
    }
    output.push({file:file.path,start_line:lo+1,end_line:hi,sha256:file.sha256,encoding:file.encoding,text});
  }
  split(0,lines.length);return output;
}

export function validateCoverage(expected,reported){
  if(!Array.isArray(reported))throw new Error('Coverage is not an array');
  for(const e of expected){
    let next=e.start_line;
    const spans=reported.filter(r=>r.file===e.file).sort((a,b)=>a.start_line-b.start_line);
    for(const r of spans){
      if(!Number.isSafeInteger(r.start_line)||!Number.isSafeInteger(r.end_line)||r.start_line>r.end_line)throw new Error('Invalid coverage range');
      if(r.start_line<=next)next=Math.max(next,r.end_line+1);
    }
    if(next<=e.end_line)throw new Error(`Incomplete coverage: ${e.file}:${next}-${e.end_line}`);
  }
}

export function applyEdits(files,edits){
  const changed=new Map();
  const spans=new Map();
  const seen=new Set();
  for(const edit of edits){
    const p=edit.path;
    if(typeof p!=='string'||p.startsWith('/')||p.includes('\\')||p.split('/').some(x=>x==='..'||x==='.git'))throw new Error(`Forbidden patch path: ${p}`);
    const original=files.get(p);
    if(!original || !['utf-8','cp949','windows1252','iso-8859-1'].includes(original.encoding))throw new Error(`Unsupported patch encoding/path: ${p}`);
    if(typeof edit.old_text!=='string'||!edit.old_text||typeof edit.new_text!=='string')throw new Error(`Invalid edit: ${p}`);
    const signature=hash(JSON.stringify([p,edit.old_text,edit.new_text]));
    if(seen.has(signature))continue;seen.add(signature);
    const at=original.text.indexOf(edit.old_text),end=at+edit.old_text.length;
    if(at<0 || original.text.indexOf(edit.old_text,at+1)>=0)throw new Error(`Missing/ambiguous/conflicting old_text: ${p}`);
    const ranges=spans.get(p)||[];
    if(ranges.some(r=>at<r.end&&end>r.at))throw new Error(`Overlapping edits: ${p}`);
    ranges.push({at,end,text:edit.new_text});spans.set(p,ranges);
  }
  for(const [p,ranges] of spans){
    let current=files.get(p).text;
    for(const r of ranges.sort((a,b)=>b.at-a.at))current=current.slice(0,r.at)+r.text+current.slice(r.end);
    changed.set(p,current);
  }
  return changed;
}

export function encodeEdit(text,encoding){
  if(encoding==='utf-8')return Buffer.from(text,'utf8');
  const bytes=iconv.encode(text,encoding);
  if(iconv.decode(bytes,encoding)!==text)throw new Error(`Edit is not representable in ${encoding}`);
  return bytes;
}

export function streamReader(stream){
  const iterator=stream[Symbol.asyncIterator]();let data=Buffer.alloc(0),offset=0;
  async function fill(){if(offset<data.length)return;const next=await iterator.next();if(next.done)throw new Error('Unexpected end of Git blob stream');data=next.value;offset=0;}
  return {
    async line(){const pieces=[];for(;;){await fill();const end=data.indexOf(10,offset);if(end>=0){pieces.push(data.subarray(offset,end));offset=end+1;return Buffer.concat(pieces).toString('ascii');}pieces.push(data.subarray(offset));offset=data.length;}},
    async bytes(size){if(!Number.isSafeInteger(size)||size<0||size>512*1024*1024)throw new Error('Blob exceeds the explicit 512 MiB processing limit');const out=Buffer.allocUnsafe(size);let at=0;while(at<size){await fill();const n=Math.min(size-at,data.length-offset);data.copy(out,at,offset,offset+n);at+=n;offset+=n;}return out;}
  };
}

export async function snapshot(){
  const files=new Map(),inventory=[],errors=[];
  const entries=git('ls-tree','-rz','HEAD').toString('utf8').split('\0').filter(Boolean);
  const paths=entries.map(e=>e.slice(e.indexOf('\t')+1));
  const attributes=execFileSync('git',['check-attr','--cached','-z','--stdin','text'],{input:paths.join('\0')+'\0',maxBuffer:64*1024*1024}).toString('utf8').split('\0');
  const declaredBinary=new Set();
  for(let i=0;i<attributes.length-2;i+=3)if(attributes[i+2]==='unset')declaredBinary.add(attributes[i]);
  const blobs=entries.filter(e=>e.split('\t',1)[0].split(' ')[1]==='blob');
  const child=spawn('git',['cat-file','--batch'],{stdio:['pipe','pipe','pipe']});
  let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-2000);});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`Git blob stream failed: ${stderr}`)));});
  done.catch(()=>{});
  child.stdin.on('error',()=>{});
  child.stdin.end(blobs.map(e=>e.split('\t',1)[0].split(' ')[2]).join('\n')+'\n');
  const reader=streamReader(child.stdout);
  try { for(const entry of entries){
    const tab=entry.indexOf('\t'),header=entry.slice(0,tab),path=entry.slice(tab+1); const [mode,type,oid]=header.split(' ');
    if(type!=='blob'){errors.push(`${path}: submodule requires an explicit audit`);continue;}
    const [returned,typeReturned,size]= (await reader.line()).split(' ');
    if(returned!==oid||typeReturned!=='blob')throw new Error('Git blob stream lost alignment');
    const bytes=await reader.bytes(Number(size));await reader.bytes(1);
    const sha256=hash(bytes);
    try {
      const data=decodeFile(path,bytes,declaredBinary.has(path));
      inventory.push({path,sha256,bytes:bytes.length,kind:data?'text':'binary',encoding:data?.encoding});
      if(data)files.set(path,{path,sha256,...data});
    }catch(e){errors.push(e.message);}
  } await done; } finally { if(child.exitCode===null)child.kill(); }
  return {files,inventory,errors};
}

export function renderParts(parts){
  const seen=new Map();
  return parts.map(p=>{
    const digest=hash(p.text), first=seen.get(digest);
    const header=`\n===== ${JSON.stringify(p.file)} lines ${p.start_line}-${p.end_line} SHA256 ${p.sha256} =====\n`;
    if(first&&first.text===p.text)return header+`[Exact content duplicate of ${JSON.stringify(first.file)} lines ${first.start_line}-${first.end_line}. Review this path's usage/dependencies separately; its complete content is the referenced text.]\n`;
    seen.set(digest,p);return header+p.text;
  }).join('');
}

export function pack(parts,limit,maxBytes){
  const bins=[];
  const items=parts.map(p=>{
    const {text,...metadata}=p,source=renderParts([p]);
    return {p,digest:hash(text),t:tokens(source)+tokens(JSON.stringify(metadata))+16,b:Buffer.byteLength(JSON.stringify(source))+Buffer.byteLength(JSON.stringify(metadata))+32};
  }).sort((a,b)=>b.t-a.t||a.p.file.localeCompare(b.p.file));
  for(const item of items){
    const {p,digest}=item;let best=null,bestSize=null,bestRemaining=Infinity;
    for(const bin of bins){
      let t=item.t,b=item.b;
      const first=bin.seen.get(digest);
      if(first&&first.text===p.text){
        const source=renderParts([first,p]).slice(renderParts([first]).length),{text,...metadata}=p;
        t=tokens(source)+tokens(JSON.stringify(metadata))+16;
        b=Buffer.byteLength(JSON.stringify(source))+Buffer.byteLength(JSON.stringify(metadata))+32;
      }
      if(bin.cost+t>limit||bin.bytes+b>maxBytes)continue;
      // Prefer reusing exact contents, then fill the fullest compatible chunk.
      const remaining=first?-limit+limit-bin.cost-t:limit-bin.cost-t;
      if(remaining<bestRemaining){best=bin;bestSize=[t,b];bestRemaining=remaining;}
    }
    if(!best){
      if(item.t>limit||item.b>maxBytes)throw new Error(`Chunk metadata/input exceeds limit: ${p.file}`);
      best={parts:[],cost:0,bytes:0,seen:new Map()};bestSize=[item.t,item.b];bins.push(best);
    }
    best.parts.push(p);best.cost+=bestSize[0];best.bytes+=bestSize[1];best.seen.set(digest,p);
  }
  return bins.map(bin=>bin.parts);
}

export async function main(){
  mkdirSync('.luna-output',{recursive:true});
  const event=JSON.parse(readFileSync(process.env.LUNA_EVENT_PATH||process.env.GITHUB_EVENT_PATH,'utf8'));
  const repo=process.env.GITHUB_REPOSITORY;
  if(repo!=='Glace678/3')throw new Error('Repository mismatch');
  const issue=event.issue;
  if(!issue || issue.user.login!=='Glace678')throw new Error('Only repository-owner issues are accepted');
  const commit=git('rev-parse','HEAD').toString().trim();
  const mode=/\[review\]/i.test(issue.title)?'review':'fix';
  const promptHash=hash(JSON.stringify([issue.title,issue.body,mode]));
  // An identical read-only audit at the identical commit may reuse its evidence
  // even when requested in a different Issue. Fix jobs retain Issue identity.
  const job=hash(`${repo}:${commit}:${mode==='review'?'shared-review':issue.number}:${promptHash}:sdk-native-v4`);
  const configuredCalls=Number(process.env.LUNA_MAX_MODEL_CALLS||1000);
  const taskCeiling=Number(process.env.LUNA_MAX_TASKS||49);
  const cap=conservativeCallCap(configuredCalls,taskCeiling);
  const tokenLimit=Number(process.env.LUNA_CHUNK_TOKENS||650000);
  if(!Number.isSafeInteger(tokenLimit)||tokenLimit<1000||tokenLimit>650000)throw new Error('Invalid input limit');
  const {files,inventory,errors}=await snapshot();
  console.log(`Inventoried ${inventory.length} files; unresolved entries: ${errors.length}. Estimating chunks locally.`);
  writeFileSync('.luna-output/inventory.json',JSON.stringify({repo,commit,inventory,errors},null,2));
  if(errors.length)throw new Error(`Coverage blocked before any AI call (${errors.length} unresolved entries). See inventory artifact.`);
  // Group equal contents together, but retain every path/range in the manifest.
  const groups=new Map();
  for(const f of files.values()){const key=hash(f.text);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}
  const promptReserve=tokens(issue.title+'\n'+(issue.body||''))+8192;
  const contentLimit=tokenLimit-promptReserve;
  if(contentLimit<3000)throw new Error('Issue prompt leaves insufficient source context');
  const chunks=pack([...groups.values()].flat().flatMap(f=>splitFile(f,contentLimit-2000)),contentLimit,4000000);
  const plan={repo,commit,job,textFiles:files.size,binaryFiles:inventory.filter(x=>x.kind==='binary').length,distinctTextContents:groups.size,initialCalls:chunks.length,maxCalls:cap,expectedZapierTasks:null,taskScenarios:{ifOneTaskPerCall:chunks.length,ifThreeTasksPerCall:3*chunks.length,ifFiveTasksPerCall:5*chunks.length},taskCeiling,pricing:'Native AI via SDK billing unverified; SDK marketing pricing is not proof of model exemption',chunkTokens:tokenLimit,model:'Zapier native GPT-5.6 Luna'};
  writeFileSync('.luna-output/plan.json',JSON.stringify(plan,null,2));
  console.log(JSON.stringify(plan));
  if(process.env.LUNA_PLAN_ONLY==='true')return;
  if(process.env.LUNA_NATIVE_AI_BILLING_VERIFIED!=='true')throw new Error('Native AI billing has not been verified; no model invoked. A free SDK marketing notice alone is insufficient.');
  if(chunks.length>cap)throw new Error(`Initial ${chunks.length} calls exceed the ${cap}-model-call ceiling. No model invoked.`);
  for(const key of ['ZAPIER_HOOK_URL','ZAPIER_CALLBACK_AUTH','ZAPIER_SDK_CLIENT_ID','ZAPIER_SDK_CLIENT_SECRET','ZAPIER_TABLE_ID','GITHUB_TOKEN'])if(!process.env[key])throw new Error(`Missing configuration: ${key}`);
  const hook=new URL(process.env.ZAPIER_HOOK_URL);
  if(hook.protocol!=='https:'||hook.hostname!=='hooks.zapier.com')throw new Error('Unexpected Zapier hook host');
  await requireFreeSdk();
  const transport=journalFetch(row=>appendFileSync('.luna-output/transport.jsonl',JSON.stringify(row)+'\n'));
  const sdk=createZapierSdk({maxNetworkRetries:0,fetch:transport,credentials:{clientId:process.env.ZAPIER_SDK_CLIENT_ID,clientSecret:process.env.ZAPIER_SDK_CLIENT_SECRET}});
  const table=process.env.ZAPIER_TABLE_ID;
  const find=async key=>{
    const rows=[];
    for await(const row of sdk.listTableRecords({table,keyMode:'names',filters:[{fieldKey:'dedupe_key',operator:'exact',value:key}],maxItems:2}).items())rows.push({...row.data,_recordId:row.id});
    if(rows.length>1)throw new Error('Duplicate results detected');
    return rows[0];
  };
  let calls=0;
  const answers=[],allEdits=[];
  const started=Date.now();
  async function invoke(parts,depth=0){
    if(depth>8)throw new Error('Split/context depth exceeded');
    const manifest=parts.map(({text,...r})=>r);
    const source=renderParts(parts);
    if(tokens(source)+tokens(JSON.stringify(manifest))+promptReserve>900000)throw new Error('Context exceeds configured input ceiling');
    const chunk=hash(JSON.stringify(manifest)+source),key=`${job}:${chunk}`;
    const metadata={job_id:job,chunk_id:chunk,attempt_id:'1',dedupe_key:key,repo,commit_sha:commit,issue_number:issue.number,expected_chunks:chunks.length};
    let result=await find(key);
    if(!result){
      const marker=await find(`dispatch:${key}`);
      if(!marker){
        // Count persistent markers, including earlier workflow attempts, against the job ceiling.
        let reserved=0;
        for await(const row of sdk.listTableRecords({table,keyMode:'names',filters:[{fieldKey:'job_id',operator:'exact',value:job},{fieldKey:'status',operator:'exact',value:'dispatched'}],maxItems:cap+1}).items())reserved++;
        if(reserved>=cap)throw new Error('Model-call budget exhausted; no further dispatch');
        await sdk.createTableRecords({table,keyMode:'names',records:[{data:{...metadata,dedupe_key:`dispatch:${key}`,status:'dispatched'}}]});
        const body=JSON.stringify({...metadata,mode,issue_title:issue.title,issue_body:issue.body||'',source_text:'native SDK queue request',manifest_json:'[]',callback_auth:process.env.ZAPIER_CALLBACK_AUTH});
        if(Buffer.byteLength(body)>9000000)throw new Error('Webhook payload too large');
        // Deliberately no automatic retry of this POST: an ambiguous response can otherwise double-charge.
        const response=await fetch(hook,{method:'POST',headers:{'content-type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(60000)});
        if(!response.ok)throw new Error(`Dispatch returned HTTP ${response.status}; inspect Zap history before retrying`);
      }
      const until=Date.now()+20*60*1000;
      while(!result&&Date.now()<until){await sleep(15000);result=await find(key);}
      if(!result)throw new Error('Result pending/failed; preserved dispatch marker prevents duplicate AI charges. Inspect Zap history.');
    }
    if(result.commit_sha!==commit)throw new Error('Result commit mismatch');
    if(['queued','running','starting'].includes(result.status)){
      const existing=result;
      const update=async data=>{await sdk.updateTableRecords({table,keyMode:'names',records:[{id:existing._recordId,data}]});};
      const save=async data=>{
        if(!['completed','incomplete','needs_context'].includes(data.status))return update(data);
        return storeResult({output:data,key,metadata,find,update,create:async data=>sdk.createTableRecords({table,keyMode:'names',records:[{data}]})});
      };
      const wasQueued=result.status==='queued';
      const output=await executeNative({sdk,record:result,save,inputs:nativeInputs({mode,issue,repo,commit,manifest,source})});
      if(wasQueued)calls++;
      result={...existing,...output};
    }
    result=await loadResult(result,key,find);
    const parsed={};
    for(const name of ['review_json','patch_json','needs_context_json','covered_ranges_json']){
      if(typeof result[name]!=='string')throw new Error(`Invalid ${name}`);
      parsed[name]=JSON.parse(result[name]);
    }
    if(result.status==='incomplete'){
      const divided=parts.flatMap(p=>{
        const lines=p.text.match(/[^\n]*\n|[^\n]+$/g)||[];
        if(lines.length<2)return [p];
        const mid=Math.floor(lines.length/2);
        return [{...p,end_line:p.start_line+mid-1,text:lines.slice(0,mid).join('')},{...p,start_line:p.start_line+mid,text:lines.slice(mid).join('')}];
      });
      if(divided.length===1)throw new Error('A single line cannot be reviewed within the output limit');
      const midpoint=Math.ceil(divided.length/2);
      await invoke(divided.slice(0,midpoint),depth+1);await invoke(divided.slice(midpoint),depth+1);return;
    }
    if(result.status==='needs_context'){
      const names=parsed.needs_context_json.files;
      if(!Array.isArray(names)||!names.length)throw new Error('Missing context paths');
      const more=[];
      for(const name of names){const file=files.get(name);if(!file)throw new Error(`Unknown context file: ${name}`);more.push(...splitFile(file,contentLimit-2000));}
      const unique=[...new Map([...parts,...more].map(p=>[`${p.file}:${p.start_line}:${p.end_line}`,p])).values()];
      if(unique.length===parts.length)throw new Error('Model requested no new context');
      await invoke(unique,depth+1);return;
    }
    if(result.status!=='completed')throw new Error('Invalid model status');
    validateCompactCoverage(manifest,parsed.covered_ranges_json);
    if(!Array.isArray(parsed.review_json)||!Array.isArray(parsed.patch_json))throw new Error('Invalid structured result');
    answers.push({manifest,...parsed});allEdits.push(...parsed.patch_json);
    writeFileSync('.luna-output/review.json',JSON.stringify(answers,null,2));
    if(Date.now()-started>4*60*60*1000)throw new Error('Run duration limit; resume from persisted results');
  }
  for(const chunk of chunks)await invoke(chunk);
  const changed=mode==='fix'?applyEdits(files,allEdits):new Map();
  writeFileSync('.luna-output/proposed-changes.json',JSON.stringify([...changed].map(([path,text])=>({path,text})),null,2));
  const gh=async(path,method='GET',body)=>{
    const response=await fetch(`https://api.github.com/repos/${repo}${path}`,{method,headers:{authorization:`Bearer ${process.env.GITHUB_TOKEN}`,accept:'application/vnd.github+json','content-type':'application/json','user-agent':'luna-review-worker','x-github-api-version':'2022-11-28'},body:body?JSON.stringify(body):undefined,redirect:'error'});
    if(!response.ok)throw new Error(`GitHub API ${method} ${path}: HTTP ${response.status}`);return response.status===204?null:response.json();
  };
  let pr;
  if(changed.size){
    // Git data API publishes file contents without executing model-produced code or repository scripts.
    const base=await gh(`/git/commits/${commit}`);const tree=[];
    for(const [path,text]of changed){
      const blob=await gh('/git/blobs','POST',{content:encodeEdit(text,files.get(path).encoding).toString('base64'),encoding:'base64'});
      const mode=git('ls-tree','HEAD','--',path).toString().split(' ')[0];
      tree.push({path,mode,type:'blob',sha:blob.sha});
    }
    const newTree=await gh('/git/trees','POST',{base_tree:base.tree.sha,tree});
    const newCommit=await gh('/git/commits','POST',{message:`Luna: address issue #${issue.number}`,tree:newTree.sha,parents:[commit]});
    const branch=`codex/luna-issue-${issue.number}-${job.slice(0,12)}`;
    await gh('/git/refs','POST',{ref:`refs/heads/${branch}`,sha:newCommit.sha});
    pr=await gh('/pulls','POST',{title:`Luna: ${issue.title}`.slice(0,240),head:branch,base:event.repository.default_branch,draft:true,body:`根据 #${issue.number} 生成代码修改。\n\n审查基准：${commit}；文本文件 ${files.size} 个；本次新发出模型请求 ${calls} 次。模型只在 Zapier 内置 GPT-5.6 Luna 中运行。完整清单及逐行覆盖记录见 Actions artifact。\n\n验证：结构化输出、范围覆盖、原文唯一匹配及路径约束已检查。项目构建和运行测试尚未执行，请运行对应子项目测试后再合并。\n\n此 PR 不自动合并。`});
  }
  await gh(`/issues/${issue.number}/comments`,'POST',{body:`Zapier Luna 处理完成。基准 ${commit}，文本文件 ${files.size} 个，二进制文件 ${plan.binaryFiles} 个单独登记，本次新发出模型请求 ${calls} 次。覆盖清单和报告在 [Actions 运行](https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}) 的 luna-review artifact。\n\n${pr?`已创建草稿 PR：${pr.html_url}`:'没有生成代码修改。'}\n\n模型声明的覆盖已通过范围校验；这不代表代码无缺陷。未执行项目构建或运行测试。`});
  writeFileSync('.luna-output/completion.json',JSON.stringify({job,commit,calls,changed:changed.size,pr:pr?.html_url},null,2));
}

if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
