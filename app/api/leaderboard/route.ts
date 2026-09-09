import {getChatGPTUser} from '../../chatgpt-auth';
import {database} from '../../../lib/storage';
export const dynamic='force-dynamic';
export async function GET(){const user=await getChatGPTUser();const result=await database().prepare('SELECT id,name,best,prestiges FROM players ORDER BY best DESC,prestiges DESC,updated ASC LIMIT 50').all<{id:string;name:string;best:number;prestiges:number}>();return Response.json({rows:result.results.map(r=>({name:r.name,best:r.best,prestiges:r.prestiges,mine:r.id===user?.userId}))},{headers:{'Cache-Control':'no-store'}});}
