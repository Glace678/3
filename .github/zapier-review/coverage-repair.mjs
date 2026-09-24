import {validateCompactCoverage} from './native-sdk.mjs';

// A model occasionally uses the entry count as the inclusive final index.
// Drop only that single nonexistent boundary; never add a missing real index.
// Preserve raw output elsewhere and report this as repaired, not strict, coverage.
export function repairExclusiveEnd(manifest,report){
  if(!manifest.length||!report||!Array.isArray(report.ranges))throw Error('Invalid coverage');
  let changed=false;
  const ranges=report.ranges.map(span=>{
    if(!Array.isArray(span)||span.length!==2||!span.every(Number.isSafeInteger)||span[0]<0||span[0]>=manifest.length||span[1]<span[0]||span[1]>manifest.length)throw Error('Not a single end-boundary error');
    if(span[1]===manifest.length){changed=true;return [span[0],span[1]-1];}
    return [...span];
  });
  if(!changed)throw Error('No exclusive-end correction needed');
  const corrected={...report,ranges};validateCompactCoverage(manifest,corrected);
  return corrected;
}
