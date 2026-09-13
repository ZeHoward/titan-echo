import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,hydrate,apply,petAttackDamage} from '../lib/engine.ts';
import {petRequiredTaps,petDamageFactor} from '../lib/tt2-pet-combat.ts';
import {TT2_TREE,TT2_ARTIFACTS} from '../lib/tt2-data.ts';

test('the twentieth accepted tap fires a pet attack and subtracts real enemy health',()=>{
 let s=fresh(1000);s.tt2.petLevels[0]=1;s.tt2.activePets[0]=0;s.hp=1e9;
 for(let i=0;i<19;i++)s=apply(s,{type:'tap',at:1000+i*50});
 assert.equal(s.tt2.petCharge,19);assert.equal(s.tt2.petAttacks,0);
 const hp=s.hp;s=apply(s,{type:'tap',at:1950});
 assert.equal(s.tt2.petCharge,0);assert.equal(s.tt2.petAttacks,1);assert.ok(s.tt2.lastPetHit>0);
 assert.ok(Math.abs((hp-s.hp)-s.tt2.lastHit-s.tt2.lastPetHit)<1e-6);
});
test('rejected taps and absent pets cannot generate pet attacks',()=>{
 let s=fresh(1000);for(let i=0;i<30;i++)s=apply(s,{type:'tap',at:1000+i*50});
 assert.equal(s.tt2.petAttacks,0);assert.equal(s.tt2.petCharge,0);
 s.tt2.petLevels[0]=1;s.tt2.activePets[0]=0;s=apply(s,{type:'tap',at:3000});
 s=apply(s,{type:'tap',at:3001});assert.equal(s.tt2.petCharge,1);
});
test('pet evolution reduces charge requirement using the pinned skill table',()=>{
 const s=fresh(1000),i=TT2_TREE.findIndex(k=>k.id==='PetDmg');
 assert.equal(petRequiredTaps(s.tt2),20);s.tt2.tree[i]=1;assert.equal(petRequiredTaps(s.tt2),19);
 s.tt2.tree[i]=15;assert.equal(petRequiredTaps(s.tt2),5);
});
test('pet coefficients follow 40 and 80 level boundaries and damage artifacts apply',()=>{
 const s=fresh(1000);s.tt2.activePets[0]=0;
 for(const [level,expected] of [[40,1+6+40*.38],[80,1+6+80*.38],[81,1+6+80*.38+.12]]){s.tt2.petLevels[0]=level;assert.equal(petDamageFactor(s.tt2),expected);}
 const before=petAttackDamage(s);s.tt2.artifacts[TT2_ARTIFACTS.findIndex(a=>a.effect==='PetDamage')]=1;assert.ok(petAttackDamage(s)>before);
});
test('partial charge survives hydration but prestige starts a new charge',()=>{
 let s=fresh(1000);s.tt2.petCharge=9;s.tt2.petAttacks=17;s.best=60;
 s=hydrate(JSON.parse(JSON.stringify(s)));assert.equal(s.tt2.petCharge,9);
 s=apply(s,{type:'prestige',at:1000});assert.equal(s.tt2.petCharge,0);assert.equal(s.tt2.petAttacks,17);
 delete s.tt2.petCharge;delete s.tt2.petAttacks;delete s.tt2.lastPetHit;hydrate(s);assert.equal(s.tt2.petCharge,0);
});
