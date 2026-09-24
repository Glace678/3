// Default: prepare a single native-Luna billing probe without network access.
// Real execution needs BOTH --execute and a separately granted approval flag.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getEncoding} from 'js-tiktoken';
import {createZapierSdk} from '@zapier/zapier-sdk';
import {nativeInputs,MODEL,APP} from './native-sdk.mjs';
const digest=x=>createHash('sha256').update(x).digest('hex');
const dir='.luna-output/billing-probe',stateFile=`${dir}/state.json`;
mkdirSync(dir,{recursive:true});
const execute=process.argv.includes('--execute'),resume=process.argv.includes('--resume');
if(!execute&&!resume){
  const commit=execFileSync('git',['rev-parse','HEAD']).toString().trim();
  const file='.github/zapier-review/worker.mjs';
  const bytes=execFileSync('git',['show',`${commit}:${file}`]);
  const source=bytes.toString('utf8'),manifest=[{file,start_line:1,end_line:(source.match(/[^\n]*\n|[^\n]+$/g)||[]).length,sha256:digest(bytes),encoding:'utf-8'}];
  const inputs={...nativeInputs({mode:'review',issue:{title:'[review] Single-file billing validation',body:'Review only the supplied file. Do not call tools or change external state.'},repo:'Glace678/3',commit,manifest,source}),tools:'[]',knowledgeSources:'[]'};
  const payload=JSON.stringify(inputs);
  if(existsSync(stateFile))throw Error('A probe already exists; preserve its execution ID and do not prepare another');
  writeFileSync(`${dir}/inputs.json`,payload);
  const plan={status:'prepared',repo:'Glace678/3',commit,file,model:MODEL,zapierManaged:true,maxNewModelInvocations:1,tools:0,estimatedInputTokens:getEncoding('o200k_base').encode(payload,[],[]).length,inputSha256:digest(payload),billing:'UI confirms Standard=1 task for a Zap step. SDK exemption unverified; reserve 1 model task. This is not a platform billing cap.',executed:false};
  writeFileSync(`${dir}/plan.json`,JSON.stringify(plan,null,2));console.log(JSON.stringify(plan,null,2));
}else{
  if(execute&&resume)throw Error('Choose execute or resume, not both');
  if(execute&&process.env.LUNA_APPROVE_SINGLE_PROBE!=='one-standard-luna-call')throw Error('No approval for a potentially billed model call; nothing sent');
  const plan=JSON.parse(readFileSync(`${dir}/plan.json`,'utf8')),payload=readFileSync(`${dir}/inputs.json`,'utf8');
  if(digest(payload)!==plan.inputSha256)throw Error('Prepared probe changed');
  const inputs=JSON.parse(payload);
  if(inputs.model_id!==MODEL||inputs.authentication_id!=='0'||inputs.tools!=='[]'||inputs.knowledgeSources!=='[]')throw Error('Probe must remain one native Luna invocation with no tools');
  let state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):null;
  if(state?.status==='finished'){console.log('Existing result preserved; no new model call');process.exit(0);}
  if(state&&!state.runId)throw Error('Prior submission is uncertain; inspect history instead of retrying');
  if(resume&&!state?.runId)throw Error('No saved execution ID to resume');
  for(const k of ['ZAPIER_SDK_CLIENT_ID','ZAPIER_SDK_CLIENT_SECRET'])if(!process.env[k])throw Error(`Missing ${k}`);
  const sdk=createZapierSdk({maxNetworkRetries:0,credentials:{clientId:process.env.ZAPIER_SDK_CLIENT_ID,clientSecret:process.env.ZAPIER_SDK_CLIENT_SECRET}});
  if(!state){
    writeFileSync(stateFile,JSON.stringify({status:'starting',inputSha256:plan.inputSha256}));
    const response=await sdk.createActionRun({app:APP,action:'get_completion',actionType:'write',inputs});
    if(!response.data.id)throw Error('Submission uncertain; do not retry');
    state={status:'running',runId:response.data.id,inputSha256:plan.inputSha256};writeFileSync(stateFile,JSON.stringify(state));
  }
  const until=Date.now()+20*60*1000;
  while(Date.now()<until){
    const response=await sdk.getActionRun({run:state.runId});
    if(response.data.status==='waiting'){await new Promise(r=>setTimeout(r,5000));continue;}
    // Keep all execution metadata, including any model/task usage fields.
    writeFileSync(`${dir}/result.json`,JSON.stringify(response,null,2));
    writeFileSync(stateFile,JSON.stringify({...state,status:'finished',outcome:response.data.status}));
    console.log(JSON.stringify({runId:state.runId,status:response.data.status,resultSaved:true,newInvocations:resume?0:1}));process.exit(0);
  }
  throw Error('Pending result; --resume only polls this same saved execution ID');
}
