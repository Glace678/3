import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFile,splitFile,validateCoverage,applyEdits} from './worker.mjs';
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
