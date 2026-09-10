import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,advance,apply,fmt} from '../lib/engine.ts';
import {browserRequest,readBrowserSave,saveBrowserSnapshot} from '../lib/browser-storage.ts';
import {TT2_HEROES,TT2_PETS,TT2_TREE,TT2_SETS,TT2_GEAR,TT2_ARTIFACTS} from '../lib/tt2-data.ts';
import {HERO_NAMES,PET_NAMES,TALENT_NAMES,SET_NAMES,RARITY_NAMES} from '../lib/zh-tw.ts';
import {effectLabel} from '../lib/tt2-rules.ts';

test('combat is independent of UI tick versus save replay partitions',()=>{
 const direct=fresh(1000);direct.heroes[0]=20;direct.hp=1;
 const frames=structuredClone(direct);
 for(let time=1037;time<3999;time+=73)advance(frames,time);
 advance(frames,3999);advance(direct,3999);
 for(const key of ['stage','kills','totalKills','gold','hp'])assert.equal(frames[key],direct[key],key);
 assert.equal(frames.tt2.rng,direct.tt2.rng);
});

test('snapshot save preserves exact displayed battle and isolates later taps',async()=>{
 const initial=await (await browserRequest('/api/game')).json();const live=structuredClone(initial.state);live.gold=100;live.hp=7;live.kills=4;
 const expected=structuredClone(live),pending=saveBrowserSnapshot(live,initial.revision,'snapshot-a');
 live.hp=2;live.kills=5;live.gold=200;
 const saved=await pending;assert.deepEqual(saved.state,expected);assert.equal(live.hp,2);
 const next=await saveBrowserSnapshot(live,saved.revision,'snapshot-b');assert.deepEqual(next.state,live);
 assert.equal((await readBrowserSave()).state.kills,5);
 const duplicate=await saveBrowserSnapshot(live,saved.revision,'snapshot-b');assert.equal(duplicate.revision,next.revision);
 await assert.rejects(saveBrowserSnapshot(expected,saved.revision,'stale-tab'),/LOCAL_CONFLICT/);
 assert.equal((await readBrowserSave()).state.gold,200);
});

test('all visible names and effect families have Traditional Chinese labels',()=>{
 for(const [items,key,labels] of [[TT2_HEROES,'name',HERO_NAMES],[TT2_PETS,'name',PET_NAMES],[TT2_TREE,'name',TALENT_NAMES],[TT2_SETS,'id',SET_NAMES]]){
  for(const item of items){assert.ok(labels[item[key]],item[key]);assert.doesNotMatch(labels[item[key]],/[A-Za-z]/);}
 }
 for(const set of TT2_SETS)assert.ok(RARITY_NAMES[set.rarity],set.rarity);
 const effects=[...TT2_TREE,...TT2_SETS].flatMap(x=>x.effects.map(e=>e.type)).concat([...TT2_PETS,...TT2_GEAR,...TT2_ARTIFACTS].map(x=>x.effect));
 for(const id of effects){assert.notEqual(effectLabel(id),'特殊效果',id);assert.doesNotMatch(effectLabel(id),/[A-Za-z]/,id);}
 assert.equal(fmt(10000),'1.0萬');assert.equal(fmt(1e8),'1.0億');assert.doesNotMatch(fmt(1e150),/[A-Za-z]/);
});
