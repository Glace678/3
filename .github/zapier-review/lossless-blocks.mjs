import {createHash,randomBytes} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function reusableBlocks(text){
  const out=[];let start=0,size=0;
  for(let end=0;end<text.length;end++){
    size++;if(text[end]!=='\n')continue;
    const lineStart=text.lastIndexOf('\n',end-1)+1;let h=2166136261;
    for(let p=lineStart;p<end;p++)h=Math.imul(h^text.charCodeAt(p),16777619);
    if(size>=8192||(size>=512&&(h&31)===0)){out.push(text.slice(start,end+1));start=end+1;size=0;}
  }
  if(start<text.length)out.push(text.slice(start));return out;
}
export function blockIndex(parts,count){
  const blocks=new Map(),byHash=new Map(),entries=[];
  for(const {text,...m}of parts){
    const ids=[];
    for(const piece of reusableBlocks(text)){
      const key=hash(piece);let id=byHash.get(key);
      if(id===undefined){id=blocks.size.toString(36);byHash.set(key,id);blocks.set(id,{id,text:piece,tokens:count(piece),bytes:Buffer.byteLength(piece)});}
      else if(blocks.get(id).text!==piece)throw Error('Block hash collision');
      ids.push(id);
    }
    const entry={...m,block_ids:ids};
    if(reconstruct(entry,blocks)!==text)throw Error('Lossless block reconstruction failed');
    entries.push(entry);
  }
  return {blocks,entries};
}
export function reconstruct(entry,blocks){return entry.block_ids.map(id=>{if(!blocks.has(id))throw Error('Missing block definition');return blocks.get(id).text;}).join('');}
export function renderBlockView(entries,blocks){
  const ids=[...new Set(entries.flatMap(m=>m.block_ids))];
  const prefix='BLOCK_'+randomBytes(6).toString('hex');
  if(ids.some(id=>blocks.get(id).text.includes(prefix)))throw Error('Random delimiter collision');
  const checks=Object.fromEntries(['begin','middle','end'].map(k=>[k,randomBytes(12).toString('hex')]));
  const marker=k=>`\n[Transport validation ${k}: ${checks[k]}]\n`;
  let source=marker('begin');
  for(let i=0;i<ids.length;i++){
    if(i===Math.floor(ids.length/2))source+=marker('middle');
    const b=blocks.get(ids[i]);
    source+=`\n===== ${prefix} id=${b.id} chars=${b.text.length} =====\n${b.text}\n===== END_${prefix} id=${b.id} =====\n`;
  }
  source+=marker('end');
  return {manifest:entries,source,checks,uniqueBlocks:ids.length,blockOccurrences:entries.reduce((n,e)=>n+e.block_ids.length,0)};
}
export const blockInstructions=' Source text is an exact-content dictionary. Each manifest entry has block_ids in original file order. Reconstruct its supplied line range by concatenating those definitions in order; repeated IDs reuse exactly the same original text. All referenced definitions are included in this request. Random BLOCK delimiters, chars metadata, and transport markers are framing, not source. Review each file context and every original supplied line; do not replace review with dictionary statistics. No original comments, whitespace, generated code or vendor content was deleted. Return needs_context if required relationships cannot be resolved.';

export function renderCompactBlocks(entries,blocks){
  const ids=[...new Set(entries.flatMap(e=>e.block_ids))];
  const checks=Object.fromEntries(['begin','middle','end'].map(k=>[k,randomBytes(12).toString('hex')]));
  let source='';
  const marker=k=>{source+=`\n[Transport validation ${k}: ${checks[k]}]\n`;};
  marker('begin');
  ids.forEach((id,i)=>{if(i===Math.floor(ids.length/2))marker('middle');const b=blocks.get(id);source+=`\n@B ${id} ${b.text.length}\n${b.text}`;});
  marker('end');
  // Length framing is unambiguous even if original text contains an apparent header.
  const parsed=parseCompactBlocks(source);
  for(const id of ids)if(parsed.get(id)?.text!==blocks.get(id).text)throw Error('Rendered block changed original contents');
  return {source,checks,manifest:entries,uniqueBlocks:ids.length};
}
export function parseCompactBlocks(source){
  const blocks=new Map();let at=0;
  while(at<source.length){
    const tail=source.slice(at),marker=tail.match(/^\n\[Transport validation (?:begin|middle|end): [a-f0-9]{24}\]\n/);
    if(marker){at+=marker[0].length;continue;}
    const header=tail.match(/^\n@B ([a-z0-9]+) ([0-9]+)\n/);
    if(!header)throw Error('Malformed compact block frame');
    at+=header[0].length;const length=Number(header[2]);
    if(!Number.isSafeInteger(length)||at+length>source.length||blocks.has(header[1]))throw Error('Invalid compact block length or ID');
    blocks.set(header[1],{id:header[1],text:source.slice(at,at+length)});at+=length;
  }
  return blocks;
}
export const compactBlockInstructions=' The attachment is a lossless source dictionary. A frame is newline + @B + block ID + JavaScript UTF-16 character count + newline + that exact number of source characters. Framing and three Transport validation markers are not original source. Each manifest entry lists block_ids in original order: concatenate their definitions to obtain its exact supplied file segment. All referenced blocks are included. Reused blocks must be assessed in each file context; comments, whitespace, vendor and generated code remain intact. start_char/end_char are zero-based UTF-16 offsets in the decoded original file; end_char is exclusive. A split may be within a very long line. Review every supplied character and line, and request exact paths for unresolved dependencies. Do not infer review completion from the dictionary statistics.';
