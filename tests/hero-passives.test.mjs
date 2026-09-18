import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,apply,hydrate,stateEffect,critChance,manaMax,heroDps,tapDamage,goldReward,BONUS_DEFAULTS,SKILLS,MANA_DEFAULTS,unlockedSkills} from '../lib/engine.ts';
const capOf=(s)=>MANA_DEFAULTS.capPerSkill*unlockedSkills(s);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
import {heroPassiveTotals} from '../lib/tt2-hero-passives.ts';
import {HERO_NAMES,PET_NAMES,TALENT_NAMES,SET_NAMES} from '../lib/zh-tw.ts';
import {TT2_HEROES,TT2_PETS,TT2_TREE,TT2_ARTIFACTS} from '../lib/tt2-data.ts';
import {B,N} from './amounts.mjs';

test('source names join stable IDs, including reordered artifacts',()=>{
 assert.equal(HERO_NAMES[TT2_HEROES[0].name],'旁觀者馬雅慕爾塔');
 assert.equal(PET_NAMES[TT2_PETS[0].name],'諾瓦');
 assert.equal(PET_NAMES[TT2_PETS[1].name],'多多');
 assert.equal(TALENT_NAMES[TT2_TREE[0].name],'騎士勇氣');
 assert.equal(SET_NAMES.ScrollTutor,'織龍者');
 assert.equal(TT2_ARTIFACTS.find(a=>a.id==='Artifact1').name,'英雄護盾');
 assert.equal(TT2_ARTIFACTS[0].id,'Artifact22');
});

test('Maya passives unlock at CSV boundaries and reach actual damage, gold and mana',()=>{
 const s=fresh(1000),tap=N(tapDamage(s)),gold=N(goldReward(s,'chest'));
 s.heroes[0]=19;assert.equal(stateEffect(s,'CritDamage'),1);
 s.heroes[0]=20;assert.equal(stateEffect(s,'CritDamage'),1.1);assert.equal(N(tapDamage(s)),tap*1.1);
 s.heroes[0]=59;assert.equal(critChance(s),BONUS_DEFAULTS.critChance);
 s.heroes[0]=60;near(critChance(s),BONUS_DEFAULTS.critChance+.001);
 s.heroes[0]=99;assert.equal(N(goldReward(s,'chest')),gold);
 s.heroes[0]=100;assert.ok(Math.abs(N(goldReward(s,'chest'))/gold-1.1)<1e-12);
 // The cap is 35 per unlocked active skill now, so the player level decides the base.
 s.level=Math.max(...SKILLS.map(k=>k.level));const cap=MANA_DEFAULTS.capPerSkill*SKILLS.length;
 s.heroes[0]=499;assert.equal(manaMax(s),cap);
 s.heroes[0]=500;near(manaMax(s),cap+3);
});

test('multipliers combine independently and pending consumers stay inactive',()=>{
 const levels=Array(37).fill(0);levels[0]=1000;levels[1]=100;
 const totals=heroPassiveTotals(levels);
 assert.ok(Math.abs(totals.CritDamage-1.21)<1e-12);
 // 英雄轉點擊已於 2.14.1 接上，所以這個被動現在會累計；其餘三個仍在 PENDING_HERO_EFFECTS。
 assert.equal(totals.TapDamageFromHelpers,0.0001);
 assert.equal(totals.Goldx10Chance,undefined);
 assert.equal(totals.MultiMonstersGold,undefined);
 assert.equal(totals.PetGoldQTEAmount,undefined);
});

test('passives derive on load and reset on prestige without leaking between players',()=>{
 const a=fresh(1000),b=fresh(1000);a.heroes[0]=500;
 assert.equal(manaMax(a),capOf(a)+3);assert.equal(manaMax(b),capOf(b));
 const restored=hydrate(JSON.parse(JSON.stringify(a)));assert.equal(manaMax(restored),capOf(restored)+3);
 restored.best=60;const reset=apply(restored,{type:'prestige',at:1000});
 assert.equal(manaMax(reset),capOf(reset));assert.equal(stateEffect(reset,'CritDamage'),1);
 assert.equal(reset.version,2);assert.equal(reset.heroes.length,33);
});

test('hero milestones use the cumulative row once at the level boundary',()=>{
 const s=fresh(1000);s.heroes[1]=9;const before=N(heroDps(s,1));
 s.heroes[1]=10;assert.ok(Math.abs(N(heroDps(s,1))/before-(10/9)*1.035*3)<1e-10);
 s.heroes[1]=30;
 // Composing the factors through the significand/exponent pair reassociates the
 // multiplications, so the last digit moves; the milestone itself must be exact.
 assert.ok(Math.abs(N(heroDps(s,1))/(131*30*1.035**29*9)-1)<1e-12);
});
