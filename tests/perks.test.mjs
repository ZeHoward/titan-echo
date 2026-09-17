import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {referenceRoot} from '../tools/reference-validation.mjs';
import {loadRegister} from '../tools/formula-sources.mjs';
import {fresh,hydrate,apply,advance,manaRegen,manaMax,heroLevel,SKILLS} from '../lib/engine.ts';
import {TT2_SETS} from '../lib/tt2-data.ts';
import {RESOURCE_PERKS,perkLevel,perkLimit,perkValue,activatePerk,rainIntervalScale,manaSeconds} from '../lib/tt2-perks.ts';
import {B,N} from './amounts.mjs';

test('mana potion pays once, refills mana and keeps three independently timed stacks',()=>{
 let s=fresh(1000);s.level=Math.max(...SKILLS.map(k=>k.level));s.diamonds=400;s.tt2.mana=0;
 s=apply(s,{type:'resourcePerk',index:0,at:1000});assert.equal(s.diamonds,300);assert.equal(s.tt2.mana,manaMax(s));assert.equal(manaRegen(s),2/60*1.5);
 s=apply(s,{type:'resourcePerk',index:0,at:2000});s=apply(s,{type:'resourcePerk',index:0,at:3000});
 assert.equal(s.diamonds,100);assert.equal(perkLevel(s.tt2,0,3000),3);
 assert.equal(perkLevel(s.tt2,0,43201000),2);assert.equal(perkValue(s.tt2,0,43201000),1.75);
 // A fourth use at the limit is not refused: the native ActivatePerk drops the shortest stack and
 // adds a fresh one, so it costs a hundred diamonds and the earliest stack stops expiring first.
 s=apply(s,{type:'resourcePerk',index:0,at:4000});
 assert.equal(s.diamonds,0);assert.equal(perkLevel(s.tt2,0,4000),3);assert.equal(perkLevel(s.tt2,0,43201000),3);
});
test('offline mana calculation integrates expiry instead of applying an expired buff',()=>{
 const s=fresh(1000);s.level=Math.max(...SKILLS.map(k=>k.level));s.tt2.perkEnds[0]=[61000];assert.equal(manaSeconds(s.tt2,1000,121000),150);
 s.tt2.mana=0;advance(s,121000);assert.equal(s.tt2.mana,5);
});
test('rain spends available gold on heroes, respects interval and never buys sword levels',()=>{
 let s=fresh(1000);s.diamonds=100;s.gold=B(30);s=apply(s,{type:'resourcePerk',index:1,at:1000});
 assert.equal(heroLevel(s,0),1);assert.equal(N(s.gold),0);assert.equal(s.level,1);assert.equal(s.diamonds,0);
 s.gold=B(1e8);for(let now=2000;now<=45000;now+=1000)advance(s,now);
 assert.equal(s.heroes.reduce((a,b)=>a+b),1);advance(s,46000);assert.ok(s.heroes.reduce((a,b)=>a+b)>1);assert.ok(N(s.gold)>=0);
});
test('login tokens and diamond purchases are distinct and survive prestige',()=>{
 let s=fresh(1000);s.tt2.perkTokens=1;s.best=60;s.diamonds=50;
 s=apply(s,{type:'resourcePerk',index:0,amount:1,at:1000});assert.equal(s.tt2.perkTokens,0);assert.equal(s.diamonds,50);
 s=apply(s,{type:'resourcePerk',index:0,amount:1,at:1000});assert.equal(perkLevel(s.tt2,0,1000),1);
 s=apply(s,{type:'resourcePerk',index:1,at:1000});assert.equal(perkLevel(s.tt2,1,1000),0);
 const ends=structuredClone(s.tt2.perkEnds);s=apply(s,{type:'prestige',at:1000});assert.deepEqual(s.tt2.perkEnds,ends);
 delete s.tt2.perkEnds;delete s.tt2.rainLast;hydrate(s);assert.deepEqual(s.tt2.perkEnds,[[],[]]);assert.equal(s.diamonds,50);
});

// What the 8.2 package says the two perks above are supposed to do.
const evidence=JSON.parse(readFileSync(new URL('perk-evidence.json',referenceRoot),'utf8'));
const baseline=JSON.parse(readFileSync(new URL('../docs/reference-baseline.json',import.meta.url),'utf8'));
const setIndex=id=>TT2_SETS.findIndex(set=>set.id===id);
const NOW=1000000;

test('證據取自釘住的那份安裝包，不是別的版本',()=>{
 assert.equal(evidence.version,'8.2.0');assert.equal(evidence.packageSha256,baseline.package.sha256);
 assert.match(evidence.binarySha256,/^[0-9a-f]{64}$/);
});
test('兩個 perk 的四段數值、時長與費用就是 8.2 資料表裡的值',()=>{
 for(const [index,id] of [[0,'ManaPotion'],[1,'MakeItRain']]){
  const native=evidence.perks[id];assert.deepEqual([...RESOURCE_PERKS[index].values],native.amounts,id);
  // The table stores seconds; the engine stores the same span in milliseconds.
  assert.equal(RESOURCE_PERKS[index].duration,native.durationSeconds*1000,id);
  assert.equal(RESOURCE_PERKS[index].cost,native.baseCost,id);
 }
 // The diamond price is a [ServerVar] with the same compiled-in default, not just a table column.
 assert.equal(evidence.serverVarDefaults.perkDiamondCost.value,RESOURCE_PERKS[0].cost);
});
test('層數上限是原生的 3，PerkMaster 套裝解鎖第四層',()=>{
 assert.equal(evidence.stackLimit.base,3);assert.equal(evidence.stackLimit.hardCap,4);
 // MAX_PERK_STACK is also the fixed length of ActivePerkInfo.timers, so 4 is a real ceiling.
 assert.equal(evidence.stackLimit.timerSlots,evidence.stackLimit.hardCap);
 const s=fresh(NOW);assert.equal(perkLimit(s.tt2),evidence.stackLimit.base);
 s.tt2.sets=[setIndex('PerkMaster')];assert.equal(perkLimit(s.tt2),evidence.stackLimit.hardCap);
});
test('層數直接當索引，第 n 層取第 n 個值',()=>{
 const s=fresh(NOW);s.tt2.sets=[setIndex('PerkMaster')];
 assert.equal(perkValue(s.tt2,0,NOW),1,'沒喝藥水時倍率是 1');
 for(let stack=1;stack<=4;stack++){
  activatePerk(s.tt2,0,NOW);assert.equal(perkLevel(s.tt2,0,NOW),stack);
  assert.equal(perkValue(s.tt2,0,NOW),evidence.perks.ManaPotion.amounts[stack-1]);
 }
});
test('滿層時不是拒絕，而是把剩餘最短的一層換成完整十二小時',()=>{
 const s=fresh(NOW),limit=perkLimit(s.tt2);
 for(let stack=0;stack<limit;stack++)assert.equal(activatePerk(s.tt2,1,NOW+stack),true);
 const before=[...s.tt2.perkEnds[1]],at=NOW+60000;
 assert.equal(activatePerk(s.tt2,1,at),true,'原生 ActivatePerk 在滿層時照樣發動');
 const after=s.tt2.perkEnds[1];
 assert.equal(after.length,limit,'層數不變');
 assert.ok(!after.includes(before[0]),'剩餘時間最短的那層被 RemoveOldestStack 清掉');
 assert.ok(after.includes(before[before.length-1]),'其餘的層照原本的時間繼續跑');
 assert.equal(after[after.length-1],at+RESOURCE_PERKS[1].duration,'新的一層是完整十二小時');
});
test('黃金雨的間隔會被 GoldRain 套裝縮短，且夾在 autoBuyHeroesMaxBonus',()=>{
 const cap=evidence.makeItRainMultiplier.cap.value,s=fresh(NOW);
 assert.equal(rainIntervalScale(s.tt2),1,'沒有那個加成時乘數是 1');
 activatePerk(s.tt2,1,NOW);const plain=perkValue(s.tt2,1,NOW);
 assert.equal(plain,evidence.perks.MakeItRain.amounts[0]);
 s.tt2.sets=[setIndex('GoldRain')];
 const bonus=TT2_SETS[setIndex('GoldRain')].effects.find(effect=>effect.type==='AutoBuyHeroesMultDuringMakeItRain').amount;
 assert.equal(rainIntervalScale(s.tt2),1-bonus);
 assert.ok(Math.abs(perkValue(s.tt2,1,NOW)-plain*(1-bonus))<1e-9);
 // The cap is stored as a float, so 5% of the tabled interval is the floor however much it stacks.
 assert.equal(cap,Math.fround(0.95));assert.ok(1-cap>0&&1-cap<0.06);
 // Mana Potion takes no multiplier: only PerkID.MakeItRain reaches that branch.
 activatePerk(s.tt2,0,NOW);assert.equal(perkValue(s.tt2,0,NOW),evidence.perks.ManaPotion.amounts[0]);
});
test('登記為安裝包資料表與原生預設值，未還原的部分逐項列名',()=>{
 const register=loadRegister(),perks=register.formulas.find(formula=>formula.id==='perks');
 assert.ok(perks.parts.length>=3,'拆成數值、層數與黃金雨修正三項以上');
 assert.ok(!perks.parts.some(part=>part.status==='baseline-75'),'不該再有沿用 7.5 的條目');
 // Every part names its evidence; the immediate-gold one has a file of its own.
 for(const part of perks.parts)assert.ok(['perk-evidence.json','perk-gold-evidence.json'].includes(part.ref),part.part);
 // Still missing on purpose, and named rather than counted.
 for(const key of ['perkSelectUnlockStage','immediateGold','otherPerks'])assert.ok(evidence.notImplemented[key],key);
 assert.equal(evidence.serverVarDefaults.perkSelectUnlockStage.value,1200);
 assert.ok(evidence.limits.some(limit=>limit.includes('[ServerVar]')));
});
