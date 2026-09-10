import {hydrate, type State} from './engine.ts';
export type Snapshot = {name:string;state:State};
export type CloudResult = {ok:boolean;error?:string;revision:number;updated:number;snapshot?:Snapshot};
export function validEndpoint(value:string) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value);
}
export function recoveryKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function cloudCall(endpoint:string,body:Record<string,unknown>):Promise<CloudResult> {
  if (!validEndpoint(endpoint)) throw Error('請使用雲端儲存服務的正式部署網址');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);
  try {
    // Simple POST avoids an unsupported Apps Script OPTIONS preflight. Never
    // use no-cors: an opaque response cannot confirm a save was accepted.
    const response=await fetch(endpoint,{method:'POST',credentials:'omit',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body),signal:controller.signal});
    if(!response.ok)throw Error('雲端服務暫時無法連線');
    const data=await response.json() as CloudResult;
    if(!data.ok)throw Error(data.error||'雲端存檔失敗');
    if(!Number.isSafeInteger(data.revision)||data.revision<1)throw Error('雲端回應格式錯誤');
    if(data.snapshot){validateSnapshot(data.snapshot);hydrate(data.snapshot.state);}
    return data;
  }finally{clearTimeout(timer);}
}
export function validateSnapshot(value:Snapshot) {
  if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.length>24||!value.state||value.state.version!==2||!Array.isArray(value.state.heroes)||value.state.heroes.length!==33||!Array.isArray(value.state.artifacts)||value.state.artifacts.length!==30)throw Error('存檔格式不正確');
  const visit=(v:unknown,depth=0):void=>{if(depth>12)throw Error('存檔格式不正確');if(typeof v==='number'&&!Number.isFinite(v))throw Error('存檔數值不正確');if(v&&typeof v==='object')for(const child of Object.values(v))visit(child,depth+1);};visit(value);
  if(JSON.stringify(value).length>40000)throw Error('存檔超過容量限制');
}
