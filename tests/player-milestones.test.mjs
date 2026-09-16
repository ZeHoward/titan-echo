import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,apply,hydrate,buildDamage,petAttackDamage} from '../lib/engine.ts';
import {playerMilestone,nextPlayerMilestone} from '../lib/tt2-player.ts';
import {PLAYER_LEVEL_CAP} from '../lib/tt2-limits.ts';
import {fromText,toNumber} from '../lib/big-number.ts';
import {PLAYER_MILESTONES} from '../lib/tt2-player-milestones.ts';
import {B,N} from './amounts.mjs';
const near=(a,b)=>assert.ok(Math.abs(a/b-1)<1e-10,`${a} != ${b}`);
const intrinsic=n=>n;

test('milestones use TotalNew at exact boundaries, including rows absent from old columns',()=>{
 assert.equal(PLAYER_MILESTONES.length,234);
 const value=level=>toNumber(playerMilestone(level));
 assert.equal(value(9),1);assert.equal(value(10),2);
 assert.equal(value(29),2);assert.equal(value(30),4);
 assert.equal(value(79),16);assert.equal(value(80),32);
 assert.equal(value(100),128);assert.equal(value(110),384);
 assert.deepEqual(playerMilestone(150),{s:4.61,e:3}); // Table rounds the cumulative value.
 assert.equal(nextPlayerMilestone(79).level,80);
 // The table runs to 12500, and the engine no longer stops the list at an invented 2000.
 assert.equal(nextPlayerMilestone(2000).level,2050);
 assert.equal(nextPlayerMilestone(PLAYER_LEVEL_CAP),undefined);
 assert.equal(PLAYER_MILESTONES[PLAYER_MILESTONES.length-1].level,PLAYER_LEVEL_CAP);
 // TotalNew is kept as its source text: 46 rows exceed 1e240 and the last has no double at all.
 assert.equal(PLAYER_MILESTONES.filter(m=>Number(m.total)>1e240).length,46);
 assert.equal(PLAYER_MILESTONES[PLAYER_MILESTONES.length-1].total,'9.07E+363');
 assert.equal(toNumber(fromText('9.07E+363')),Number.MAX_VALUE);
 assert.ok(PLAYER_MILESTONES.every(m=>Number.isFinite(fromText(m.total).e)));
});

test('milestone changes actual tap and pet damage while ship gets no tap bonus',()=>{
 const s=fresh(1000);s.tt2.petLevels[0]=1;s.tt2.activePets[0]=0;
 const baseline=fresh(1000);baseline.tt2.petLevels[0]=1;baseline.tt2.activePets[0]=0;
 s.level=80;
 near(N(buildDamage(s,'tap'))/N(buildDamage(baseline,'tap')),intrinsic(80)*32);
 near(N(petAttackDamage(s))/N(petAttackDamage(baseline)),intrinsic(80)*32);
 near(N(buildDamage(s,'ship'))/N(buildDamage(baseline,'ship')),1);
 s.skillLevels[0]=1;baseline.skillLevels[0]=1;
 near(N(buildDamage(s,'clone'))/N(buildDamage(baseline,'clone')),(intrinsic(80)*32)**.6);
});

test('bulk upgrade crosses milestones once and loading never compounds the multiplier',()=>{
 const s=fresh(1000);s.level=5;s.gold=B(1e100);
 apply(s,{type:'upgrade',amount:100,at:1000});assert.equal(s.level,105);
 const damage=N(buildDamage(s,'tap'));near(damage,intrinsic(105)*128);
 const loaded=hydrate(JSON.parse(JSON.stringify(s)));
 near(N(buildDamage(loaded,'tap')),damage);near(N(buildDamage(hydrate(loaded),'tap')),damage);
 loaded.best=60;const reset=apply(loaded,{type:'prestige',at:1000});
 assert.equal(reset.level,1);assert.equal(N(playerMilestone(reset.level)),1);
 assert.equal(reset.version,2);assert.equal(reset.heroes.length,33);
});
