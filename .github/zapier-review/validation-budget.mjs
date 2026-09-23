// Conservative validation ledger. A zero UI delta never refunds a reservation.
// Platform billing is observed separately; this limits submissions, not Zapier's bill.
export function reserve(ledger,probe){
  if(ledger.halted)throw Error('Validation halted: '+ledger.halted);
  if(ledger.runs.some(r=>!r.reflection||!r.observation))throw Error('Reflect on and reconcile the previous probe first');
  if(ledger.runs.some(r=>r.id===probe.id))throw Error('Probe already reserved; only resume its saved execution');
  if(probe.model!=='openai/gpt-5.6-luna'||probe.reserveTasks!==1)throw Error('Only one Standard Luna invocation is authorized by this runner');
  if(ledger.runs.reduce((n,r)=>n+r.reserveTasks,0)+probe.reserveTasks>ledger.limitTasks)throw Error('Cumulative validation budget exhausted');
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
  const halted=delta<0||delta>run.reserveTasks?`Unexpected task delta ${delta} for ${id}`:ledger.halted;
  return {...ledger,halted,runs:ledger.runs.map(r=>r.id===id?{...r,reflection,observation:{tasks,delta,observedAt:new Date().toISOString(),source:'Zapier Billing & usage UI; delayed billing remains possible'}}:r)};
}
