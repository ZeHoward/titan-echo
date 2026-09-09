import { getChatGPTUser } from '../../chatgpt-auth';
import { database } from '../../../lib/storage';
import { fresh, advance, apply, type State, type Action } from '../../../lib/engine';
export const dynamic='force-dynamic';
type Player={state:string;name:string;revision:number};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){
 const user=await getChatGPTUser();if(!user)return json({error:'Sign in required'},401);
 const db=database(),now=Date.now();const defaultName='冒險者 '+crypto.randomUUID().slice(0,4).toUpperCase();
 await db.prepare('INSERT OR IGNORE INTO players (id,name,state,revision,best,prestiges,updated) VALUES (?,?,?,0,1,0,?)').bind(user.userId,defaultName,JSON.stringify(fresh(now)),now).run();
 const row=await db.prepare('SELECT state,name,revision FROM players WHERE id=?').bind(user.userId).first<Player>();if(!row)return json({error:'Unable to load player'},500);
 const s:State=JSON.parse(row.state),oldGold=s.gold;advance(s,now);
 // Return the advanced view; POST replays from the durable row and commits once.
 return json({state:s,name:row.name,revision:row.revision,now,offlineGold:s.gold-oldGold});
}
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return json({error:'Sign in required'},401);
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Invalid origin'},403);
 const raw=await request.text();if(raw.length>48000)return json({error:'Request too large'},413);
 let body:{revision:number;actions:Action[]};try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
 if(!body||!Number.isSafeInteger(body.revision)||!Array.isArray(body.actions)||body.actions.length>250)return json({error:'Invalid actions'},400);
 const types=['tap','upgrade','hero','skill','artifact','prestige','boss','fairy'];
 if(body.actions.some(a=>!a||!types.includes(a.type)||!Number.isFinite(a.at)||(a.index!==undefined&&!Number.isInteger(a.index))||(a.amount!==undefined&&![1,10,25].includes(a.amount))))return json({error:'Invalid action'},400);
 const db=database();const row=await db.prepare('SELECT state,name,revision FROM players WHERE id=?').bind(user.userId).first<Player>();if(!row)return json({error:'Load your adventure first'},404);
 if(row.revision!==body.revision)return json({state:JSON.parse(row.state),revision:row.revision},409);
 const now=Date.now();let state:State=JSON.parse(row.state);
 // Client timestamps are bounded by the last commit and server time. At most 22 taps/sec.
 for(const action of body.actions)state=apply(state,{...action,at:Math.max(state.last,Math.min(now,action.at))});
 advance(state,now);
 const result=await db.prepare('UPDATE players SET state=?,revision=revision+1,best=?,prestiges=?,updated=? WHERE id=? AND revision=?').bind(JSON.stringify(state),state.best,state.prestiges,now,user.userId,body.revision).run();
 if(result.meta.changes!==1){const latest=await db.prepare('SELECT state,revision FROM players WHERE id=?').bind(user.userId).first<Player>();return json({state:JSON.parse(latest!.state),revision:latest!.revision},409);}
 return json({state,revision:row.revision+1,now});
}

