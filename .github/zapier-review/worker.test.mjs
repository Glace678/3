import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFile,splitFile,validateCoverage,applyEdits,encodeEdit,streamReader,renderParts,pack} from './worker.mjs';
import {Readable} from 'node:stream';
import {confirmsFreeSdk,requireFreeSdk,nativeInputs,validateCompactCoverage,executeNative} from './native-sdk.mjs';
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
test('unresolved source encodings and LFS pointers fail explicitly',()=>{
  assert.throws(()=>decodeFile('x.cpp',Buffer.from([255,254,255])));
  assert.throws(()=>decodeFile('x.cpp',Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:123')));
  assert.equal(decodeFile('image.png',Buffer.from([0,1,2])),null);
});
test('UTF-16 source is covered, never silently classified binary',()=>{
  assert.equal(decodeFile('x.cs',Buffer.concat([Buffer.from([255,254]),Buffer.from('hello','utf16le')])).text,'hello');
});
test('Git-declared binary assets are classified while UTF-8 BOM is preserved',()=>{
  assert.equal(decodeFile('Data/asset.bmd',Buffer.from([255,1,2]),true),null);
  assert.throws(()=>decodeFile('source.cpp',Buffer.from([255,1,2]),true));
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
