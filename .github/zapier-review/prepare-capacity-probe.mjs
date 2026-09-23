// Offline preparation only. Complete selected files, no minification/omissions.
import {writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {getEncoding} from 'js-tiktoken';
import {snapshot,hash,renderParts} from './worker.mjs';
import {nativeInputs,MODEL} from './native-sdk.mjs';
const id=process.argv[2],target=Number(process.argv[3]||650000);
if(!/^[0-9]{3}-[a-z0-9-]+$/.test(id||'')||target<10000||target>1600000)throw Error('Invalid probe ID or target');
const dir=`.luna-output/validation/${id}`;
if(existsSync(`${dir}/inputs.json`))throw Error('Prepared inputs cannot be overwritten');
const count=s=>getEncoding('o200k_base').encode(s,[],[]).length;
const {files,errors}=await snapshot();if(errors.length)throw Error(errors.join('\n'));
const score=p=>p.startsWith('.github/zapier-review/')?0:p.startsWith('MuMain/src/source/')?1:p.startsWith('MuMain/src/ThirdParty/')?2:3;
const candidates=[...files.values()].sort((a,b)=>score(a.path)-score(b.path)||a.path.localeCompare(b.path));
const parts=[];let estimated=0;
for(const f of candidates){
  if(!f.text||f.path.endsWith('.json'))continue; // Bounded source-code sample, not a whole-repository coverage claim.
  const n=count(f.text)+count(f.path)+140;
  if(n>target-12000-estimated)continue;
  parts.push({file:f.path,start_line:1,end_line:(f.text.match(/[^\n]*\n|[^\n]+$/g)||[]).length,sha256:f.sha256,encoding:f.encoding,text:f.text});estimated+=n;
  if(estimated>target-16000)break;
}
const markers=['begin','middle','end'].map(position=>({position,value:randomBytes(12).toString('hex')}));
const midpoint=Math.floor(parts.length/2);
const marker=m=>`\n[Transport validation ${m.position}: ${m.value}]\n`;
const source=marker(markers[0])+renderParts(parts.slice(0,midpoint))+marker(markers[1])+renderParts(parts.slice(midpoint))+marker(markers[2]);
const manifest=parts.map(({text,...m})=>m),commit=execFileSync('git',['rev-parse','HEAD']).toString().trim();
const inputs={...nativeInputs({mode:'review',repo:'Glace678/3',commit,manifest,source,issue:{title:'[review] Full-file capacity and transport validation',body:'Review all supplied files completely; this is a bounded validation sample, not a claim to review the whole repository. Report actionable defects with evidence. Judge code against its own intended behavior: the review worker intentionally audits the entire repository. Do not infer code defects from this test request. If the supplied text is too large to review completely, return incomplete. Transport markers are outside the source files. In transport_checks_json return a JSON object mapping begin, middle, end to the corresponding exact transport marker values found within source_text. Do not invent missing values.'}}),tools:'[]',knowledgeSources:'[]'};
inputs.instructions+=' Also return transport_checks_json as the requested JSON string. Transport checks only sample three input positions; they do not certify complete review.';
inputs.outputFields=JSON.stringify([...JSON.parse(inputs.outputFields),{name:'transport_checks_json',type:'text',isRequired:true,description:'JSON mapping begin, middle, end to exact marker values from source_text.'}]);
const payload=JSON.stringify(inputs),actual=count(payload);
if(actual>target)throw Error(`Prepared size ${actual} exceeds target ${target}; no network request sent`);
mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/inputs.json`,payload);writeFileSync(`${dir}/expected-transport.json`,JSON.stringify(Object.fromEntries(markers.map(m=>[m.position,m.value]))));
const plan={id,model:MODEL,commit,estimatedInputTokens:actual,payloadBytes:Buffer.byteLength(payload),files:manifest.length,inputSha256:hash(payload),purpose:'Determine large-source acceptance, check three input positions, inspect review completeness and actual task debit. This is not a whole-repository review.',targetTokens:target};
writeFileSync(`${dir}/plan.json`,JSON.stringify(plan,null,2));console.log(JSON.stringify(plan,null,2));
