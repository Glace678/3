// Optional experimental HTTP content encoding, not model-side compression.
// The service must decompress JSON before the model can see original source.
import {gzipSync} from 'node:zlib';
export function compressedActionFetch(fetchImpl=fetch,onCompressed=()=>{}){
  return async(input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    const isAction=url.hostname==='sdkapi.zapier.com'&&url.pathname==='/api/v0/sdk/zapier/api/actions/v1/runs'&&(init?.method||input?.method||'GET').toUpperCase()==='POST';
    if(!isAction)return fetchImpl(input,init);
    if(typeof init?.body!=='string')throw Error('Only JSON string action bodies support this experiment');
    JSON.parse(init.body);
    const headers=new Headers(init.headers);headers.set('content-encoding','gzip');
    const body=gzipSync(Buffer.from(init.body),{level:6});
    // Some SDK transport paths preserve a stale uncompressed Content-Length;
    // send the exact compressed length explicitly so the gateway can read it.
    headers.set('content-length',String(body.length));
    onCompressed({phase:'http-gzip',rawBytes:Buffer.byteLength(init.body),compressedBytes:body.length});
    return fetchImpl(input,{...init,headers,body});
  };
}
