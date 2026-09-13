import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,apply,hydrate,buildDamage,petAttackDamage} from '../lib/engine.ts';
import {playerMilestone,nextPlayerMilestone} from '../lib/tt2-player.ts';
import {PLAYER_MILESTONES} from '../lib/tt2-player-milestones.ts';
const near=(a,b)=>assert.ok(Math.abs(a/b-1)<1e-10,`${a} != ${b}`);
const oldBase=n=>(1+2*(n-1))*1.025**(n-1);

test('milestones use TotalNew at exact boundaries, including rows absent from old columns',()=>{
 assert.equal(PLAYER_MILESTONES.length,234);
 assert.equal(playerMilestone(9),1);assert.equal(playerMilestone(10),2);
 assert.equal(playerMilestone(29),2);assert.equal(playerMilestone(30),4);
 assert.equal(playerMilestone(79),16);assert.equal(playerMilestone(80),32);
 assert.equal(playerMilestone(100),128);assert.equal(playerMilestone(110),384);
 assert.equal(playerMilestone(150),4610); // Table rounds the cumulative value.
 assert.equal(nextPlayerMilestone(79).level,80);
 assert.equal(nextPlayerMilestone(2000),undefined);
 assert.ok(PLAYER_MILESTONES.every(m=>Number.isFinite(m.total)&&m.total<=1e240));
});

test('milestone changes actual tap and pet damage while ship gets no tap bonus',()=>{
 const s=fresh(1000);s.tt2.petLevels[0]=1;s.tt2.activePets[0]=0;
 const baseline=fresh(1000);baseline.tt2.petLevels[0]=1;baseline.tt2.activePets[0]=0;
 s.level=80;
 near(buildDamage(s,'tap')/buildDamage(baseline,'tap'),oldBase(80)*32);
 near(petAttackDamage(s)/petAttackDamage(baseline),oldBase(80)*32);
 near(buildDamage(s,'ship')/buildDamage(baseline,'ship'),oldBase(80));
 s.skillLevels[0]=1;baseline.skillLevels[0]=1;
 near(buildDamage(s,'clone')/buildDamage(baseline,'clone'),oldBase(80)*32**.6);
});

test('bulk upgrade crosses milestones once and loading never compounds the multiplier',()=>{
 const s=fresh(1000);s.level=5;s.gold=1e100;
 apply(s,{type:'upgrade',amount:100,at:1000});assert.equal(s.level,105);
 const damage=buildDamage(s,'tap');near(damage,oldBase(105)*128);
 const loaded=hydrate(JSON.parse(JSON.stringify(s)));
 near(buildDamage(loaded,'tap'),damage);near(buildDamage(hydrate(loaded),'tap'),damage);
 loaded.best=60;const reset=apply(loaded,{type:'prestige',at:1000});
 assert.equal(reset.level,1);assert.equal(playerMilestone(reset.level),1);
 assert.equal(reset.version,2);assert.equal(reset.heroes.length,33);
});
