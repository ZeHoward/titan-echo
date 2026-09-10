import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,apply,tapDamage,goldReward} from '../lib/engine.ts';
import {TT2_PETS,TT2_GEAR,TT2_SETS} from '../lib/tt2-data.ts';
import {effect,petBonus,equipmentValue} from '../lib/tt2-rules.ts';
import {advanceEggs,EGG_INTERVAL,collectGear,craftSet,craftPrice} from '../lib/tt2-collection.ts';
test('pets apply selected effects, five-level passive steps and full passive at 100',()=>{
 const t=fresh(1000).tt2;t.petLevels[0]=4;assert.equal(petBonus(t,0),1);
 t.petLevels[0]=5;assert.equal(petBonus(t,0),1.05);
 t.activePets[0]=0;assert.equal(effect(t,'AllDamage'),2);
 t.petLevels[0]=100;const active=petBonus(t,0);t.activePets[0]=-1;assert.equal(petBonus(t,0),active);
 t.petLevels[0]=150;assert.equal(petBonus(t,0),(1+150*.2)*1.5);
});
test('pet selection respects damage/support slots and does not overwrite the other',()=>{
 let s=fresh(1000);const support=TT2_PETS.findIndex(p=>p.slot==='Support');s.tt2.petLevels[0]=1;s.tt2.petLevels[support]=1;
 s=apply(s,{type:'petEquip',index:0,at:1000});s=apply(s,{type:'petEquip',index:support,at:1000});
 assert.deepEqual(s.tt2.activePets,[0,support]);
});
test('egg queue caps at two, cannot accumulate hidden eggs, and survives prestige',()=>{
 let s=fresh(1000);advanceEggs(s.tt2,1000+EGG_INTERVAL*10);assert.equal(s.tt2.eggs,2);
 s.last=1000+EGG_INTERVAL*10;s=apply(s,{type:'egg',at:s.last});assert.equal(s.tt2.eggs,1);assert.equal(s.tt2.petLevels.reduce((a,b)=>a+b),1);
 advanceEggs(s.tt2,s.last+1);assert.equal(s.tt2.eggs,1);
 s.best=60;const levels=[...s.tt2.petLevels];s=apply(s,{type:'prestige',at:s.last});assert.deepEqual(s.tt2.petLevels,levels);
});
test('equipment formula uses both nonlinear terms, equipment changes actual damage',()=>{
 let s=fresh(1000);const i=TT2_GEAR.findIndex(g=>g.effect==='AllDamage'&&g.slot===0),g=TT2_GEAR[i];
 collectGear(s.tt2,i,10);assert.equal(equipmentValue(s.tt2.inventory[0]),g.base+g.inc*(10**g.exp1+g.expBase**(10**g.exp2)));
 const before=tapDamage(s);s=apply(s,{type:'equip',index:1,at:1000});assert.ok(tapDamage(s)>before);
 const gold=goldReward(s,'monster');s.tt2.equipped[0]=-1;assert.equal(goldReward(s,'monster'),gold);
});
test('craft charges incremental prices, completes five slots and retains collection after discard',()=>{
 const t=fresh(1000).tt2;const i=TT2_SETS.findIndex(k=>k.rarity==='Legendary'&&[0,1,2,3,4].every(slot=>TT2_GEAR.some(g=>g.set===k.id&&g.slot===slot)));
 assert.ok(i>=0);t.shards=140;for(let n=0;n<5;n++){const before=t.shards,price=craftPrice(t,i);assert.equal(craftSet(t,i,1e6),true);assert.equal(before-t.shards,price);}
 assert.equal(t.shards,0);assert.ok(t.sets.includes(i));t.inventory=[];assert.equal(t.pieces.filter(p=>p.set===i).length,5);assert.equal(craftSet(t,i,1e6),false);
});
test('daily rewards cannot be claimed twice and follow the fourteen-day table',()=>{
 let s=fresh(1000);s=apply(s,{type:'daily',at:1000});assert.equal(s.tt2.loginIndex,1);const gold=s.gold;
 s=apply(s,{type:'daily',at:1000});assert.equal(s.gold,gold);assert.equal(s.tt2.loginIndex,1);
 s=apply(s,{type:'daily',at:86400001});assert.equal(s.diamonds,25);assert.equal(s.tt2.loginIndex,2);
});
