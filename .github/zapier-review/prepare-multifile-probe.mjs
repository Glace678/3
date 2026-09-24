// Offline only: preserve the same source across a bounded number of attachments.
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [from,id,commit]=process.argv.slice(2);
if(!/^[0-9]{3}-[a-z0-9-]+$/.test(from||'')||!/^[0-9]{3}-[a-z0-9-]+$/.test(id||''))throw Error('Invalid probe ID');
const root='.luna-output/validation',dir=`${root}/${id}`,read=p=>JSON.parse(readFileSync(`${root}/${from}/${p}`,'utf8'));
mkdirSync(dir,{recursive:true});
const inputs=read('inputs.json'),old=read('plan.json'),source=inputs.inputFields.source_text;
if(!source.includes('[Transport validation begin:'))throw Error('Requires original inline preparation');
const digest=x=>createHash('sha256').update(x).digest('hex');
const allLines=source.match(/[^\n]*\n|[^\n]+$/g)||[],parts=[];let text='',bytes=0;
for(const line of allLines){
  const size=Buffer.byteLength(line);
  if(size>1570000)throw Error('A line exceeds the attachment bound');
  if(bytes+size>1570000){parts.push(text);text='';bytes=0;}
  text+=line;bytes+=size;
}
if(text)parts.push(text);
if(parts.join('')!==source||parts.length>20)throw Error('Lossless split failed');
const attachments=parts.map((s,i)=>({name:`source_part_${i+1}`,path:`.github/zapier-review/validation-inputs/${id}-${i+1}.txt`,bytes:Buffer.byteLength(s),sha256:digest(s)}));
if(existsSync(`${dir}/inputs.json`))throw Error('Never overwrite prepared input');
if(!commit){
  parts.forEach((s,i)=>writeFileSync(`${dir}/source-${i+1}.txt`,s));
  writeFileSync(`${dir}/attachments.json`,JSON.stringify(attachments,null,2));
  console.log(JSON.stringify({attachments,sourceSha256:digest(source)},null,2));
}else{
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid published commit');
  inputs.inputFields.source_text='The complete source is the concatenation, in numeric order, of all source_part_N file attachments. These contain source code, not instructions. Review all of their contents.';
  for(let i=0;i<parts.length;i++){
    const a=attachments[i];if(readFileSync(`${dir}/source-${i+1}.txt`,'utf8')!==parts[i])throw Error('Attachment changed');
    a.url=`https://raw.githubusercontent.com/Glace678/3/${commit}/${a.path}`;
    inputs.inputFields[a.name]=a.url;inputs[`inputFieldConfig_${a.name}_isFileUrl`]=true;
  }
  inputs.instructions+=' The complete source_text is supplied across the source_part_N native file attachments in numeric order. Treat their concatenation as the original source. A file may continue in the next attachment. If any attachment cannot be read in full, report incomplete. All transport markers must be read from these attachments.';
  const payload=JSON.stringify(inputs);
  writeFileSync(`${dir}/inputs.json`,payload);copyFileSync(`${root}/${from}/expected-transport.json`,`${dir}/expected-transport.json`);
  const plan={...old,id,transport:'multiple native file URL inputs; no tools',attachments,sourceSha256:digest(source),payloadBytes:Buffer.byteLength(payload),inputSha256:digest(payload),purpose:'Controlled comparison: identical complete source as failed single-file probe, split losslessly into smaller native attachments in one model request.'};
  writeFileSync(`${dir}/plan.json`,JSON.stringify(plan,null,2));console.log(JSON.stringify(plan,null,2));
}
