// One model submission per command. Subsequent probes require a recorded UI
// observation and reflection. No parallel execution or automatic model retries.
import {readFileSync,writeFileSync,existsSync,renameSync,unlinkSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createZapierSdk} from '@zapier/zapier-sdk';
import {APP,MODEL,requireFreeSdk} from './native-sdk.mjs';
import {reserve,reconcile} from './validation-budget.mjs';
const root='.luna-output/validation',file=`${root}/ledger.json`,lock=`${root}/active.lock`;
const digest=x=>createHash('sha256').update(x).digest('hex');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const save=ledger=>{writeFileSync(`${file}.tmp`,JSON.stringify(ledger,null,2));renameSync(`${file}.tmp`,file);};
mkdirSync(root,{recursive:true});
const [command,id,value,...words]=process.argv.slice(2);
if(command==='init'){
  if(existsSync(file))throw Error('Existing ledger must not be overwritten');
  const old=read('.luna-output/billing-probe/state.json'),plan=read('.luna-output/billing-probe/plan.json');
  save({limitTasks:80,authorization:'User authorized cumulative maximum 80 validation tasks on 2026-09-24; do not spend the allowance as a target.',halted:null,runs:[{id:'001-billing',model:MODEL,reserveTasks:1,baseline:0,status:'finished',runId:old.runId,inputSha256:plan.inputSha256,estimatedInputTokens:plan.estimatedInputTokens}]});
}else if(command==='observe'){
  save(reconcile(read(file),id,Number(value),words.join(' ')));
}else if(command==='execute'||command==='resume'){
  if(!/^[0-9]{3}-[a-z0-9-]+$/.test(id||''))throw Error('Invalid prepared probe ID');
  const prior=read(file).runs.find(r=>r.id===id);
  if(command==='resume'&&['finished','failed'].includes(prior?.status)){console.log('Saved result reused; no request sent');process.exit(0);}
  writeFileSync(lock,String(process.pid),{flag:'wx'});
  try{
    let ledger=read(file),entry=ledger.runs.find(r=>r.id===id);
    const dir=`${root}/${id}`,plan=read(`${dir}/plan.json`),payload=readFileSync(`${dir}/inputs.json`,'utf8'),inputs=JSON.parse(payload);
    if(digest(payload)!==plan.inputSha256||inputs.model_id!==MODEL||inputs.authentication_id!=='0'||inputs.tools!=='[]'||inputs.knowledgeSources!=='[]'||inputs.includeWorkflowData!==false)throw Error('Prepared native Luna payload changed or enabled tools');
    if(command==='execute'){
      if(process.env.LUNA_VALIDATION_APPROVED!=='80-task-cumulative-limit')throw Error('Validation authorization missing');
      ledger=reserve(ledger,{...plan,id,model:MODEL,reserveTasks:1,baseline:Number(value)});save(ledger);entry=ledger.runs.at(-1);
    }else if(!entry?.runId)throw Error('No known run ID; uncertain submissions must never be repeated');
    const update=patch=>{ledger={...ledger,runs:ledger.runs.map(r=>r.id===id?{...r,...patch}:r)};save(ledger);entry=ledger.runs.find(r=>r.id===id);};
    const sdk=createZapierSdk({maxNetworkRetries:0,credentials:{clientId:process.env.ZAPIER_SDK_CLIENT_ID,clientSecret:process.env.ZAPIER_SDK_CLIENT_SECRET}});
    if(!entry.runId){
      await requireFreeSdk();
      update({status:'starting',startedAt:new Date().toISOString()});
      const response=await sdk.createActionRun({app:APP,action:'get_completion',actionType:'write',inputs});
      if(!response.data.id)throw Error('No execution ID; do not resubmit');
      update({status:'running',runId:response.data.id});
      console.log(JSON.stringify({id,runId:entry.runId,newModelRequests:1}));
    }
    const until=Date.now()+20*60*1000;
    while(Date.now()<until){
      const response=await sdk.getActionRun({run:entry.runId});
      if(response.data.status==='waiting'){await new Promise(r=>setTimeout(r,5000));continue;}
      writeFileSync(`${dir}/result.json`,JSON.stringify(response,null,2));
      update({status:response.data.status==='success'?'finished':'failed',outcome:response.data.status,finishedAt:new Date().toISOString()});
      console.log(JSON.stringify({id,status:entry.status,newModelRequests:command==='execute'?1:0,nextProbeBlockedUntilReflectionAndUsage:true}));break;
    }
    if(entry.status==='running')console.log('Still pending. Only resume this same run ID; do not submit another model request.');
  }finally{unlinkSync(lock);}
}else throw Error('Use init, observe ID TASKS REFLECTION, execute ID BASELINE, or resume ID');
