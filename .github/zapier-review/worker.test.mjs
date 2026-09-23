import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFile,splitFile,validateCoverage,applyEdits,encodeEdit} from './worker.mjs';
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
