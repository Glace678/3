// Conservative account-level guard, not an instantaneous billing guarantee.
// The official billing page remains authoritative if its counter differs.
export function checkUsage(state, usage, ceiling) {
  if (!usage || !Number.isSafeInteger(usage.count) || usage.count < 0 || !usage.start_period)
    throw Error('Zapier usage is unavailable; stopped before further inference');
  if (usage.count >= ceiling) throw Error('Zapier account usage reached the configured ceiling');
  if (!state.usageBaseline) state.usageBaseline = usage;
  const base = state.usageBaseline;
  if (usage.start_period !== base.start_period || usage.count < base.count)
    throw Error('Usage period/counter changed unexpectedly');
  // At most the single dispatch Code step may post after this baseline.
  if (usage.count > base.count + 1)
    throw Error('Unexpected task usage increase: stopped without another model request');
  state.lastUsage = usage;
}

export async function readUsage(sdk) {
  const {data:run}=await sdk.createActionRun({app:'ZapierManagerCLIAPI@latest',action:'task_usage_limit',actionType:'read',inputs:{account:'28766408',tasks:1,threshold:10}});
  if (!run.id) throw Error('Usage read identifier missing');
  for (let n=0;n<20;n++) {
    const {data}=await sdk.getActionRun({run:run.id});
    if (data.status==='waiting') {await new Promise(r=>setTimeout(r,1500));continue;}
    if (data.status!=='success'||data.errors?.length||data.results?.length!==1) throw Error('Usage read failed');
    return data.results[0];
  }
  throw Error('Usage read timed out; stopped');
}
