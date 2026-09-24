// Creates a text attachment containing the exact prepared source bytes.
// Publishes nothing and invokes no model. URL is filled after a Git commit.
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [from,id,commit]=process.argv.slice(2);
if(!/^[0-9]{3}-[a-z0-9-]+$/.test(from||'')||!/^[0-9]{3}-[a-z0-9-]+$/.test(id||''))throw Error('Invalid probe ID');
const root='.luna-output/validation',dir=`${root}/${id}`,read=p=>JSON.parse(readFileSync(`${root}/${from}/${p}`,'utf8'));
mkdirSync(dir,{recursive:true});
const inputs=read('inputs.json'),old=read('plan.json'),attachment=Buffer.from(inputs.inputFields.source_text,'utf8');
const digest=x=>createHash('sha256').update(x).digest('hex');
const attachmentPath=`.github/zapier-review/validation-inputs/${id}.txt`;
if(!commit){
  if(existsSync(`${dir}/inputs.json`))throw Error('Existing preparation must be preserved');
  writeFileSync(`${dir}/source.txt`,attachment);
  console.log(JSON.stringify({localPath:`${dir}/source.txt`,attachmentPath,bytes:attachment.length,sha256:digest(attachment)}));
}else{
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid published commit');
  if(existsSync(`${dir}/inputs.json`))throw Error('Never overwrite prepared inputs');
  if(!readFileSync(`${dir}/source.txt`).equals(attachment))throw Error('Attachment changed');
  const url=`https://raw.githubusercontent.com/Glace678/3/${commit}/${attachmentPath}`;
  inputs.inputFields.source_text=url;
  inputs.inputFieldConfig_source_text_isFileUrl=true;
  inputs.instructions+=' source_text is a file attachment containing the complete supplied source and three transport markers. Review the attached text in full. If it is unavailable or truncated, report incomplete; do not claim URL text is the file contents.';
  const payload=JSON.stringify(inputs);
  writeFileSync(`${dir}/inputs.json`,payload);
  copyFileSync(`${root}/${from}/expected-transport.json`,`${dir}/expected-transport.json`);
  const plan={...old,id,transport:'Zapier supported file URL input, no tools',payloadBytes:Buffer.byteLength(payload),inputSha256:digest(payload),attachmentUrl:url,attachmentSha256:digest(attachment),attachmentBytes:attachment.length,purpose:'Test full source as a native file input; bypassing the body-size limit is useful only if contents and coverage survive.'};
  writeFileSync(`${dir}/plan.json`,JSON.stringify(plan,null,2));console.log(JSON.stringify(plan,null,2));
}
