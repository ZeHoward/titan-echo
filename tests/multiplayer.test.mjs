import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('multiplayer: independent accounts, conflict rejection, login and persistent SQLite',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'titan-test-'));const port=18473,base=`http://127.0.0.1:${port}`;let child;
 async function start(){child=spawn(process.execPath,['server/standalone.mjs'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',c=>reject(Error('server exited '+c)));});}
 async function stop(){if(child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
 async function auth(username,mode='register',password='test-password-123'){const r=await fetch(base+'/auth',{method:'POST',body:new URLSearchParams({username,password,mode}),redirect:'manual'});assert.equal(r.status,303);return r.headers.get('set-cookie').split(';')[0];}
 const get=c=>fetch(base+'/api/game',{headers:{cookie:c}}).then(r=>r.json());
 const post=(c,b)=>fetch(base+'/api/game',{method:'POST',headers:{cookie:c,'Content-Type':'application/json'},body:JSON.stringify(b)});
 try{await start();assert.equal((await fetch(base+'/api/game')).status,401);const a=await auth('alice'),b=await auth('bob');const sa=await get(a),sb=await get(b);assert.equal(sa.state.taps,0);await new Promise(r=>setTimeout(r,110));let response=await post(a,{revision:sa.revision,actions:[{type:'tap',at:Date.now()}]});assert.equal(response.status,200);const changed=await response.json();assert.equal(changed.state.taps,1);assert.equal((await get(b)).state.taps,0);assert.equal((await post(a,{revision:sa.revision,actions:[]})).status,409);
 const parallel=await Promise.all([post(a,{revision:changed.revision,actions:[]}),post(a,{revision:changed.revision,actions:[]})]);assert.deepEqual(parallel.map(r=>r.status).sort(),[200,409]);
 const latest=await get(a);assert.equal((await post(a,{revision:latest.revision,actions:[{type:'cheat',at:Date.now()}]})).status,400);assert.equal((await post(a,null)).status,400);assert.equal((await fetch(base+'/api/profile',{method:'POST',headers:{cookie:a,origin:'https://evil.example'},body:JSON.stringify({name:'bad'})})).status,403);
 await fetch(base+'/api/profile',{method:'POST',headers:{cookie:a,'Content-Type':'application/json'},body:JSON.stringify({name:'勇者甲'})});assert.equal((await get(b)).name,'bob');assert.equal((await get(a)).name,'勇者甲');const ranks=await fetch(base+'/api/leaderboard',{headers:{cookie:a}}).then(r=>r.json());assert.equal(ranks.rows.length,2);assert.equal(ranks.rows.filter(r=>r.mine).length,1);assert.ok(ranks.rows.every(r=>!('id' in r)));
 await stop();await start();const logged=await auth('alice','login');assert.equal((await get(logged)).state.taps,1);assert.equal((await get(logged)).name,'勇者甲');assert.equal((await get(b)).state.taps,sb.state.taps);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
