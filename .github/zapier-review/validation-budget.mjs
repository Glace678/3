// Historical reservations remain evidence. Explicit actual-debit accounting uses
// refreshed account usage and halts on any charge above the confirmed route rate.
export function reserve(ledger,probe){
  if(ledger.halted)throw Error('Validation halted: '+ledger.halted);
  if(ledger.runs.some(r=>!r.reflection||!r.observation))throw Error('Reflect on and reconcile the previous probe first');
  if(ledger.runs.some(r=>r.id===probe.id))throw Error('Probe already reserved; only resume its saved execution');
  const fileStore=probe.kind==='native-file-store'&&probe.model===null&&probe.app==='FilesByZapierCLIAPI@1.3.5'&&probe.action==='file_from_text';
  if((probe.model!=='openai/gpt-5.6-luna'&&!fileStore)||probe.reserveTasks!==1)throw Error('Only one native Luna invocation or the bounded native file-store action is authorized');
  const actual=ledger.budgetMode==='actual-debits';
  const cost=actual?probe.expectedTasks:probe.reserveTasks;
  if(actual&&(!Number.isSafeInteger(cost)||cost<0||cost>1||cost===0&&probe.pricingBasis!=='sdk-free-beta-confirmed'))throw Error('Unverified actual-debit route');
  const spent=actual?probe.baseline-(ledger.accountBaselineTasks||0):ledger.runs.reduce((n,r)=>n+r.reserveTasks,0);
  if(spent<0||spent+cost>ledger.limitTasks)throw Error('Cumulative validation budget exhausted');
  if(actual&&ledger.billingReconciliationPending)throw Error('Reconcile known run charges with account usage before dispatch');
  if(ledger.checkpointTasks!==undefined){
    if(!Number.isSafeInteger(ledger.checkpointTasks)||ledger.checkpointTasks<1||ledger.checkpointTasks>ledger.limitTasks)throw Error('Invalid report checkpoint');
    if(spent+cost>ledger.checkpointTasks)throw Error('Report checkpoint reached; no further dispatch');
  }
  if(!Number.isSafeInteger(probe.baseline)||probe.baseline<0)throw Error('Invalid observed usage');
  const previous=ledger.runs.at(-1)?.observation?.tasks;
  if(previous!==undefined&&previous!==probe.baseline)throw Error('Unexplained account usage change: stop before dispatch');
  return {...ledger,runs:[...ledger.runs,{...probe,status:'reserved',reservedAt:new Date().toISOString()}]};
}

export function reconcile(ledger,id,tasks,reflection){
  const run=ledger.runs.find(r=>r.id===id);
  if(!run||!Number.isSafeInteger(tasks)||tasks<0||!reflection?.trim())throw Error('Missing reconciliation data');
  if(!['finished','failed'].includes(run.status))throw Error('An unfinished probe cannot be cleared for another call');
  const delta=tasks-run.baseline;
  const rejected=run.failure?.definitiveRejection&&ledger.halted===`Probe ${id} failed or has uncertain submission; inspect saved transport facts without resubmitting`;
  const halted=delta<0||delta>(run.expectedTasks??run.reserveTasks)?`Unexpected task delta ${delta} for ${id}`:rejected?null:ledger.halted;
  return {...ledger,halted,runs:ledger.runs.map(r=>r.id===id?{...r,reflection,observation:{tasks,delta,observedAt:new Date().toISOString(),source:'Zapier Billing & usage UI; delayed billing remains possible'}}:r)};
}
