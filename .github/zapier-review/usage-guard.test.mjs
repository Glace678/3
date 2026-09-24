import test from 'node:test';
import assert from 'node:assert/strict';
import {checkUsage} from './usage-guard.mjs';
test('stop on unexpected spend, missing data, period change and ceiling',()=>{
  const s={},u={count:2,start_period:'2026-09-22'};
  checkUsage(s,u,74);checkUsage(s,{...u,count:3},74);
  assert.throws(()=>checkUsage(s,{...u,count:4},74),/Unexpected/);
  assert.throws(()=>checkUsage(s,{...u,count:74},74),/ceiling/);
  assert.throws(()=>checkUsage(s,{...u,start_period:'new'},74),/period/);
  assert.throws(()=>checkUsage(s,null,74),/unavailable/);
});
