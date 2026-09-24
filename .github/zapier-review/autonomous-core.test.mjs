import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReview,validateAnswer,checkConfig} from './autonomous-core.mjs';
import {hash} from './worker.mjs';
test('formatting repairs preserve approximate line uncertainty and reject invented structure',()=>{
  assert.equal(parseReview('[{"line":~780,"description":"approximate line"}]').value[0].line,'~780');
  assert.throws(()=>parseReview('[{"file":"missing-end"}'),/substantive/);
});
test('cloud configuration cannot enable another model, owner or an excessive budget',()=>{
  const good={repo:'Glace678/3',model:'openai/gpt-5.6-luna',maxTasks:74,policy:'Review all source',issue:{number:7,user:{login:'Glace678'}}};
  assert.equal(checkConfig(good),good);
  assert.throws(()=>checkConfig({...good,maxTasks:75}));assert.throws(()=>checkConfig({...good,model:'local'}));
  assert.throws(()=>checkConfig({...good,issue:{number:7,user:{login:'outsider'}}}));
});
test('automatic acceptance rejects missing source, bad controls and edits in a read-only audit',()=>{
  const manifest=[{file:'validation-fixtures/test.c',start_char:0,end_char:20}];
  const fixtures=[{file:manifest[0].file,category:'double free',text:'free(p); free(p);'}],checks={begin:'a',middle:'b',end:'c'};
  const output={status:'completed',covered_ranges_json:JSON.stringify({manifest_sha256:hash(JSON.stringify(manifest)),ranges:[[0,0]]}),transport_checks_json:JSON.stringify(checks),review_json:JSON.stringify([{file:manifest[0].file,evidence:fixtures[0].text,description:'double free'}]),patch_json:'[]',needs_context_json:'{"files":[]}'};
  assert.equal(validateAnswer({output,manifest,checks,fixtures,mode:'review'}).findings.length,0);
  assert.throws(()=>validateAnswer({output:{...output,review_json:'[]'},manifest,checks,fixtures,mode:'review'}),/Control/);
  assert.throws(()=>validateAnswer({output:{...output,transport_checks_json:'{}'},manifest,checks,fixtures,mode:'review'}),/markers/);
  assert.throws(()=>validateAnswer({output:{...output,needs_context_json:'{"files":["a.c"]}'},manifest,checks,fixtures,mode:'review'}),/context/);
});
