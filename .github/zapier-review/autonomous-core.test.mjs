import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReview,validateAnswer,checkConfig,issueMode,resolveContext} from './autonomous-core.mjs';
import {hash} from './worker.mjs';
test('negated partial-review wording does not disable repairs',()=>{
  assert.equal(issueMode({title:'全仓审核并修复',body:'不得只审核下面的文件；其它输入不修改无关代码'}),'fix');
  assert.equal(issueMode({title:'[review] full audit',body:''}),'review');
  assert.equal(issueMode({title:'全仓',body:'模式：只审核'}),'review');
});
test('context resolves project bundles only when the fixed snapshot is unambiguous',()=>{
  const map=new Map([['SDL/Xcode/SDL/SDL.xcodeproj/project.pbxproj',{}],['main.c',{}]]);
  assert.deepEqual(resolveContext(['SDL/SDL.xcodeproj'],map).files,['SDL/Xcode/SDL/SDL.xcodeproj/project.pbxproj']);
  assert.deepEqual(resolveContext(['main.c'],map).files,['main.c']);
  assert.throws(()=>resolveContext(['../secret'],map));
  assert.throws(()=>resolveContext(['absent.c'],map));
  map.set('SDL/Other/SDL.xcodeproj/project.pbxproj',{});
  assert.throws(()=>resolveContext(['SDL/SDL.xcodeproj'],map));
});
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
