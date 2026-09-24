// One Issue starts this entire cloud job. No local operator or per-batch approval.
import {readFileSync,writeFileSync,mkdirSync,existsSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createZapierSdk} from '@zapier/zapier-sdk';
import {randomBytes} from 'node:crypto';
import {snapshot,hash,applyEdits,encodeEdit,renderParts,pack} from './worker.mjs';
import {APP,MODEL,nativeInputs,requireFreeSdk} from './native-sdk.mjs';
import {checkConfig,validateAnswer} from './autonomous-core.mjs';
import {journalFetch} from './request-journal.mjs';
import {checkUsage,readUsage} from './usage-guard.mjs';
const root='.luna-output',jobPath='.github/zapier-review/cloud-job.json';
mkdirSync(root,{recursive:true});
const input=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')).inputs;
const token=process.env.GITHUB_TOKEN,repo='Glace678/3';
if(!token)throw Error('GitHub job token is missing');
const gh=async(path,method='GET',body)=>{
  const r=await fetch(`https://api.github.com/repos/${repo}${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'zapier-luna-autonomous'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(r.status===404&&method==='GET')return null;
  if(!r.ok)throw Error(`GitHub ${method} ${path.split('?')[0]} returned ${r.status}`);
  return r.status===204?null:r.json();
};
const git=(...args)=>execFileSync('git',args,{maxBuffer:512*1024*1024}).toString().trim();
const sourceCommit=git('rev-parse','HEAD');
const issue=await gh(`/issues/${Number(input.issue_number)}`);
const config=checkConfig({repo,model:input.model_id,maxTasks:Number(input.max_tasks),policy:input.policy,issue,mode:/\[review\]|不修改|只审查|只审核/i.test(issue.title+' '+issue.body)?'review':'fix'});
const key=hash(JSON.stringify([issue.number,issue.title,issue.body,config.model,config.policy]));
const branch=`codex/luna-job-${issue.number}-${key.slice(0,12)}`;
if(input.job_branch&&input.job_branch!==branch)throw Error('Continuation does not match the unchanged Issue/configuration');
let state,contentSha;
const saved=await gh(`/contents/${jobPath}?ref=${encodeURIComponent(branch)}`);
if(saved){
  contentSha=saved.sha;
  if(saved.content)state=JSON.parse(Buffer.from(saved.content,'base64').toString());
  else {const head=await gh(`/git/ref/heads/${branch}`);const r=await fetch(`https://raw.githubusercontent.com/${repo}/${head.object.sha}/${jobPath}`,{redirect:'error'});if(!r.ok)throw Error('Cannot load durable job');state=await r.json();}
  if(state.sourceCommit!==sourceCommit)throw Error('Resume must check out the original source commit');
  if(state.status==='completed'){console.log(JSON.stringify({status:'already-completed',pr:state.pr}));process.exit(0);}
  if(state.halted)throw Error(state.halted);
}
async function save(){
  state.updatedAt=new Date().toISOString();
  const response=await gh(`/contents/${jobPath}`,'PUT',{message:`Luna #${issue.number}: ${state.status}`,branch,sha:contentSha,content:Buffer.from(JSON.stringify(state)).toString('base64')});
  contentSha=response.content.sha;writeFileSync(`${root}/cloud-job.json`,JSON.stringify(state,null,2));
}
const raw=async(commit,path)=>{
  const r=await fetch(`https://raw.githubusercontent.com/${repo}/${commit}/${path}`,{redirect:'error',signal:AbortSignal.timeout(90000)});
  if(!r.ok)throw Error(`Source attachment unavailable: HTTP ${r.status}`);return r.text();
};
if(!state){
  writeFileSync(`${root}/job-config.json`,JSON.stringify(config));
  execFileSync(process.execPath,['.github/zapier-review/prepare-full-audit.mjs','850000','18'],{stdio:'inherit',env:{...process.env,LUNA_JOB_CONFIG:`${root}/job-config.json`},maxBuffer:32*1024*1024});
  const schedule=JSON.parse(readFileSync(`${root}/full-audit/schedule.json`)),inventory=JSON.parse(readFileSync(`${root}/full-audit/inventory.json`));
  state={version:1,key,config,sourceCommit,status:'preparing',modelRequests:0,expectedZapierTasks:1,billingBasis:'One standard-runtime Zap dispatch; SDK actions must remain explicitly free in beta. No paid model fallback.',queue:[],createdAt:new Date().toISOString(),textFiles:inventory.inventory.filter(x=>x.kind==='text').length,binaryFiles:inventory.inventory.filter(x=>x.kind==='binary').length,emptyFiles:inventory.emptyTextFiles};
  for(const p of schedule.schedule){
    const dir=`${root}/validation/${p.id}`,inputs=JSON.parse(readFileSync(`${dir}/pending-inputs.json`));
    const record={id:p.id,inputs,checks:JSON.parse(readFileSync(`${dir}/expected-transport.json`)),fixtures:JSON.parse(readFileSync(`${dir}/expected-quality.json`)),sourceHash:p.attachmentSha256,depth:0};
    record.inputs.inputFields.source_text='';
    writeFileSync(`${dir}/cloud-input.json`,JSON.stringify(record));
    state.queue.push({id:p.id,status:'queued',asset:`.github/zapier-review/cloud-inputs/${p.id}.json`,source:`.github/zapier-review/cloud-inputs/${p.id}.txt`});
  }
  writeFileSync(`${root}/cloud-job.json`,JSON.stringify(state));
  if(input.plan_only==='true'){console.log(JSON.stringify({status:'plan-only',batches:state.queue.length,textFiles:state.textFiles,modelRequests:0}));process.exit(0);}
  await requireFreeSdk();
  // One isolated Git commit publishes exact public-repository source attachments.
  const index=`${process.cwd()}/${root}/cloud-index`;
  if(existsSync(index))unlinkSync(index);
  const env={...process.env,GIT_INDEX_FILE:index,GIT_AUTHOR_NAME:'Zapier Luna',GIT_AUTHOR_EMAIL:'luna@users.noreply.github.com',GIT_COMMITTER_NAME:'Zapier Luna',GIT_COMMITTER_EMAIL:'luna@users.noreply.github.com'};
  const run=(args,body)=>execFileSync('git',args,{env,input:body,maxBuffer:512*1024*1024}).toString().trim();
  run(['read-tree',sourceCommit]);
  const add=(path,body)=>{const blob=run(['hash-object','-w','--stdin'],body);run(['update-index','--add','--cacheinfo','100644',blob,path]);};
  add(jobPath,readFileSync(`${root}/cloud-job.json`));
  for(const q of state.queue){add(q.asset,readFileSync(`${root}/validation/${q.id}/cloud-input.json`));add(q.source,readFileSync(`${root}/validation/${q.id}/source.txt`));}
  const tree=run(['write-tree']),commit=run(['commit-tree',tree,'-p',sourceCommit],`Luna #${issue.number}: complete source inventory and resumable job\n`);
  const pushEnv={...env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0:'AUTHORIZATION: basic '+Buffer.from('x-access-token:'+token).toString('base64')};
  execFileSync('git',['push','--quiet','origin',`${commit}:refs/heads/${branch}`],{env:pushEnv,stdio:['ignore','pipe','pipe']});
  unlinkSync(index);state.assetCommit=commit;state.status='running';
  contentSha=(await gh(`/contents/${jobPath}?ref=${encodeURIComponent(branch)}`)).sha;await save();
}
if(!state.assetCommit){state.assetCommit=(await gh(`/git/ref/heads/${branch}`)).object.sha;state.status='running';await save();}
const sdk=createZapierSdk({maxNetworkRetries:0,credentials:{clientId:process.env.ZAPIER_SDK_CLIENT_ID,clientSecret:process.env.ZAPIER_SDK_CLIENT_SECRET},fetch:journalFetch(()=>{})});
async function usageGuard(){checkUsage(state,await readUsage(sdk),Math.min(config.maxTasks,state.config.maxTasks));}
async function ownerStopGuard(){const current=await gh(`/issues/${issue.number}`);if(!current||current.state!=='open')throw Error('Owner closed the Issue; no more model requests will be submitted');}
async function continueJob(){
  state.status='continuing';state.continuations=(state.continuations||0)+1;
  if(state.continuations>48)throw Error('Cloud continuation limit exceeded');
  await save();
  await gh('/actions/workflows/luna-autonomous.yml/dispatches','POST',{ref:'main',inputs:{...input,job_branch:branch,plan_only:'false'}});
  console.log('Saved job continues automatically in the next cloud run.');
  process.exit(0);
}
let files;
async function getFiles(){if(!files){const s=await snapshot();if(s.errors.length)throw Error(s.errors.join('\n'));files=s.files;}return files;}
// Large recovery inputs live in immutable Git blobs, never accumulate in the state file.
async function persistRecoveryInputs(children){
  if(!children.length)return;
  const head=await gh(`/git/ref/heads/${branch}`),base=await gh(`/git/commits/${head.object.sha}`),tree=[];
  for(const child of children){
    child.asset=`.github/zapier-review/cloud-inputs/${child.id}.json`;
    const blob=await gh('/git/blobs','POST',{content:Buffer.from(JSON.stringify(child.inline)).toString('base64'),encoding:'base64'});
    tree.push({path:child.asset,mode:'100644',type:'blob',sha:blob.sha});
  }
  const newTree=await gh('/git/trees','POST',{base_tree:base.tree.sha,tree});
  const commit=await gh('/git/commits','POST',{message:`Luna #${issue.number}: automatic recovery source`,tree:newTree.sha,parents:[head.object.sha]});
  await gh(`/git/refs/heads/${branch}`,'PATCH',{sha:commit.sha,force:false});
  for(const child of children){child.assetCommit=commit.sha;delete child.inline;}
}
async function recover(q,batch,reason){
  if(batch.depth>=6)throw Error(`Recovery depth exhausted: ${q.id}: ${reason}`);
  const originals=JSON.parse(batch.inputs.inputFields.manifest_json).filter(m=>!m.file.startsWith('validation-fixtures/'));
  const map=await getFiles(),parts=[];
  for(const m of originals){
    const source=map.get(m.file);if(!source||source.sha256!==m.sha256)throw Error('Recovery source changed');
    const text=source.text.slice(m.start_char,m.end_char),span=Math.max(1,Math.floor(120000/2**batch.depth));
    for(let at=0;at<text.length;){let end=Math.min(text.length,at+span);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;const segment=text.slice(at,end);const {block_ids,...base}=m;parts.push({...base,text:segment,start_char:m.start_char+at,end_char:m.start_char+end,start_line:m.start_line+(text.slice(0,at).match(/\n/g)||[]).length,end_line:m.start_line+(text.slice(0,end).match(/\n/g)||[]).length});at=end;}
  }
  const requested=JSON.parse(q.raw?.results?.[0]?.needs_context_json||'{"files":[]}').files||[];
  if(!Array.isArray(requested)||requested.some(p=>typeof p!=='string'||!map.has(p)))throw Error('Requested context does not exist in fixed snapshot');
  const context=[...new Set(requested)].filter(p=>!originals.some(m=>m.file===p&&m.start_char===0&&m.end_char===map.get(p).text.length)).map(file=>{
    const f=map.get(file);return {file,text:f.text,sha256:f.sha256,encoding:f.encoding,start_char:0,end_char:f.text.length,start_line:1,end_line:f.text.split('\n').length};
  });
  const contextBytes=context.reduce((n,f)=>n+Buffer.byteLength(JSON.stringify(f)),0);
  if(contextBytes>400000)throw Error('Requested cross-file context exceeds safe recovery payload; no partial completion claimed');
  const bins=pack(parts,140000,Math.max(120000,650000-contextBytes)),children=[];
  for(let n=0;n<bins.length;n++){
    const id=`${q.id}-r${n}`,fixtures=batch.fixtures;
    const entries=[...bins[n],...context,...fixtures.map(f=>({file:f.file,text:f.text,sha256:hash(f.text),encoding:'utf-8',start_char:0,end_char:f.text.length,start_line:1,end_line:f.text.split('\n').length}))];
    const manifest=entries.map(({text,...m})=>m),checks=Object.fromEntries(['begin','middle','end'].map(k=>[k,randomBytes(12).toString('hex')]));
    const mid=Math.floor(entries.length/2),mark=k=>`\n[Transport validation ${k}: ${checks[k]}]\n`;
    const source=mark('begin')+renderParts(entries.slice(0,mid))+mark('middle')+renderParts(entries.slice(mid))+mark('end');
    const inputs={...nativeInputs({mode:config.mode,issue:config.issue,repo,commit:sourceCommit,manifest,source}),tools:'[]',knowledgeSources:'[]'};
    inputs.instructions+=` ${config.policy} Respond in Chinese. Each finding needs a separate exact evidence string. Return transport_checks_json with begin,middle,end markers. The manifest has ${manifest.length} entries; its last inclusive index is ${manifest.length-1}. Validation fixtures are isolated and must not be patched. Valid JSON only, with escaped embedded quotation marks.`;
    inputs.outputFields=JSON.stringify([...JSON.parse(inputs.outputFields),{name:'transport_checks_json',type:'text',isRequired:true,description:'Valid JSON containing exact begin,middle,end transport markers.'}]);
    if(Buffer.byteLength(JSON.stringify(inputs))>900000)throw Error('Recovery input too large');
    children.push({id,status:'queued',inline:{id,inputs,checks,fixtures,depth:batch.depth+1}});
  }
  if(!children.length)throw Error('Empty recovery scope');
  await persistRecoveryInputs(children);
  q.status='superseded';q.reason=reason;q.children=children.map(c=>c.id);state.queue.push(...children);await save();
}
const started=Date.now();
try{
  await requireFreeSdk();await usageGuard();await save();
  await persistRecoveryInputs(state.queue.filter(q=>q.inline));await save();
  for(let i=0;i<state.queue.length;i++){
    const q=state.queue[i];if(['completed','superseded'].includes(q.status))continue;
    if(Date.now()-started>245*60*1000){
      await continueJob();
    }
    if(q.status==='starting'&&!q.runId)throw Error(`Submission is uncertain: ${q.id}; automatic duplicate dispatch is disabled`);
    const batch=JSON.parse(await raw(q.assetCommit||state.assetCommit,q.asset));
    const manifest=JSON.parse(batch.inputs.inputFields.manifest_json);
    if(!q.runId){
      if(state.modelRequests>=600)throw Error('Unusual model request count: stopped');
      if(q.source){const source=await raw(state.assetCommit,q.source);if(hash(source)!==batch.sourceHash)throw Error('Attachment hash mismatch');batch.inputs.inputFields.source_text=`https://raw.githubusercontent.com/${repo}/${state.assetCommit}/${q.source}`;batch.inputs.inputFieldConfig_source_text_isFileUrl=true;batch.inputs.instructions+=' source_text is a file attachment. Read its entire content; a URL is not the source. Return incomplete if unavailable.';}
      await requireFreeSdk();await usageGuard();await ownerStopGuard();q.status='starting';state.modelRequests++;await save();
      const r=await sdk.createActionRun({app:APP,action:'get_completion',actionType:'write',inputs:batch.inputs});
      if(!r.data.id)throw Error('SDK execution identifier missing');q.runId=r.data.id;q.status='running';await save();
    }
    let data;const until=Date.now()+25*60*1000;let lastUsage=Date.now();
    do{data=(await sdk.getActionRun({run:q.runId})).data;if(data.status!=='waiting')break;
      if(Date.now()-lastUsage>60000){await usageGuard();lastUsage=Date.now();}
      await new Promise(r=>setTimeout(r,10000));}while(Date.now()<until);
    if(data.status==='waiting')await continueJob();
    q.raw=data;q.finishedAt=new Date().toISOString();await save();
    await usageGuard();
    if(data.status!=='success'||data.errors?.length||data.results?.length!==1)throw Error(`SDK execution failed: ${q.id}`);
    let answer;
    try{answer=validateAnswer({output:data.results[0],manifest,checks:batch.checks,fixtures:batch.fixtures,mode:config.mode});}
    catch(error){await recover(q,batch,error.message);continue;}
    q.answer=answer;q.manifest=manifest.filter(m=>!m.file.startsWith('validation-fixtures/'));q.status='completed';q.reflection={accepted:true,findings:q.answer.findings.length,normalization:q.answer.normalization,expectedTasksAdded:0,basis:'SDK free-beta price rechecked before dispatch; actual task billing is not returned by SDK.'};await save();
  }
  const map=await getFiles(),spans=new Map(),findings=[],edits=[];
  for(const q of state.queue)if(q.status==='completed'){
    findings.push(...q.answer.findings);edits.push(...q.answer.patches);
    for(const m of q.manifest){const values=spans.get(m.file)||[];values.push([m.start_char,m.end_char]);spans.set(m.file,values);}
  }
  const coverage=[];
  for(const [path,file] of map){let next=0;for(const [a,b]of(spans.get(path)||[]).sort((x,y)=>x[0]-y[0])){if(a>next)throw Error(`Unreviewed source: ${path}:${next}`);next=Math.max(next,b);}if(next!==file.text.length)throw Error(`Unreviewed end of source: ${path}`);coverage.push({path,sha256:file.sha256,characters:next,status:file.text.length?'reviewed':'empty'});}
  writeFileSync(`${root}/full-coverage.json`,JSON.stringify(coverage,null,2));writeFileSync(`${root}/findings.json`,JSON.stringify(findings,null,2));
  const uniqueEdits=[...new Map(edits.map(e=>[JSON.stringify(e),e])).values()];
  const changes=applyEdits(map,uniqueEdits),base=await gh(`/git/commits/${sourceCommit}`),tree=[];
  for(const [path,text]of changes){const blob=await gh('/git/blobs','POST',{content:encodeEdit(text,map.get(path).encoding).toString('base64'),encoding:'base64'});tree.push({path,mode:git('ls-tree',sourceCommit,'--',path).split(' ')[0],type:'blob',sha:blob.sha});}
  const report=`# 全仓审核报告\n\n基准：${sourceCommit}\n\n文本文件 ${map.size} 个全部通过覆盖检查；二进制 ${state.binaryFiles} 个仅登记。\n\nZapier 托管 Luna 模型请求 ${state.modelRequests} 次。SDK 当前免费 Beta；主 Zap 启动步骤预期1 task。SDK不返回实际计费，不能把请求数当作账单。\n\n问题记录 ${findings.length} 条；修改文件 ${changes.size} 个。报告中的发现是模型意见；引用匹配和覆盖检查不证明找出了所有缺陷。未执行项目完整构建或运行测试。\n\n完整覆盖与原始响应见 Actions artifact 和工作状态分支 ${branch}。\n`;
  const details=findings.map((f,i)=>`## ${i+1}. ${f.file}:${f.line ?? '?'}\n\n${f.severity || ''} ${f.description}\n\n${f.evidence ? '证据：'+JSON.stringify(f.evidence) : '未返回独立证据字段'}\n`).join('\n');
  const reportBlob=await gh('/git/blobs','POST',{content:report+'\n'+details,encoding:'utf-8'});tree.push({path:`luna-reviews/issue-${issue.number}.md`,mode:'100644',type:'blob',sha:reportBlob.sha});
  const newTree=await gh('/git/trees','POST',{base_tree:base.tree.sha,tree}),commit=await gh('/git/commits','POST',{message:`Luna: review full repository and address #${issue.number}`,tree:newTree.sha,parents:[sourceCommit]});
  const fixBranch=`codex/luna-issue-${issue.number}-${key.slice(0,12)}`;
  const existingRef=await gh(`/git/ref/heads/${fixBranch}`);
  if(!existingRef)await gh('/git/refs','POST',{ref:`refs/heads/${fixBranch}`,sha:commit.sha});
  else {const previous=await gh(`/git/commits/${existingRef.object.sha}`);if(previous.tree.sha!==newTree.sha)throw Error('Existing result branch differs; refusing to overwrite it');}
  const existingPR=await gh(`/pulls?head=Glace678:${fixBranch}&state=all`);
  const pr=existingPR?.[0]||await gh('/pulls','POST',{title:`Luna 全仓审核：${issue.title}`.slice(0,240),head:fixBranch,base:'main',draft:true,body:`处理 #${issue.number}。\n\n${report}\n不自动合并。`});
  state.pr=pr.html_url;state.status='completed';state.coverageComplete=true;state.changedFiles=changes.size;state.findings=findings.length;await save();
  try {await gh(`/issues/${issue.number}/comments`,'POST',{body:`Zapier整仓流程完成：${map.size}个文本文件覆盖已核验，已上传草稿PR：${pr.html_url}\n\n[完整运行与报告](https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID})。二进制仅登记；尚未进行项目完整构建和运行测试。`});}
  catch(error){console.warn('PR and complete report were saved; final Issue notification failed: '+error.message);}
  console.log(JSON.stringify({status:state.status,pr:state.pr,textFiles:map.size,changedFiles:changes.size}));
}catch(error){state.status='stopped';state.halted=error.message;await save();throw error;}
