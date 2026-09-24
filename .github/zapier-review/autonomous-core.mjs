import {jsonrepair} from 'jsonrepair';
import {validateCompactCoverage} from './native-sdk.mjs';
import {repairExclusiveEnd} from './coverage-repair.mjs';

// Read-only mode must be an explicit directive, not a substring in a negation.
export function issueMode(issue){
  if(/^\s*\[review\]/i.test(issue.title||''))return 'review';
  return /^\s*(?:模式|mode)\s*[:：]\s*(?:review|只审核|只审查)\s*$/im.test(issue.body||'')?'review':'fix';
}

export function resolveContext(requested,map){
  if(!Array.isArray(requested)||requested.some(p=>typeof p!=='string'||p.includes('..')||p.startsWith('/')||p.includes('\\')))throw Error('Invalid requested context paths');
  const files=[],resolutions=[];
  for(const path of requested){
    let matches=map.has(path)?[path]:[...map.keys()].filter(p=>p.startsWith(path.replace(/\/$/,'')+'/'));
    if(!matches.length){
      const leaf=path.split('/').at(-1),parent=path.split('/').slice(0,-1).join('/')+'/';
      const candidates=[...map.keys()].filter(p=>p.startsWith(parent)&&(p.endsWith('/'+leaf)||p.includes('/'+leaf+'/')));
      const roots=new Set(candidates.map(p=>p.slice(0,p.indexOf('/'+leaf)+leaf.length+1)));
      if(roots.size===1)matches=candidates;
    }
    if(!matches.length)throw Error(`Requested context not found or ambiguous: ${path}`);
    files.push(...matches);resolutions.push({requested:path,actual:matches});
  }
  return {files:[...new Set(files)],resolutions};
}

export function parseReview(raw){
  try{return {value:JSON.parse(raw),normalized:false};}catch{}
  // Preserve approximate line values, never pretend they were exact numbers.
  const lines=raw.replace(/("line"\s*:\s*)(~\d+)(?=\s*[,}])/g,(_,a,b)=>a+JSON.stringify(b));
  const fixed=jsonrepair(lines);
  const content=s=>s.replace(/["\\\s]/g,'');
  if(content(fixed)!==content(raw))throw Error('Review normalization would add/remove substantive content');
  return {value:JSON.parse(fixed),normalized:true};
}

export function validateAnswer({output,manifest,checks,fixtures,mode}){
  if(output?.status!=='completed')throw Error(`Review not complete: ${output?.status}`);
  const ranges=JSON.parse(output.covered_ranges_json);
  let boundaryNormalized=false;
  try{validateCompactCoverage(manifest,ranges);}catch{
    repairExclusiveEnd(manifest,ranges);boundaryNormalized=true;
  }
  const transport=JSON.parse(output.transport_checks_json);
  if(!Object.entries(checks).every(([k,v])=>transport[k]===v))throw Error('Source attachment markers do not match');
  const review=parseReview(output.review_json),patches=JSON.parse(output.patch_json),context=JSON.parse(output.needs_context_json);
  if(!Array.isArray(review.value)||!Array.isArray(patches))throw Error('Result arrays required');
  if(Object.keys(context).length&&(!Array.isArray(context.files)||context.files.length))throw Error('Missing cross-file context');
  const allowed=new Set(manifest.map(m=>m.file));
  for(const f of review.value)if(!f||typeof f.file!=='string'||!allowed.has(f.file)||typeof f.description!=='string')throw Error('Finding has an invalid source path or description');
  for(const fixture of fixtures){
    const found=review.value.find(f=>f.file===fixture.file&&typeof f.evidence==='string'&&f.evidence.length>8&&fixture.text.includes(f.evidence));
    if(!found)throw Error(`Control missing or lacks exact evidence: ${fixture.file}`);
    const expected=fixture.category==='heap overflow'?/overflow|溢出|越界/:fixture.category==='null dereference'?/null|空指针|空地址/i:/double.?free|twice|二次|两次|重复释放|双重释放/i;
    if(!expected.test(found.description))throw Error(`Control explanation failed: ${fixture.category}`);
  }
  if(mode==='review'&&patches.length)throw Error('Read-only audit returned edits');
  for(const edit of patches)if(!allowed.has(edit.path)||edit.path.startsWith('validation-fixtures/'))throw Error('Patch outside supplied source');
  return {findings:review.value.filter(f=>!f.file.startsWith('validation-fixtures/')),patches,normalization:{review:review.normalized,coverage:boundaryNormalized}};
}

export function checkConfig(config){
  if(config.repo!=='Glace678/3'||config.model!=='openai/gpt-5.6-luna')throw Error('Only configured repository and Zapier-managed Luna are allowed');
  if(!Number.isSafeInteger(config.maxTasks)||config.maxTasks<1||config.maxTasks>74)throw Error('End-to-end budget must be below75 tasks');
  if(!Number.isSafeInteger(config.issue.number)||config.issue.number<1||config.issue.user.login!=='Glace678'||config.issue.pull_request)throw Error('Only owner-created issues are accepted');
  if(typeof config.policy!=='string'||config.policy.length>12000)throw Error('Invalid Zap policy');
  return config;
}
