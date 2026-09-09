import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fresh} from '../lib/engine.ts';
import {validEndpoint,validateSnapshot,cloudCall} from '../lib/sheets-cloud.ts';
const source=readFileSync(new URL('../public/google-sheets/Code.gs',import.meta.url),'utf8');
function server(){
 const rows=[];let exists=false,locked=false;
 const tab={getRange:(r,c,h,w)=>({getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>rows[r-1+i]?.[c-1+j]??'')),setValues:values=>{values.forEach((row,i)=>{rows[r-1+i]??=[];row.forEach((v,j)=>rows[r-1+i][c-1+j]=v);});}}),setFrozenRows(){},getLastRow:()=>rows.length};
 const ctx=vm.createContext({console,SpreadsheetApp:{openById:()=>({getSheetByName:()=>exists?tab:null,insertSheet:()=>{exists=true;return tab;}}),flush(){}},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,s)=>Array.from(createHash('sha256').update(s).digest())},LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},ContentService:{MimeType:{JSON:1},createTextOutput:s=>({setMimeType:()=>s})}});
 vm.runInContext(source,ctx);
 const call=b=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(b)}}));
 return {ctx,rows,call};
}
const key='a'.repeat(64),snapshot=()=>({name:'勇者',state:fresh(100000)}),requestId='request-0000000001';
const create=(s,k=key)=>s.call({op:'create',key:k,requestId,snapshot:snapshot()});
test('setup is non-destructive and validates existing schema',()=>{const s=server();s.ctx.setup();create(s);s.ctx.setup();assert.equal(s.rows.length,2);s.rows[0][0]='changed';assert.throws(()=>s.ctx.setup(),/SCHEMA_MISMATCH/);});
test('uninitialized backend returns NOT_READY, never creates tabs from anonymous requests',()=>{const s=server();assert.equal(create(s).error,'NOT_READY');assert.equal(s.rows.length,0);});
test('keys are hashed and one player cannot read another without recovery key',()=>{const s=server();s.ctx.setup();assert.equal(create(s).revision,1);assert.notEqual(s.rows[1][0],key);assert.equal(s.call({op:'load',key:'b'.repeat(64)}).error,'NOT_FOUND');assert.equal(s.call({op:'load',key}).snapshot.name,'勇者');});
test('revision conflict does not overwrite newer progress',()=>{const s=server();s.ctx.setup();create(s);const next=snapshot();next.state.best=50;const save={op:'save',key,revision:1,requestId:'request-0000000002',snapshot:next};assert.equal(s.call(save).revision,2);assert.equal(s.call({...save,requestId:'request-0000000003'}).error,'CONFLICT');assert.equal(s.call({op:'load',key}).snapshot.state.best,50);});
test('retrying a committed request is idempotent',()=>{const s=server();s.ctx.setup();assert.equal(create(s).revision,1);assert.equal(create(s).revision,1);assert.equal(s.rows.length,2);});
test('invalid credential and malformed payload are rejected',()=>{const s=server();s.ctx.setup();assert.equal(create(s,'short').error,'INVALID_KEY');assert.equal(s.call({op:'create',key,requestId,snapshot:{name:'x',state:{}}}).error,'INVALID_SAVE');assert.equal(s.call({op:'load',key}).error,'NOT_FOUND');assert.equal(JSON.parse(s.ctx.doPost({postData:{contents:'bad json'}})).ok,false);});
test('snapshot capacity and missing player writes are rejected',()=>{const s=server();s.ctx.setup();assert.equal(s.call({op:'save',key,revision:0,requestId,snapshot:snapshot()}).error,'NOT_FOUND');const big=snapshot();big.state.log=['a'.repeat(41000)];assert.equal(s.call({op:'create',key,requestId,snapshot:big}).error,'INVALID_SAVE');});
test('deployment URL validation blocks arbitrary destinations',()=>{assert.equal(validEndpoint('https://script.google.com/macros/s/AKfy-abc/exec'),true);for(const bad of ['https://example.com/exec','https://script.google.com.evil.test/macros/s/a/exec','https://script.google.com/macros/s/a/dev'])assert.equal(validEndpoint(bad),false);});
test('client snapshot validation rejects invalid sizes and nonfinite numbers',()=>{validateSnapshot(snapshot());const s=snapshot();s.state.gold=Infinity;assert.throws(()=>validateSnapshot(s));assert.throws(()=>validateSnapshot({name:'',state:fresh()}));});
test('cloud transport uses readable simple POST, credentials never placed in URL',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async(url,init)=>{assert.equal(url,'https://script.google.com/macros/s/test/exec');assert.equal(init.headers['Content-Type'],'text/plain;charset=utf-8');assert.equal(init.credentials,'omit');assert.notEqual(init.mode,'no-cors');return Response.json({ok:true,revision:1,updated:1});};assert.equal((await cloudCall('https://script.google.com/macros/s/test/exec',{op:'load',key})).revision,1);}finally{globalThis.fetch=original;}});
