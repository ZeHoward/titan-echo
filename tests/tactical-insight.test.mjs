import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,apply,hydrate,stateEffect,manaMax,critChance,critMultiplier,tapDamage,BONUS_DEFAULTS,SKILLS,MANA_DEFAULTS,unlockedSkills} from '../lib/engine.ts';
import {TT2_TREE,TT2_BONUSES} from '../lib/tt2-data.ts';
import {B,N} from './amounts.mjs';
const insight=TT2_TREE.findIndex(k=>k.id==='HelperBoost');
const commander=TT2_TREE.findIndex(k=>k.id==='AllHelperDmg');
const capOf=(state)=>MANA_DEFAULTS.capPerSkill*unlockedSkills(state);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('Tactical Insight affects individual unlocked powers, not base player stats',()=>{
 const s=fresh(1000);s.tt2.tree[insight]=1;
 const cap=MANA_DEFAULTS.capPerSkill*unlockedSkills(s);
 assert.equal(cap,0,'等級 1 還沒解鎖任何主動技能');assert.equal(manaMax(s),cap);assert.equal(critChance(s),BONUS_DEFAULTS.critChance);assert.equal(stateEffect(s,'CritDamage'),1);
 s.heroes[0]=500;
 near(manaMax(s),cap+3.06);near(critChance(s),BONUS_DEFAULTS.critChance+.00102);
 near(stateEffect(s,'CritDamage'),1.1*1.0032);
 // 那個加成只走暴擊倍率，一般點擊傷害不吃它。
 near(N(tapDamage(s)),1);near(critMultiplier(s)/11.5,1.1*1.0032);
 s.heroes[1]=100;
 near(stateEffect(s,'CritDamage'),(1.1*1.0032)**2);
});

test('buy and reset invalidate warm passive caches and clamp current mana',()=>{
 const s=fresh(1000);s.best=300;s.heroes[0]=500;s.tt2.points=20;s.tt2.tree[commander]=2;
 near(stateEffect(s,'CritDamage'),1.1);
 apply(s,{type:'talent',index:insight,at:1000});
 assert.equal(s.tt2.tree[insight],1);assert.equal(s.tt2.points,19);
 near(stateEffect(s,'CritDamage'),1.10352);
 s.tt2.mana=manaMax(s);apply(s,{type:'resetTalents',at:1000});
 near(stateEffect(s,'CritDamage'),1.1);near(s.tt2.mana,capOf(s)+3);
 assert.equal(s.tt2.points,23);
});

test('loading keeps TI, prestige keeps its level but requires hero powers again',()=>{
 const s=fresh(1000);s.heroes[0]=500;s.best=60;s.tt2.tree[insight]=1;
 const loaded=hydrate(JSON.parse(JSON.stringify(s)));near(manaMax(loaded),capOf(loaded)+3.06);
 const reset=apply(loaded,{type:'prestige',at:1000});
 assert.equal(reset.tt2.tree[insight],1);assert.equal(manaMax(reset),capOf(reset));
 assert.equal(stateEffect(reset,'CritDamage'),1);
 reset.heroes[0]=20;near(stateEffect(reset,'CritDamage'),1.10352);
});

test('unimplemented effects are not activated by high-level Tactical Insight',()=>{
 const s=fresh(1000);s.heroes.fill(2000);s.tt2.extraHeroes.fill(2000);s.tt2.tree[insight]=30;
 // 英雄轉點擊已接上，戰術洞察會放大它；剩下三個未實作的效果才是這條守衛的對象。
 assert.ok(stateEffect(s,'TapDamageFromHelpers')>0);
 // 未生效的中性值要看加成是加法還是乘法：加法是 0，乘法是 1。
 for(const effect of ['Goldx10Chance','MultiMonstersGold','PetGoldQTEAmount'])
  assert.equal(stateEffect(s,effect),TT2_BONUSES[effect].additive?0:1,effect);
 const independent=fresh(1000);assert.equal(stateEffect(independent,'CritDamage'),1);
 assert.ok(Number.isFinite(N(tapDamage(s))));
});
