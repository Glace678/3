import test from 'node:test';
import assert from 'node:assert/strict';
import {blockIndex,reconstruct,renderCompactBlocks,parseCompactBlocks} from './lossless-blocks.mjs';
test('compact framing preserves Unicode, CRLF, fake headers, no final newline and reused content',()=>{
  const texts=['hello\r\n😀世界\n@B z 15\nsource', 'hello\r\n😀世界\n@B z 15\nsource', '', 'x\n'.repeat(6000)];
  const {blocks,entries}=blockIndex(texts.map((text,i)=>({file:String(i),text})),s=>s.length);
  const view=renderCompactBlocks(entries,blocks),parsed=parseCompactBlocks(view.source);
  assert.equal(entries[0].block_ids[0],entries[1].block_ids[0]);
  entries.forEach((entry,i)=>assert.equal(reconstruct(entry,parsed),texts[i]));
  assert.throws(()=>parseCompactBlocks('\n@B a 123\nshort'));
  assert.throws(()=>parseCompactBlocks('\n@B a 1\nx\n@B a 1\ny'));
  assert.throws(()=>reconstruct({block_ids:['missing']},parsed));
});
