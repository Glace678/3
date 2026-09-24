import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFile,splitFile,validateCoverage,applyEdits,encodeEdit,streamReader,renderParts,pack,conservativeCallCap} from './worker.mjs';
import {reserve,reconcile} from './validation-budget.mjs';
import {journalFetch} from './request-journal.mjs';
import {validateAttachmentReceipt} from './attachment-preflight.mjs';
import {compressedActionFetch} from './compressed-transport.mjs';
import {gunzipSync} from 'node:zlib';

test('experimental HTTP gzip preserves exact JSON and leaves OAuth requests alone',async()=>{
  const calls=[],events=[],body=JSON.stringify({input:'原文\n'.repeat(100)});
  const wrapped=compressedActionFetch(async(url,init)=>{calls.push({url,init});return new Response('{}');},e=>events.push(e));
  await wrapped('https://sdkapi.zapier.com/api/v0/sdk/zapier/api/actions/v1/runs',{method:'POST',headers:{'content-type':'application/json','content-length':'999'},body});
  assert.equal(gunzipSync(calls[0].init.body).toString(),body);
  assert.equal(calls[0].init.headers.get('content-encoding'),'gzip');
  assert.equal(calls[0].init.headers.has('content-length'),false);
  assert.equal(events.length,1);
  await wrapped('https://zapier.com/oauth/token',{method:'POST',body:'credential-placeholder'});
  assert.equal(calls[1].init.body,'credential-placeholder');assert.equal(events.length,1);
  await assert.rejects(()=>wrapped(new Request('https://sdkapi.zapier.com/api/v0/sdk/zapier/api/actions/v1/runs',{method:'POST',body})),/Only JSON string/);
  assert.equal(calls.length,2);
});

test('file-input dispatch rejects stale, changed, partial and future download receipts',()=>{
  const now=Date.parse('2026-09-24T01:00:00Z');
  const attachments=[{url:'https://raw.githubusercontent.com/a',sha256:'hash-a',bytes:123},{url:'https://raw.githubusercontent.com/b',sha256:'hash-b',bytes:456}];
  const plan={inputSha256:'payload-hash',attachments};
  const receipt={inputSha256:'payload-hash',verifiedAt:new Date(now-1000).toISOString(),attachments};
  assert.doesNotThrow(()=>validateAttachmentReceipt(plan,receipt,now));
  assert.throws(()=>validateAttachmentReceipt(plan,{...receipt,verifiedAt:new Date(now-900001).toISOString()},now));
  assert.throws(()=>validateAttachmentReceipt(plan,{...receipt,verifiedAt:new Date(now+1).toISOString()},now));
  assert.throws(()=>validateAttachmentReceipt(plan,{...receipt,inputSha256:'changed-payload'},now));
  assert.throws(()=>validateAttachmentReceipt(plan,{...receipt,attachments:attachments.slice(0,1)},now));
  assert.throws(()=>validateAttachmentReceipt(plan,{...receipt,attachments:attachments.map(a=>({...a,sha256:'changed-source'}))},now));
  assert.throws(()=>validateAttachmentReceipt(plan,null,now));
});

test('production task reservation limits model calls even when the loop ceiling is higher',()=>{
  assert.equal(conservativeCallCap(1000,49),49);
  assert.equal(conservativeCallCap(1000,0),0);
  assert.equal(conservativeCallCap(3,49),3);
  assert.throws(()=>conservativeCallCap(1000,50));
  assert.throws(()=>conservativeCallCap(0,49));
});

test('transport journal recovers the action ID without persisting credentials or payloads',async()=>{
  const events=[];
  const wrapped=journalFetch(row=>events.push(row),async()=>new Response(JSON.stringify({data:{id:'1234-abcd',private:'secret-output'}}),{status:201}));
  const response=await wrapped('https://zapier.com/zapier/api/actions/v1/runs?private=secret-query',{method:'POST',headers:{Authorization:'secret-token'},body:'secret-source'});
  assert.equal(response.status,201);assert.equal(events[1].runId,'1234-abcd');
  await wrapped('https://sdkapi.zapier.com/api/v0/sdk/zapier/api/actions/v1/runs',{method:'POST'});
  assert.equal(events.at(-1).runId,'1234-abcd');
  assert.equal(JSON.stringify(events).includes('secret'),false);
  const rejected=journalFetch(row=>events.push(row),async()=>{throw new TypeError('private-secret-error');});
  await assert.rejects(()=>rejected('https://zapier.com/zapier/api/actions/v1/runs',{method:'POST'}));
  assert.equal(events.at(-1).phase,'transport-error');assert.equal(JSON.stringify(events).includes('secret'),false);
});

test('validation budget refuses unreviewed probes, retries, overruns and abnormal account deltas',()=>{
  const first={id:'one',model:'openai/gpt-5.6-luna',reserveTasks:1,baseline:0};
  let ledger=reserve({limitTasks:2,halted:null,runs:[]},first);
  assert.throws(()=>reserve(ledger,{...first,id:'two'}));
  ledger.runs[0].status='finished';
  ledger=reconcile(ledger,'one',0,'Native call succeeded; zero observed, reserve retained.');
  assert.throws(()=>reserve({...ledger,limitTasks:80,checkpointTasks:1},{...first,id:'two'}),/checkpoint reached/);
  assert.throws(()=>reserve({...ledger,checkpointTasks:81},{...first,id:'two'}),/Invalid report checkpoint/);
  assert.throws(()=>reserve(ledger,first));
  assert.throws(()=>reserve(ledger,{...first,id:'two',baseline:1}));
  ledger=reserve(ledger,{...first,id:'two'});ledger.runs[1].status='finished';
  const normal=reconcile(ledger,'two',1,'Expected single task.');
  assert.throws(()=>reserve(normal,{...first,id:'three',baseline:1}));
  const abnormal=reconcile(ledger,'two',3,'Unexpected debit; stop.');
  assert.match(abnormal.halted,/Unexpected task delta/);
  assert.throws(()=>reserve({...abnormal,limitTasks:80},{...first,id:'three',baseline:3}));
});

test('actual-debit mode counts observed usage, blocks unresolved bills and stops if a free route charges',()=>{
  const probe={id:'next',model:'openai/gpt-5.6-luna',reserveTasks:1,expectedTasks:0,pricingBasis:'sdk-free-beta-confirmed',baseline:1};
  const past=Array.from({length:90},(_,i)=>({id:String(i),reserveTasks:1,reflection:'reconciled',observation:{tasks:1}}));
  const base={budgetMode:'actual-debits',limitTasks:75,checkpointTasks:50,halted:null,runs:past};
  let ledger=reserve(base,probe);
  assert.equal(ledger.runs.length,91);
  assert.throws(()=>reserve({...base,billingReconciliationPending:true},probe),/Reconcile known run/);
  assert.throws(()=>reserve(base,{...probe,pricingBasis:'assumed'}),/Unverified/);
  ledger.runs.at(-1).status='finished';
  assert.equal(reconcile(ledger,'next',1,'No charge observed.').halted,null);
  assert.match(reconcile(ledger,'next',2,'SDK rate unexpectedly changed; stop.').halted,/Unexpected task delta/);
  const atLimit={...base,checkpointTasks:75,runs:past.map(r=>({...r,observation:{tasks:75}}))};
  assert.throws(()=>reserve(atLimit,{...probe,baseline:75,expectedTasks:1}),/budget exhausted/);
});

test('only the fixed native file utility is allowed and rejection reflection cannot clear a billing anomaly',()=>{
  const probe={id:'store',kind:'native-file-store',model:null,app:'FilesByZapierCLIAPI@1.3.5',action:'file_from_text',reserveTasks:1,baseline:0};
  const base={limitTasks:80,checkpointTasks:50,halted:null,runs:[]};
  const ledger=reserve(base,probe);
  assert.throws(()=>reserve(base,{...probe,app:'AnotherApp'}));
  ledger.runs[0].status='failed';ledger.runs[0].failure={definitiveRejection:true};
  ledger.halted='Probe store failed or has uncertain submission; inspect saved transport facts without resubmitting';
  assert.equal(reconcile(ledger,'store',0,'HTTP 400 rejected; no repeat.').halted,null);
  assert.match(reconcile(ledger,'store',2,'Unexpected charge.').halted,/Unexpected task delta/);
  ledger.halted='Unexpected task delta 2 for earlier';
  assert.equal(reconcile(ledger,'store',0,'Still preserve anomaly.').halted,ledger.halted);
});
import {Readable} from 'node:stream';
import {confirmsFreeSdk,requireFreeSdk,nativeInputs,validateCompactCoverage,executeNative} from './native-sdk.mjs';
import {storeResult,loadResult} from './result-store.mjs';
test('batch Git stream preserves headers and binary bodies across arbitrary chunks',async()=>{
  const source=Buffer.from('abc blob 5\na\n\0xy\nxyz blob 0\n\n');
  const reader=streamReader(Readable.from([...source].map(x=>Buffer.from([x]))));
  assert.equal(await reader.line(),'abc blob 5');
  assert.deepEqual(await reader.bytes(5),Buffer.from('a\n\0xy'));
  assert.deepEqual(await reader.bytes(1),Buffer.from('\n'));
  assert.equal(await reader.line(),'xyz blob 0');
  assert.equal((await reader.bytes(0)).length,0);
  await reader.bytes(1);
  await assert.rejects(reader.line(),/Unexpected end/);
});
test('all lines survive chunking, including CRLF and last line',()=>{
  const text=Array.from({length:31},(_,i)=>`line ${i}\r\n`).join('')+'last';
  const parts=splitFile({path:'src/x.cpp',sha256:'x',text},20,100);
  assert.equal(parts.map(x=>x.text).join(''),text);
  let next=1;for(const p of parts){assert.equal(p.start_line,next);next=p.end_line+1;}
  assert.equal(next,33);
});
test('coverage gaps cannot be reported as complete',()=>{
  const expected=[{file:'x',start_line:1,end_line:10}];
  assert.throws(()=>validateCoverage(expected,[{file:'x',start_line:1,end_line:4},{file:'x',start_line:6,end_line:10}]));
  validateCoverage(expected,[{file:'x',start_line:1,end_line:5},{file:'x',start_line:6,end_line:10}]);
});
test('oversized single line fails without truncation',()=>assert.throws(()=>splitFile({path:'x',text:'x'.repeat(100)},20,50)));
test('unresolved source encodings remain addressable and LFS pointers are tracked text',()=>{
  assert.equal(decodeFile('x.cpp',Buffer.from([255,254,255])).encoding,'byte-escaped-unknown');
  assert.equal(decodeFile('x.cpp',Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:123')).text,'version https://git-lfs.github.com/spec/v1\noid sha256:123');
  assert.equal(decodeFile('image.png',Buffer.from([0,1,2])),null);
});
test('UTF-16 source is covered, never silently classified binary',()=>{
  assert.equal(decodeFile('x.cs',Buffer.concat([Buffer.from([255,254]),Buffer.from('hello','utf16le')])).text,'hello');
});
test('Git-declared binary assets are classified while UTF-8 BOM is preserved',()=>{
  assert.equal(decodeFile('Data/asset.bmd',Buffer.from([255,1,2]),true),null);
  assert.equal(decodeFile('source.cpp',Buffer.from([255,1,2]),true),null);
  assert.equal(decodeFile('x.js',Buffer.from('\uFEFFconst x=1;')).text,'\uFEFFconst x=1;');
});
test('legacy Korean source roundtrips; fixtures retain non-ASCII bytes',()=>{
  const bytes=Buffer.from([47,47,32,0xb0,0xb3,10]);
  const decoded=decodeFile('MuMain/src/source/test.h',bytes);
  assert.equal(decoded.encoding,'cp949');
  assert.equal(decoded.text,'// 개\n');
  assert.deepEqual(encodeEdit(decoded.text,decoded.encoding),bytes);
  assert.throws(()=>encodeEdit('😀','cp949'));
  assert.equal(decodeFile('fixture.txt',Buffer.from([255,10])).text,'\\xff\n');
});
test('declared HTML charset is respected without losing bytes',()=>{
  const bytes=Buffer.concat([Buffer.from('<meta charset=iso-8859-1>Fr'),Buffer.from([252]),Buffer.from('vous')]);
  const decoded=decodeFile('spec.html',bytes);
  assert.equal(decoded.encoding,'iso-8859-1');
  assert.deepEqual(encodeEdit(decoded.text,decoded.encoding),bytes);
});
const files=new Map([['src/x.js',{text:'const n = 1;\n',encoding:'utf-8'}]]);
test('exact patch works and identical patches deduplicate',()=>{
  const patch={path:'src/x.js',old_text:'n = 1',new_text:'n = 2'};
  assert.equal(applyEdits(files,[patch,patch]).get('src/x.js'),'const n = 2;\n');
});
test('conflicts, ambiguous originals and unsafe paths are rejected',()=>{
  assert.throws(()=>applyEdits(files,[{path:'../x',old_text:'x',new_text:'y'}]));
  assert.throws(()=>applyEdits(files,[{path:'.github/workflows/x.yml',old_text:'x',new_text:'y'}]));
  assert.throws(()=>applyEdits(files,[{path:'src/x.js',old_text:'missing',new_text:'y'}]));
  assert.throws(()=>applyEdits(new Map([['x',{text:'aa aa',encoding:'utf-8'}]]),[{path:'x',old_text:'aa',new_text:'b'}]));
});

test('identical content is sent once while all file paths remain auditable',()=>{
  const text='function example() { return 12345; }\n'.repeat(100);
  const parts=['first.js','copy.js'].map(file=>({file,start_line:1,end_line:100,sha256:'same',encoding:'utf-8',text}));
  const chunks=pack(parts,3000,100000);
  assert.equal(chunks.length,1);
  assert.deepEqual(chunks[0].map(p=>p.file).sort(),['copy.js','first.js']);
  const rendered=renderParts(chunks[0]);
  assert.equal(rendered.split(text).length,2);
  assert.ok(rendered.includes(`Exact content duplicate of ${JSON.stringify(chunks[0][0].file)}`));
  assert.match(rendered,/"copy.js" lines 1-100/);
  assert.throws(()=>validateCoverage(chunks[0],[{file:'first.js',start_line:1,end_line:100}]));
});

test('patches resolve against original positions and reject chained or overlapping edits',()=>{
  const source=new Map([['x',{text:'alpha beta gamma',encoding:'utf-8'}]]);
  const edits=[{path:'x',old_text:'alpha',new_text:'beta'},{path:'x',old_text:'beta',new_text:'delta'}];
  assert.equal(applyEdits(source,edits).get('x'),'beta delta gamma');
  assert.equal(applyEdits(source,[...edits].reverse()).get('x'),'beta delta gamma');
  assert.throws(()=>applyEdits(source,[{path:'x',old_text:'alpha',new_text:'created'},{path:'x',old_text:'created',new_text:'chain'}]));
  assert.throws(()=>applyEdits(source,[{path:'x',old_text:'alpha beta',new_text:'first'},{path:'x',old_text:'beta gamma',new_text:'second'}]));
});

test('billing guard requires the SDK section itself to remain free',async()=>{
  assert.equal(confirmsFreeSdk('<h3>SDK <span>Beta</span></h3><p>Actions</p><p>Free in beta</p><h2>Automation tools</h2>'),true);
  assert.equal(confirmsFreeSdk('Other product Free in beta SDK Beta Actions 1 task per call Automation tools'),false);
  assert.equal(confirmsFreeSdk('<script>SDK Beta Actions Free in beta Automation tools</script>'),false);
  await assert.rejects(requireFreeSdk(async()=>({ok:true,text:async()=>'<h1>Sign in</h1>'})),/Stopped before model/);
});

test('compact coverage binds all file ranges to the exact manifest',()=>{
  const manifest=[{file:'a',start_line:1,end_line:8},{file:'b',start_line:1,end_line:4}];
  const inputs=nativeInputs({mode:'review',issue:{title:'review'},repo:'Glace678/3',commit:'abc',manifest,source:'data'});
  const report={manifest_sha256:inputs.inputFields.manifest_sha256,ranges:[[0,1]]};
  validateCompactCoverage(manifest,report);
  assert.throws(()=>validateCompactCoverage(manifest,{...report,ranges:[[0,0]]}));
  assert.throws(()=>validateCompactCoverage(manifest,{...report,ranges:[[0,2]]}));
  assert.throws(()=>validateCompactCoverage([...manifest,{file:'c'}],report));
  assert.equal(inputs.authentication_id,'0');
  assert.equal(inputs.model_id,'openai/gpt-5.6-luna');
  assert.equal(inputs.includeWorkflowData,false);
  assert.equal(inputs.tools,undefined);
});

test('native SDK execution persists its ID and resumes without a second creation',async()=>{
  let creates=0,checks=0;const saves=[];
  const output={status:'completed',review_json:'[]',patch_json:'[]',needs_context_json:'{"files":[]}',covered_ranges_json:'{}'};
  const sdk={createActionRun:async()=>{creates++;return {data:{id:'run-1'}};},getActionRun:async()=>({data:{status:'success',results:[output],errors:[]}})};
  const save=async x=>saves.push(x);
  await executeNative({sdk,record:{status:'queued'},save,inputs:{},assertFree:async()=>{checks++;}});
  assert.equal(creates,1);assert.equal(checks,1);
  assert.equal(saves[0].status,'starting');assert.deepEqual(JSON.parse(saves[1].review_json),{sdk_run_id:'run-1'});
  await executeNative({sdk,record:{status:'running',review_json:saves[1].review_json},save,inputs:{}});
  assert.equal(creates,1);
  await assert.rejects(executeNative({sdk,record:{status:'starting'},save,inputs:{}}),/uncertain/);
});

test('pricing uncertainty prevents SDK model submission',async()=>{
  let creates=0,saves=0;
  await assert.rejects(executeNative({sdk:{createActionRun:async()=>{creates++;}},record:{status:'queued'},save:async()=>{saves++;},inputs:{},assertFree:async()=>{throw Error('pricing changed');}}),/pricing changed/);
  assert.equal(creates,0);assert.equal(saves,0);
});

test('long model reports roundtrip through bounded table fields without another inference',async()=>{
  const rows=new Map();let record,creates=0,modelCalls=0;
  const output={status:'completed',review_json:JSON.stringify([{description:'完整报告😀'.repeat(6000)}]),patch_json:'[]',needs_context_json:'{"files":[]}',covered_ranges_json:'{}'};
  const find=async key=>rows.get(key);
  const save=data=>storeResult({output:data,key:'job:chunk',metadata:{job_id:'job'},find,create:async row=>{creates++;assert.ok(row.review_json.length<=8000);assert.equal(Buffer.from(row.review_json).toString(),row.review_json);rows.set(row.dedupe_key,row);},update:async data=>{record=data;}});
  const sdk={createActionRun:async()=>{modelCalls++;return {data:{id:'run-long'}};},getActionRun:async()=>({data:{status:'success',results:[output],errors:[]}})};
  await executeNative({sdk,record:{status:'queued'},save:async data=>['completed','incomplete','needs_context'].includes(data.status)?save(data):undefined,inputs:{},assertFree:async()=>{}});
  assert.equal(modelCalls,1);assert.ok(creates>1);
  const before=creates;await save(output);assert.equal(creates,before);
  assert.deepEqual(await loadResult(record,'job:chunk',find),output);
  const first=rows.keys().next().value;rows.get(first).review_json+='corrupted';
  await assert.rejects(loadResult(record,'job:chunk',find),/integrity/);
});

test('interrupted result storage resumes from existing segments before finalizing',async()=>{
  const rows=new Map();let fail=true,record={status:'running',review_json:'{"sdk_run_id":"same-run"}'};
  const output={status:'completed',review_json:JSON.stringify([{description:'a'.repeat(20000)}]),patch_json:'[]',needs_context_json:'{"files":[]}',covered_ranges_json:'{}'};
  const args={output,key:'j:c',metadata:{},find:async key=>rows.get(key),create:async row=>{if(rows.size===1&&fail)throw Error('temporary storage failure');rows.set(row.dedupe_key,row);},update:async data=>{record=data;}};
  await assert.rejects(storeResult(args),/storage failure/);
  assert.equal(record.status,'running');assert.equal(rows.size,1);
  fail=false;await storeResult(args);assert.equal(record.status,'completed');
  assert.deepEqual(await loadResult(record,'j:c',args.find),output);
  rows.delete(rows.keys().next().value);
  await assert.rejects(loadResult(record,'j:c',args.find),/missing/);
});
