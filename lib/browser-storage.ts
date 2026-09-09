import { advance, apply, fresh, hydrate, type Action, type State } from './engine.ts';
import {validateSnapshot} from './sheets-cloud.ts';

export type Save = { id: string; name: string; state: State; revision: number; instanceId?:string };
let connection: Promise<IDBDatabase> | undefined;
function database() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('titan-echo-pages-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('saves', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
  return connection;
}

// Read/modify/write happens inside one IndexedDB transaction. An older tab
// cannot overwrite a newer save. This is device-local storage, not authentication.
export async function browserRequest(url: string, init?: RequestInit): Promise<Response> {
  const db = await database();
  const now = Date.now();
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('saves', 'readwrite');
    const store = tx.objectStore('saves');
    const read = store.get('player');
    let response: Response;
    read.onsuccess = () => {
      try {
        const saved: Save = read.result || { id: 'player', name: '本機冒險者', state: fresh(now), revision: 0 };
        hydrate(saved.state);
        if(!saved.instanceId){saved.instanceId=crypto.randomUUID();store.put(saved);}
        if (!read.result) store.put(saved);
        if (url === '/api/leaderboard') {
          response = Response.json({ rows: [{ name: saved.name, best: saved.state.best, prestiges: saved.state.prestiges, mine: true }] });
        } else if (url === '/api/profile' && init?.method === 'POST') {
          if (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 24) {
            response = Response.json({ error: 'Invalid name' }, { status: 400 });
          } else {
            saved.name = body.name.trim(); store.put(saved); response = Response.json({ ok: true });
          }
        } else if (url === '/api/game' && init?.method === 'POST') {
          if (!body || !Number.isSafeInteger(body.revision) || !Array.isArray(body.actions) || body.actions.length > 250) {
            response = Response.json({ error: 'Invalid actions' }, { status: 400 });
          } else if (body.revision !== saved.revision) {
            response = Response.json({ state: saved.state, revision: saved.revision }, { status: 409 });
          } else {
            for (const action of body.actions as Action[]) saved.state = apply(saved.state, { ...action, at: Math.max(saved.state.last, Math.min(now, action.at)) });
            advance(saved.state, now); saved.revision++; store.put(saved);
            response = Response.json({ ...saved, now });
          }
        } else if (url === '/api/game') {
          const before = saved.state.gold;
          advance(saved.state, now);
          response = Response.json({ ...saved, now, offlineGold: saved.state.gold - before });
        } else response = Response.json({ error: 'Not found' }, { status: 404 });
      } catch (error) { tx.abort(); reject(error); }
    };
    tx.oncomplete = () => resolve(response);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Unable to save on this device'));
  });
}

export async function readBrowserSave(id='player'):Promise<Save> {
  const db=await database();
  return new Promise((resolve,reject)=>{const tx=db.transaction('saves','readonly');const read=tx.objectStore('saves').get(id);read.onsuccess=()=>read.result?resolve(read.result):reject(Error('尚無這份本機備份'));read.onerror=()=>reject(read.error);});
}

// Keep a pre-restore backup and change the revision atomically. Stale tabs will
// receive 409 instead of overwriting the restored cloud progress.
export async function restoreBrowserSave(snapshot:{name:string;state:State},expectedRevision:number) {
  validateSnapshot(snapshot);
  const db=await database();
  return new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('saves','readwrite');const store=tx.objectStore('saves');const read=store.get('player');
    read.onsuccess=()=>{const previous=read.result as Save;if(!previous||previous.revision!==expectedRevision){tx.abort();return;}
      store.put({...previous,id:'before-cloud-restore'});
      store.put({id:'player',instanceId:previous.instanceId,name:snapshot.name,state:hydrate(snapshot.state),revision:previous.revision+1});};
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(Error('本機進度已變更，請重試載入'));});
}
