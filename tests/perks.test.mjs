import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,hydrate,apply,advance,manaRegen,manaMax,heroLevel} from '../lib/engine.ts';
import {perkLevel,perkValue,manaSeconds} from '../lib/tt2-perks.ts';

test('mana potion pays once, refills mana and caps at three independently timed stacks',()=>{
 let s=fresh(1000);s.diamonds=400;s.tt2.mana=0;
 s=apply(s,{type:'resourcePerk',index:0,at:1000});assert.equal(s.diamonds,300);assert.equal(s.tt2.mana,manaMax(s));assert.equal(manaRegen(s),2/60*1.5);
 s=apply(s,{type:'resourcePerk',index:0,at:2000});s=apply(s,{type:'resourcePerk',index:0,at:3000});s=apply(s,{type:'resourcePerk',index:0,at:4000});
 assert.equal(s.diamonds,100);assert.equal(perkLevel(s.tt2,0,4000),3);
 assert.equal(perkLevel(s.tt2,0,43201000),2);assert.equal(perkValue(s.tt2,0,43201000),1.75);
});
test('offline mana calculation integrates expiry instead of applying an expired buff',()=>{
 const s=fresh(1000);s.tt2.perkEnds[0]=[61000];assert.equal(manaSeconds(s.tt2,1000,121000),150);
 s.tt2.mana=0;advance(s,121000);assert.equal(s.tt2.mana,5);
});
test('rain spends available gold on heroes, respects interval and never buys sword levels',()=>{
 let s=fresh(1000);s.diamonds=100;s.gold=30;s=apply(s,{type:'resourcePerk',index:1,at:1000});
 assert.equal(heroLevel(s,0),1);assert.equal(s.gold,0);assert.equal(s.level,1);assert.equal(s.diamonds,0);
 s.gold=1e8;for(let now=2000;now<=45000;now+=1000)advance(s,now);
 assert.equal(s.heroes.reduce((a,b)=>a+b),1);advance(s,46000);assert.ok(s.heroes.reduce((a,b)=>a+b)>1);assert.ok(s.gold>=0);
});
test('login tokens and diamond purchases are distinct and survive prestige',()=>{
 let s=fresh(1000);s.tt2.perkTokens=1;s.best=60;s.diamonds=50;
 s=apply(s,{type:'resourcePerk',index:0,amount:1,at:1000});assert.equal(s.tt2.perkTokens,0);assert.equal(s.diamonds,50);
 s=apply(s,{type:'resourcePerk',index:0,amount:1,at:1000});assert.equal(perkLevel(s.tt2,0,1000),1);
 s=apply(s,{type:'resourcePerk',index:1,at:1000});assert.equal(perkLevel(s.tt2,1,1000),0);
 const ends=structuredClone(s.tt2.perkEnds);s=apply(s,{type:'prestige',at:1000});assert.deepEqual(s.tt2.perkEnds,ends);
 delete s.tt2.perkEnds;delete s.tt2.rainLast;hydrate(s);assert.deepEqual(s.tt2.perkEnds,[[],[]]);assert.equal(s.diamonds,50);
});
