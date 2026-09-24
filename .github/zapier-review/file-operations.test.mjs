import test from 'node:test';
import assert from 'node:assert/strict';
import {planOperations,safePath} from './file-operations.mjs';
import {hash} from './worker.mjs';
const binary=Buffer.from([0,255,128,13,10]);
const entries=new Map([['asset.bmd',{mode:'100644',type:'blob',bytes:binary}],['.github/workflows/build.yml',{mode:'100644',type:'blob',bytes:Buffer.from('name: old\n')}]]);
const texts=new Map([['.github/workflows/build.yml',{encoding:'utf-8',text:'name: old\n'}]]);
const plan=ops=>planOperations(entries,texts,ops,e=>e.bytes);
const create=(path,bytes,mode='100644')=>({op:'create',path,mode,content_base64:bytes.toString('base64'),result_sha256:hash(bytes)});
test('binary replacement preserves arbitrary bytes and verifies both hashes',()=>{
  const bytes=Buffer.from([255,0,254,1]);
  const op={...create('asset.bmd',bytes),op:'replace',expected_sha256:hash(binary)};
  assert.deepEqual(plan([op]).get('asset.bmd').bytes,bytes);
  assert.throws(()=>plan([{...op,expected_sha256:'bad'}]),/Original/);
  assert.throws(()=>plan([{...op,result_sha256:'bad'}]),/Result/);
});
test('github configuration, executable and symlink are real tree changes',()=>{
  const changes=plan([{path:'.github/workflows/build.yml',old_text:'old',new_text:'new'},create('tools/run.sh',Buffer.from('#!/bin/sh\n'),'100755'),create('link',Buffer.from('asset.bmd'),'120000')]);
  assert.equal(changes.get('.github/workflows/build.yml').bytes.toString(),'name: new\n');
  assert.equal(changes.get('tools/run.sh').mode,'100755');
  assert.equal(changes.get('link').mode,'120000');
});
test('rename, deletion and mode-only edits retain fixed-snapshot checks',()=>{
  const rename=plan([{op:'rename',path:'asset.bmd',to:'assets/new.bmd',expected_sha256:hash(binary)}]);
  assert.equal(rename.get('asset.bmd'),null);assert.deepEqual(rename.get('assets/new.bmd').bytes,binary);
  assert.equal(plan([{op:'delete',path:'asset.bmd',expected_sha256:hash(binary)}]).get('asset.bmd'),null);
  assert.equal(plan([{op:'chmod',path:'asset.bmd',mode:'100755',expected_sha256:hash(binary)}]).get('asset.bmd').mode,'100755');
});
test('unknown encodings and UTF16 can be changed losslessly using raw bytes',()=>{
  for(const bytes of [Buffer.from([255,254,97,0]),Buffer.from([129,254,0,3]),Buffer.alloc(0)])assert.deepEqual(plan([create('new.dat',bytes)]).get('new.dat').bytes,bytes);
});
test('conflicts, overwrites, invalid bytes and traversal cannot publish a tree',()=>{
  for(const p of ['../x','/x','a//b','.GIT/config','a/./b','C:/x','a\\b'])assert.throws(()=>safePath(p));
  assert.throws(()=>plan([create('asset.bmd',binary)]),/overwrite/);
  assert.throws(()=>plan([create('asset.bmd/x',binary)]),/collision/);
  assert.throws(()=>plan([{...create('new',binary),content_base64:'!bad'}]),/base64/);
  assert.throws(()=>plan([create('new',binary),create('new',Buffer.from('other'))]),/Conflicting/);
  assert.throws(()=>plan([create('link',Buffer.from([0]),'120000')]),/symlink/);
});
