import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {repairExclusiveEnd} from './coverage-repair.mjs';
test('only a nonexistent inclusive final index is removed; gaps and wrong manifests remain failures',()=>{
  const manifest=[{file:'a'},{file:'b'},{file:'c'}];
  const manifest_sha256=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const raw={manifest_sha256,ranges:[[0,3]]};
  assert.deepEqual(repairExclusiveEnd(manifest,raw).ranges,[[0,2]]);
  assert.deepEqual(raw.ranges,[[0,3]]);
  for(const ranges of [[[1,3]],[[0,0],[2,3]],[[-1,3]],[[0,4]],[[0,2]]])assert.throws(()=>repairExclusiveEnd(manifest,{manifest_sha256,ranges}));
  assert.throws(()=>repairExclusiveEnd(manifest,{...raw,manifest_sha256:'different'}));
});
