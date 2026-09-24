// Save only transport facts, never headers, payloads or arbitrary error text.
// Capture execution IDs before SDK response parsing can fail.
export function journalFetch(append,fetchImpl=fetch){
  return async(input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    const method=(init?.method||input?.method||'GET').toUpperCase();
    const row={at:new Date().toISOString(),host:url.hostname,path:url.pathname,method};
    const actionSubmission=method==='POST'&&(
      (url.hostname==='zapier.com'&&url.pathname==='/zapier/api/actions/v1/runs')||
      (url.hostname==='sdkapi.zapier.com'&&url.pathname==='/api/v0/sdk/zapier/api/actions/v1/runs'));
    if(actionSubmission)append({...row,phase:'sending'});
    try{
      const response=await fetchImpl(input,init);
      const result={...row,phase:'response',status:response.status};
      if(actionSubmission){
        const body=await response.clone().json().catch(()=>null);
        if(typeof body?.data?.id==='string'&&/^[a-z0-9-]{1,100}$/i.test(body.data.id))result.runId=body.data.id;
      }
      append(result);return response;
    }catch(error){append({...row,phase:'transport-error',errorType:error.name});throw error;}
  };
}
