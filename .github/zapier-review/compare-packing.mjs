// Offline cost scenarios, not a claim about Zapier/Luna's accepted context size.
import {readFileSync,writeFileSync} from 'node:fs';
import {getEncoding} from 'js-tiktoken';
const input=JSON.parse(readFileSync('.luna-output/block-index.json','utf8'));
const enc=getEncoding('o200k_base'),count=s=>enc.encode(s,[],[]).length;
const blocks=new Map(input.blocks.map(b=>[b.id,b]));
const metadataCost=f=>count(JSON.stringify({path:f.path,sha256:f.sha256,blocks:f.blocks}))+48;

function pack(limit,order){
  const items=[];
  for(const f of input.files){
    let ids=[],seen=new Set(),startBlock=0,cost=metadataCost({...f,blocks:[]});
    const flush=()=>{if(ids.length){items.push({path:f.path,startBlock,blocks:ids,base:metadataCost({...f,blocks:ids})});startBlock+=ids.length;ids=[];seen=new Set();cost=metadataCost({...f,blocks:[]});}};
    for(const id of f.blocks){
      const addition=(seen.has(id)?0:blocks.get(id).tokens+24)+4;
      if(ids.length&&cost+addition>limit-8192)flush();
      ids.push(id);if(!seen.has(id))cost+=blocks.get(id).tokens+24;cost+=4;seen.add(id);
    }
    flush();
  }
  if(order==='largest')items.sort((a,b)=>[...new Set(b.blocks)].reduce((s,id)=>s+blocks.get(id).tokens,0)-[...new Set(a.blocks)].reduce((s,id)=>s+blocks.get(id).tokens,0));
  const bins=[];
  for(const item of items){
    const ids=[...new Set(item.blocks)];let best,bestDelta=Infinity,bestSlack=Infinity;
    for(const bin of bins){
      const delta=item.base+ids.reduce((s,id)=>s+(bin.seen.has(id)?0:blocks.get(id).tokens+24),0);
      const slack=limit-8192-bin.cost-delta;
      if(slack>=0&&(delta<bestDelta||(delta===bestDelta&&slack<bestSlack))){best=bin;bestDelta=delta;bestSlack=slack;}
    }
    if(!best){best={seen:new Set(),cost:0,items:[]};bins.push(best);bestDelta=item.base+ids.reduce((s,id)=>s+blocks.get(id).tokens+24,0);}
    best.cost+=bestDelta;ids.forEach(id=>best.seen.add(id));best.items.push(item);
  }
  const recovered=new Map();
  for(const bin of bins){
    if(bin.cost>limit-8192)throw Error('Oversized estimated bin');
    for(const item of bin.items){const prior=recovered.get(item.path)||[];recovered.set(item.path,[...prior,item]);}
  }
  // Restore the original per-file order across bins, including repeated blocks.
  for(const file of input.files){
    const actual=(recovered.get(file.path)||[]).sort((a,b)=>a.startBlock-b.startBlock).flatMap(x=>x.blocks);
    if(JSON.stringify(file.blocks)!==JSON.stringify(actual))throw Error('Missing or reordered blocks '+file.path);
  }
  return {inputTokensScenario:limit,order,estimatedCalls:bins.length,estimatedTotalInputTokens:bins.reduce((s,b)=>s+b.cost+8192,0),accountedPaths:input.files.length,nonEmptyPaths:recovered.size,emptyPaths:input.files.length-recovered.size,maxEstimatedTokens:Math.max(...bins.map(b=>b.cost+8192))};
}
const results=[];
for(const limit of [650000,900000,1000000,1500000])for(const order of ['path','largest'])results.push(pack(limit,order));
const report={model:'Zapier native GPT-5.6 Luna',modelCalled:false,contextLimitVerified:false,pricingVerified:false,representation:'all original lossless blocks plus ordered references; o200k_base token estimates and explicit overhead',limitations:['Experimental representation, not yet assessed by Luna.','Context sizes are scenarios, not verified product limits.','Input coverage accounting is not a completed code review.','Additional context and finite output limits can increase calls.'],results};
writeFileSync('.luna-output/packing-comparison.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
