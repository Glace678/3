import {createHash} from 'node:crypto';

const sha=s=>createHash('sha256').update(s).digest('hex');
const markerKey='__luna_result_v1';
const fields=['status','review_json','patch_json','needs_context_json','covered_ranges_json'];

export function resultSegments(text,size=8000){
  const out=[];
  for(let start=0;start<text.length;){
    let end=Math.min(text.length,start+size);
    if(end<text.length&&text.charCodeAt(end-1)>=0xD800&&text.charCodeAt(end-1)<=0xDBFF)end--;
    out.push(text.slice(start,end));start=end;
  }
  return out;
}

// Tables have a 10,000-character field limit. Store a long result in free table
// records instead of forcing the model to re-review the same source in smaller jobs.
export async function storeResult({output,key,metadata,find,create,update}){
  const result=Object.fromEntries(fields.map(k=>[k,output[k]]));
  if(fields.slice(1).every(k=>typeof result[k]==='string'&&result[k].length<=10000))return update(result);
  const serialized=JSON.stringify(result),parts=resultSegments(serialized),digest=sha(serialized);
  if(parts.length>128)throw Error('Result exceeds storage allowance; preserve SDK execution ID and resume after increasing storage, never re-run inference');
  for(let index=0;index<parts.length;index++){
    const dedupe_key=`result:${key}:${digest}:${index}`,existing=await find(dedupe_key);
    if(existing){if(existing.review_json!==parts[index])throw Error('Saved result segment mismatch');continue;}
    await create({...metadata,dedupe_key,status:'result_part',review_json:parts[index]});
  }
  return update({status:result.status,review_json:JSON.stringify({[markerKey]:{sha256:digest,parts:parts.length,length:serialized.length}}),patch_json:'[]',needs_context_json:'{"files":[]}',covered_ranges_json:'{}'});
}

export async function loadResult(record,key,find){
  if(!['completed','incomplete','needs_context'].includes(record.status))return record;
  const manifest=JSON.parse(record.review_json)?.[markerKey];
  if(!manifest)return record;
  if(!Number.isSafeInteger(manifest.parts)||manifest.parts<1||manifest.parts>128||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw Error('Invalid saved result manifest');
  let serialized='';
  for(let index=0;index<manifest.parts;index++){
    const part=await find(`result:${key}:${manifest.sha256}:${index}`);
    if(part?.status!=='result_part'||typeof part.review_json!=='string')throw Error('Saved result segment missing; do not resubmit model');
    serialized+=part.review_json;
  }
  if(serialized.length!==manifest.length||sha(serialized)!==manifest.sha256)throw Error('Saved result integrity mismatch');
  const output=JSON.parse(serialized);
  if(output.status!==record.status||fields.some(k=>typeof output[k]!=='string'))throw Error('Invalid saved result');
  return {...record,...output};
}
