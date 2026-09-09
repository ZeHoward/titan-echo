import {getChatGPTUser} from '../../chatgpt-auth';
import {database} from '../../../lib/storage';
export const dynamic='force-dynamic';
export async function POST(request:Request){const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in required'},{status:401});const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});let body:{name?:unknown}|null;try{body=await request.json() as {name?:unknown}|null;}catch{return Response.json({error:'Invalid JSON'},{status:400});}if(typeof body?.name!=='string'||!body.name.trim()||body.name.length>24||/[\x00-\x1f]/.test(body.name))return Response.json({error:'Invalid name'},{status:400});await database().prepare('UPDATE players SET name=? WHERE id=?').bind(body.name.trim(),user.userId).run();return Response.json({ok:true});}

