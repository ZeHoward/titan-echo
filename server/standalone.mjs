// Node 24+. A portable SQLite file replaces any managed database service.
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {scryptSync,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fresh,advance,apply,ACTION_TYPES} from '../lib/engine.ts';
const root=resolve(import.meta.dirname,'..');
const dataDir=resolve(process.env.DATA_DIR||resolve(root,'data'));
await mkdir(dataDir,{recursive:true});
const db=new DatabaseSync(resolve(dataDir,'game.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 1, prestiges INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_players_best ON players(best DESC);');
const hash=t=>createHash('sha256').update(t).digest('hex');
const port=Number(process.env.PORT||4173),secure=process.env.COOKIE_SECURE==='1';
const attempts=new Map();
const authPage=(message='')=>`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>冒險者登入</title><style>body{background:#101f1b;color:#f5dfaa;font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:380px;margin:20px;padding:36px;border:1px solid #7c7750;border-radius:15px;background:#20352b}h1{font-size:26px}p{line-height:1.8;color:#c5cfbd;font-size:14px}label{display:block;margin:18px 0 6px}input{box-sizing:border-box;width:100%;padding:12px;background:#0e2119;color:white;border:1px solid #667b59;border-radius:5px;font:inherit}button{padding:13px 18px;border:0;border-radius:5px;cursor:pointer;font:inherit;background:#debe79;color:#1c2e22;margin-top:20px}a{color:#e8ca81}small{display:block;line-height:1.8;margin-top:15px}</style><main><h1>⚔ 泰坦遠征</h1><p>每位冒險者，都有自己的傳說。</p>${message?'<p role="alert">'+message+'</p>':''}<form method="post" action="/auth"><label>帳號（英文字母、數字、底線）</label><input name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" autocomplete="username"><label>密碼（至少 8 個字元）</label><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="current-password"><button name="mode" value="login">登入</button> <button name="mode" value="register">建立帳號</button></form><small>帳號及進度儲存在此遊戲主機。<br>訪客試玩不會轉入新帳號。</small><p><a href="/">← 返回遊戲</a></p></main></html>`;
function send(res,status,data,type='application/json'){res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(data):data);}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>48000)throw Error('too_large');}return text;}
function identity(req){const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('te_session='))?.slice(11);if(!token)return null;return db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(hash(token),Date.now())?.user_id||null;}
function cookie(token,age=60*60*24*30){return `te_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`;}
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');const path=url.pathname;const now=Date.now();
 if(req.method==='POST'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'Invalid origin'});
 if(path==='/signin-with-chatgpt')return send(res,200,authPage(),'text/html');
 if(path==='/auth'&&req.method==='POST'){
  const ip=req.socket.remoteAddress||'unknown';if(attempts.size>10000)for(const[k,v]of attempts)if(v.until<now)attempts.delete(k);
  const rate=attempts.get(ip)||{n:0,until:now+60000};if(rate.until<now){rate.n=0;rate.until=now+60000;}rate.n++;attempts.set(ip,rate);if(rate.n>12)return send(res,429,authPage('嘗試次數過多，請稍候一分鐘。'),'text/html');
  const form=new URLSearchParams(await body(req)),id=(form.get('username')||'').toLowerCase(),password=form.get('password')||'',mode=form.get('mode');
  if(!/^[a-z0-9_]{3,24}$/.test(id)||password.length<8||password.length>128||!['register','login'].includes(mode))return send(res,400,authPage('請檢查帳號與密碼格式。'),'text/html');
  let user=db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if(mode==='register'){if(user)return send(res,409,authPage('此帳號已存在，請使用另一個名稱。'),'text/html');const salt=randomBytes(16).toString('hex');db.prepare('INSERT INTO users VALUES (?,?,?)').run(id,salt,scryptSync(password,salt,64).toString('hex'));}
  else{const derived=scryptSync(password,user?.salt||'invalid-account-salt',64);if(!user||!timingSafeEqual(Buffer.from(user.hash,'hex'),derived))return send(res,401,authPage('帳號或密碼不正確。'),'text/html');}
  const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(now);db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),id,now+30*86400000);res.writeHead(303,{'Location':'/','Set-Cookie':cookie(token)});return res.end();
 }
 if(path==='/signout-with-chatgpt'){const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('te_session='))?.slice(11);if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));res.writeHead(303,{'Location':'/','Set-Cookie':cookie('',0)});return res.end();}
 const id=identity(req);
 if(path==='/api/leaderboard'&&req.method==='GET')return send(res,200,{rows:db.prepare('SELECT id,name,best,prestiges FROM players ORDER BY best DESC,prestiges DESC,updated ASC LIMIT 50').all().map(r=>({name:r.name,best:r.best,prestiges:r.prestiges,mine:r.id===id}))});
 if(path.startsWith('/api/')){
  if(!id)return send(res,401,{error:'Sign in required'});
  if(path==='/api/game'&&req.method==='GET'){db.prepare('INSERT OR IGNORE INTO players(id,name,state,updated) VALUES (?,?,?,?)').run(id,id,JSON.stringify(fresh(now)),now);const row=db.prepare('SELECT * FROM players WHERE id=?').get(id);const s=JSON.parse(row.state),old=s.gold;advance(s,now);return send(res,200,{state:s,name:row.name,revision:row.revision,now,offlineGold:s.gold-old});}
  if(path==='/api/profile'&&req.method==='POST'){const b=JSON.parse(await body(req));if(typeof b?.name!=='string'||!b.name.trim()||b.name.length>24||/[\x00-\x1f]/.test(b.name))return send(res,400,{error:'Invalid name'});db.prepare('UPDATE players SET name=? WHERE id=?').run(b.name.trim(),id);return send(res,200,{ok:true});}
  if(path==='/api/game'&&req.method==='POST'){
   const b=JSON.parse(await body(req));const types=ACTION_TYPES;
   if(!b||!Number.isSafeInteger(b.revision)||!Array.isArray(b.actions)||b.actions.length>250||b.actions.some(a=>!a||!types.includes(a.type)||!Number.isFinite(a.at)||(a.index!==undefined&&!Number.isInteger(a.index))||(a.amount!==undefined&&![0,1,10,25,100,1000].includes(a.amount))))return send(res,400,{error:'Invalid actions'});
   const row=db.prepare('SELECT * FROM players WHERE id=?').get(id);if(!row)return send(res,404,{error:'Load game first'});if(row.revision!==b.revision)return send(res,409,{state:JSON.parse(row.state),revision:row.revision});
   let state=JSON.parse(row.state);for(const a of b.actions)state=apply(state,{...a,at:Math.max(state.last,Math.min(now,a.at))});advance(state,now);
   const result=db.prepare('UPDATE players SET state=?,revision=revision+1,best=?,prestiges=?,updated=? WHERE id=? AND revision=?').run(JSON.stringify(state),state.best,state.prestiges,now,id,b.revision);
   if(result.changes!==1)return send(res,409,{error:'Conflict'});return send(res,200,{state,revision:row.revision+1,now});
  }
  return send(res,404,{error:'Not found'});
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Method not allowed'});
 const publicRoot=resolve(root,'dist-static'),file=resolve(publicRoot,'.'+decodeURIComponent(path==='/'?'/index.html':path));
 if(!file.startsWith(publicRoot+sep))return send(res,403,{error:'Forbidden'});
 try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'})[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);}catch{return send(res,404,'找不到頁面。請先執行 npm run build:static。','text/plain');}
 }catch(error){console.error('Request failed:',error.message);send(res,error.message==='too_large'?413:400,{error:'Invalid request'});}});
server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Titan Echo multiplayer: http://localhost:${port} — SQLite: data/game.sqlite`));
