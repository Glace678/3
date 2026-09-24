// Download only public, commit-pinned input fixtures. No Zapier/model requests.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const id=process.argv[2];if(!/^[0-9]{3}-[a-z0-9-]+$/.test(id||''))throw Error('Invalid probe ID');
const dir=`.luna-output/validation/${id}`,plan=JSON.parse(readFileSync(`${dir}/plan.json`,'utf8'));
const attachments=plan.attachments||(plan.attachmentUrl?[{url:plan.attachmentUrl,sha256:plan.attachmentSha256,bytes:plan.attachmentBytes}]:[]);
if(!attachments.length)throw Error('No attachment plan');
const checked=[];
try{
  for(const a of attachments){
    const url=new URL(a.url);
    if(url.protocol!=='https:'||url.host!=='raw.githubusercontent.com'||!/^\/Glace678\/3\/[a-f0-9]{40}\/\.github\/zapier-review\/validation-inputs\/[a-z0-9-]+\.txt$/.test(url.pathname)||url.search)throw Error('Unapproved attachment location');
    const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Error(`Attachment HTTP ${r.status}`);
    const bytes=Buffer.from(await r.arrayBuffer()),sha256=createHash('sha256').update(bytes).digest('hex');
    if(sha256!==a.sha256||bytes.length!==a.bytes)throw Error('Attachment content differs from prepared source');
    checked.push({url:a.url,sha256,bytes:bytes.length});
  }
  const receipt={id,inputSha256:plan.inputSha256,verifiedAt:new Date().toISOString(),attachments:checked};
  writeFileSync(`${dir}/attachment-verification.json`,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({id,verifiedAttachments:checked.length,verifiedBytes:checked.reduce((s,a)=>s+a.bytes,0),modelRequests:0}));
}catch(e){console.error(JSON.stringify({id,preflightFailed:true,error:e.message,modelRequests:0}));process.exitCode=1;}
