import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserRequest} from '../lib/browser-storage.ts';

test('Pages keeps progress and display name in IndexedDB, without an API service', async()=>{
  const start=await (await browserRequest('/api/game')).json();
  assert.equal(start.state.taps,0);
  const saved=await browserRequest('/api/game',{method:'POST',body:JSON.stringify({revision:start.revision,actions:[{type:'tap',at:Date.now()}]})});
  assert.equal(saved.status,200);
  const reload=await (await browserRequest('/api/game')).json();
  assert.equal(reload.state.taps,1);
  assert.equal(reload.revision,1);
  await browserRequest('/api/profile',{method:'POST',body:JSON.stringify({name:'本機勇者'})});
  assert.equal((await (await browserRequest('/api/game')).json()).name,'本機勇者');
  const board=await (await browserRequest('/api/leaderboard')).json();
  assert.equal(board.rows[0].name,'本機勇者');
  assert.equal(board.rows.length,1);
});

test('Pages concurrent tabs cannot overwrite a newer save',async()=>{
  const current=await (await browserRequest('/api/game')).json();
  const init={method:'POST',body:JSON.stringify({revision:current.revision,actions:[]})};
  const results=await Promise.all([browserRequest('/api/game',init),browserRequest('/api/game',init)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});

test('Pages invalid profile leaves the persisted name unchanged',async()=>{
  const before=await (await browserRequest('/api/game')).json();
  const invalid=await browserRequest('/api/profile',{method:'POST',body:JSON.stringify({name:''})});
  assert.equal(invalid.status,400);
  const after=await (await browserRequest('/api/game')).json();
  assert.equal(after.name,before.name);
});
