// Local result checks only; never starts or resumes a model.
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {validateCompactCoverage} from './native-sdk.mjs';
import {decodeFile} from './worker.mjs';
const id=process.argv[2];if(!/^[0-9]{3}-[a-z0-9-]+$/.test(id||''))throw Error('Invalid probe ID');
const dir=`.luna-output/validation/${id}`,read=p=>JSON.parse(readFileSync(`${dir}/${p}`,'utf8'));
const input=read('inputs.json'),result=read('result.json'),plan=read('plan.json');
const output=result.data.results?.[0],manifest=JSON.parse(input.inputFields.manifest_json);
const report={id,estimatedInputTokens:plan.estimatedInputTokens,files:manifest.length,sdkStatus:result.data.status,modelStatus:output?.status,errors:result.data.errors,coverageValid:false,transportChecksValid:false,findings:[],limitations:['Coverage is a model assertion, not proof every defect was found.','Three random markers only test three transport positions.']};
if(output){
  try{validateCompactCoverage(manifest,JSON.parse(output.covered_ranges_json));report.coverageValid=true;}catch(error){report.coverageError=error.message;}
  try{const expected=read('expected-transport.json'),actual=JSON.parse(output.transport_checks_json);report.transportChecksValid=Object.entries(expected).every(([k,v])=>actual[k]===v);}catch{}
  try{
    const findings=JSON.parse(output.review_json);
    if(!Array.isArray(findings))throw Error('Findings must be an array');
    report.findings=findings.map(f=>{
      const checked={...f,locationInsideInput:manifest.some(m=>m.file===f.file&&Number.isSafeInteger(f.line)&&f.line>=m.start_line&&f.line<=m.end_line)};
      if(typeof f.evidence!=='string'||!f.evidence||!manifest.some(m=>m.file===f.file))return checked;
      if(!/^[a-f0-9]{40}$/.test(plan.commit))throw Error('Invalid fixed source commit');
      const source=decodeFile(f.file,execFileSync('git',['show',`${plan.commit}:${f.file}`],{maxBuffer:32*1024*1024})).text;
      if(typeof source!=='string')return checked;
      const start=source.indexOf(f.evidence);
      checked.evidencePresent=start>=0;
      checked.evidenceUnique=start>=0&&source.indexOf(f.evidence,start+1)<0;
      if(checked.evidenceUnique){
        checked.resolvedLine=1+(source.slice(0,start).match(/\n/g)||[]).length;
        checked.reportedLineMatchesEvidence=f.line===checked.resolvedLine;
      }
      return checked;
    });
  }catch(error){report.findingsError=error.message;}
  try{report.requestedContext=JSON.parse(output.needs_context_json);}catch{}
  report.executionId=output._agent_meta?.execution_id;
}
writeFileSync(`${dir}/assessment.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
