'use client';
import {useEffect,useRef,useState} from 'react';
import {readBrowserSave,restoreBrowserSave} from '../lib/browser-storage';
import {cloudCall,recoveryKey,validEndpoint,type CloudResult,type Snapshot} from '../lib/sheets-cloud';
type Binding={key:string;revision:number;instanceId:string;endpoint:string};
const STORAGE='titan-echo-cloud-v1';
const messages:Record<string,string>={CONFLICT:'另一台裝置已有新進度。已暫停上傳，請先預覽雲端存檔。',NOT_FOUND:'找不到此恢復碼的存檔。',INVALID_KEY:'恢復碼應為 64 位英數字。',NOT_READY:'管理員尚未初始化雲端儲存服務。',SCHEMA_MISMATCH:'存檔分頁欄位不符，請聯絡管理員。',BUSY:'雲端忙碌，稍後重試。',CAPACITY:'雲端帳號數已達上限。'};
export default function CloudSave({open,basePath,onClose}:{open:boolean;basePath:string;onClose:()=>void}) {
 const [endpoint,setEndpoint]=useState(''),[key,setKey]=useState(''),[status,setStatus]=useState('雲端尚未設定'),[pending,setPending]=useState(false),[preview,setPreview]=useState<CloudResult|null>(null),[active,setActive]=useState(false);
 const binding=useRef<Binding|null>(null),busy=useRef(false),alive=useRef(true),endpointRef=useRef(''),activeRef=useRef(false),openRef=useRef(open),previewKey=useRef('');openRef.current=open;
 function enable(v:boolean){activeRef.current=v;setActive(v);}
 function remember(v:Binding){localStorage.setItem(STORAGE,JSON.stringify(v));binding.current=v;}
 function error(e:unknown){const text=e instanceof Error?e.message:'連線失敗';setStatus(messages[text]||(/[\u3400-\u9fff]/.test(text)?text:'雲端連線失敗，請稍後再試；本機進度仍保留。'));if(text==='CONFLICT')enable(false);}
 async function run(work:()=>Promise<void>){if(busy.current)return;busy.current=true;setPending(true);try{await work();}catch(e){if(alive.current)error(e);}finally{busy.current=false;if(alive.current)setPending(false);}}
 useEffect(()=>{alive.current=true;void run(async()=>{
  const config=await fetch(basePath+'cloud-config.json',{cache:'no-store'}).then(r=>r.json()) as {endpoint?:string};
  const url=config.endpoint||'';endpointRef.current=url;setEndpoint(url);
  if(!validEndpoint(url)){setStatus('等待管理員完成 雲端設定；本機存檔照常運作。');return;}
  setStatus('可建立雲端存檔或輸入恢復碼');
  const raw=localStorage.getItem(STORAGE);if(!raw)return;
  const b=JSON.parse(raw) as Binding;if(b.endpoint!==url)return;
  binding.current=b;setKey(b.key);
  const local=await readBrowserSave();const remote=await cloudCall(url,{op:'load',key:b.key});
  if(remote.revision!==b.revision||local.instanceId!==b.instanceId){enable(false);setStatus('雲端與本機版本不同，請先預覽並選擇載入。');return;}
  enable(true);setStatus('雲端已連線 · 每 60 秒同步');
 });const timer=setInterval(()=>{if(activeRef.current&&!openRef.current)void upload();},60000);return()=>{alive.current=false;clearInterval(timer);};},[basePath]);
 async function upload(){await run(async()=>{
  const b=binding.current;if(!b||!activeRef.current)return;
  const local=await readBrowserSave();if(local.instanceId!==b.instanceId){enable(false);throw Error('本機存檔已更換，請重新連線');}
  const result=await cloudCall(b.endpoint,{op:'save',key:b.key,revision:b.revision,requestId:crypto.randomUUID(),snapshot:{name:local.name,state:local.state}});
  remember({...b,revision:result.revision});setStatus('雲端已儲存 · '+new Date(result.updated).toLocaleTimeString());
 });}
 async function create(){await run(async()=>{
  const local=await readBrowserSave();const newKey=recoveryKey();setKey(newKey);
  // Keep the key even if a successful write's response is lost.
  const b={key:newKey,revision:0,instanceId:local.instanceId||'',endpoint:endpointRef.current};remember(b);enable(false);
  const result=await cloudCall(b.endpoint,{op:'create',key:newKey,requestId:crypto.randomUUID(),snapshot:{name:local.name,state:local.state}});
  remember({...b,revision:result.revision});enable(true);setStatus('雲端存檔已建立，請保存下方恢復碼。');
 });}
 async function inspect(){await run(async()=>{
  enable(false);setPreview(null);const k=key.trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(k))throw Error('INVALID_KEY');
  const remote=await cloudCall(endpoint,{op:'load',key:k});previewKey.current=k;setPreview(remote);setStatus('請確認雲端角色，載入後會替換此瀏覽器的進度。');
 });}
 async function restore(){await run(async()=>{
  if(!preview?.snapshot)return;
  const latest=await cloudCall(endpoint,{op:'load',key:previewKey.current});
  if(latest.revision!==preview.revision){setPreview(latest);setStatus('雲端進度剛更新，請重新確認。');return;}
  const local=await readBrowserSave();await restoreBrowserSave(latest.snapshot as Snapshot,local.revision);
  remember({key:previewKey.current,revision:latest.revision,instanceId:local.instanceId||'',endpoint});window.location.reload();
 });}
 function downloadKey(){const blob=new Blob(['泰坦遠征恢復碼（等同密碼，請勿分享）\n'+key+'\nhttps://zehoward.github.io/titan-echo/\n'],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='泰坦遠征恢復碼.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function exportBackup(){await run(async()=>{const backup=await readBrowserSave('before-cloud-restore');const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='泰坦遠征載入前備份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
 if(!open)return null;
 return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="雲端存檔"><button className="close" onClick={onClose} disabled={pending} aria-label="關閉">✕</button><h2>雲端存檔</h2><p role="status">{status}</p><p>本機每 3 秒保存；連線後每 60 秒備份到雲端。切換裝置前請先儲存，再於另一台載入。同一角色請一次使用一台裝置。</p>
 {validEndpoint(endpoint)?<><label>個人恢復碼<input value={key} maxLength={64} autoComplete="off" spellCheck={false} onChange={e=>{enable(false);setKey(e.target.value);setPreview(null);}}/></label><p>恢復碼等同存檔密碼，請下載保管；遺失後無法自行找回。</p><div className="feature-actions"><button className="outline-button" disabled={pending||active} onClick={()=>void create()}>以本機進度建立新角色</button><button className="outline-button" disabled={pending||!key} onClick={()=>void inspect()}>預覽雲端角色</button>{key&&<button className="outline-button" onClick={downloadKey}>下載恢復碼</button>}</div>
 {preview?.snapshot&&<article className="feature-card"><h3>{preview.snapshot.name}</h3><p>目前第 {preview.snapshot.state.stage} 關 · 最高第 {preview.snapshot.state.best} 關 · 轉生 {preview.snapshot.state.prestiges} 次</p><p>更新：{new Date(preview.updated).toLocaleString()}</p><p>載入會替換本機進度，並保留一份載入前備份。</p><button className="primary-button" disabled={pending} onClick={()=>void restore()}>確認載入雲端進度</button></article>}
 {active&&<button className="primary-button" disabled={pending} onClick={()=>void upload()}>立即同步雲端</button>}<button className="setting-row" disabled={pending} onClick={()=>{enable(false);binding.current=null;localStorage.removeItem(STORAGE);setPreview(null);setStatus('已停止自動同步，本機與雲端存檔均保留。');}}>停止自動同步</button></>:<p>管理員完成 雲端服務部署後即可啟用，不影響目前的遊玩進度。</p>}
 <button className="setting-row" disabled={pending} onClick={()=>void exportBackup()}>匯出載入前的本機備份</button></section></div>;
}
