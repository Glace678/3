import {hash,applyEdits,encodeEdit} from './worker.mjs';

export function safePath(path){
  if(typeof path!=='string'||!path||/[\\\x00-\x1f:]/.test(path)||path.startsWith('/')||path.split('/').some(x=>!x||x==='.'||x==='..'||/^\.git$/i.test(x)))throw Error('Unsafe Git path');
  return path;
}
function decode64(value){
  if(typeof value!=='string'||value.length%4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('Noncanonical base64');
  const b=Buffer.from(value,'base64');if(b.toString('base64')!==value)throw Error('Noncanonical base64');return b;
}
// Pure planning against an immutable tree. Never write or follow a symlink locally.
export function planOperations(entries,textFiles,operations,readBlob){
  const output=new Map(),text=[],seen=new Set();
  const put=(path,value)=>{safePath(path);if(output.has(path))throw Error('Conflicting operations: '+path);output.set(path,value);};
  for(const op of operations){
    const sig=JSON.stringify(op);if(seen.has(sig))continue;seen.add(sig);
    const path=safePath(op.path),old=entries.get(path),kind=op.op||'text';
    if(kind==='text'){text.push(op);continue;}
    if(kind==='create'){
      if(old)throw Error('Create would overwrite existing path');
    }else{
      if(!old||old.type!=='blob')throw Error('Operation needs an existing blob');
      if(op.expected_sha256!==hash(readBlob(old)))throw Error('Original byte hash mismatch');
    }
    const mode=op.mode||old?.mode||'100644';
    if(!['100644','100755','120000'].includes(mode))throw Error('Invalid blob mode');
    if(kind==='delete'){put(path,null);continue;}
    if(kind==='rename'){
      const to=safePath(op.to);if(entries.has(to))throw Error('Rename destination exists');
      put(path,null);put(to,{mode,bytes:readBlob(old)});continue;
    }
    if(kind==='chmod'){put(path,{mode,bytes:readBlob(old)});continue;}
    if(!['create','replace'].includes(kind))throw Error('Unknown operation');
    if((op.content_base64!==undefined)===(op.content_hex!==undefined))throw Error('Exactly one byte representation required');
    let bytes;
    if(op.content_hex!==undefined){if(typeof op.content_hex!=='string'||!/^(?:[0-9a-fA-F]{2})*$/.test(op.content_hex))throw Error('Invalid hex bytes');bytes=Buffer.from(op.content_hex,'hex');}
    else bytes=decode64(op.content_base64);
    if(op.result_sha256!==undefined&&op.result_sha256!==hash(bytes))throw Error('Result byte hash mismatch');
    if(bytes.length>50*1024*1024)throw Error('Blob exceeds GitHub upload safety limit; use LFS materialization');
    if(mode==='120000'&&(bytes.includes(0)||!bytes.length))throw Error('Invalid symlink target');
    put(path,{mode,bytes});
  }
  for(const [path,value]of applyEdits(textFiles,text)){
    safePath(path);const old=entries.get(path);if(!old||old.type!=='blob')throw Error('Text target missing');
    put(path,{mode:old.mode,bytes:encodeEdit(value,textFiles.get(path).encoding)});
  }
  const finalPaths=new Set([...entries.keys()].filter(p=>output.get(p)!==null));
  for(const [path,value]of output)if(value)finalPaths.add(path);
  for(const path of finalPaths){const parts=path.split('/');parts.pop();while(parts.length){if(finalPaths.has(parts.join('/')))throw Error('File/directory collision');parts.pop();}}
  return output;
}

export const operationInstructions=`The file operation protocol also supports ALL blob formats, including binary, unknown encodings, .github configuration and symlinks. Legacy {path,old_text,new_text} edits remain valid. For byte replacement use {op:"replace",path,expected_sha256,content_base64,result_sha256,mode}; creation uses op:"create" without expected_sha256. Delete: {op:"delete",path,expected_sha256}. Rename: {op:"rename",path,to,expected_sha256}. Permission/type change: {op:"chmod",path,mode,expected_sha256}. Modes: 100644 regular, 100755 executable, 120000 symlink (base64 contains link target text). Instead of content_base64, you may supply content_hex: an even-length string of hexadecimal digits, no whitespace or prefix. Supply exactly one representation. Prefer content_hex for short binary/encoded changes to avoid Base64 arithmetic mistakes. All hashes are SHA256 of raw bytes. expected_sha256 is required for existing files and supplied in context. result_sha256 is optional; omit it if you cannot compute it. The executor computes the output hash. Existing binary context is base64 with encoding=base64; decode it before assessing its format. Never invent binary contents or hashes. Request exact missing paths via needs_context. New files need no existing manifest entry. Changes to repository workflows are uploaded only to a draft PR; no generated code or workflow is executed by this worker. Output-size limits still apply; return incomplete if a complete valid operation cannot fit.`;
