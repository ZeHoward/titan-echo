import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,apply,hydrate,cost,swordMasterBaseDamage,buildDamage} from '../lib/engine.ts';
import {PLAYER_DEFAULTS,playerBaseDamage,playerUpgradeCost} from '../lib/tt2-player.ts';
import {TT2_ARTIFACTS} from '../lib/tt2-data.ts';
import {B,N} from './amounts.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<=Math.max(1,Math.abs(b))*1e-10,`${a} != ${b}`);

test('native intrinsic damage is level times reached cumulative milestone',()=>{
 assert.equal(PLAYER_DEFAULTS.damage,1);
 assert.equal(N(playerBaseDamage(1)),1);assert.equal(N(playerBaseDamage(9)),9);
 assert.equal(N(playerBaseDamage(10)),20);assert.equal(N(playerBaseDamage(30)),120);
 near(N(playerBaseDamage(80)),2560);near(N(playerBaseDamage(100)),12800);
 const s=fresh(1000);s.level=100;near(N(swordMasterBaseDamage(s)),12800);
 near(N(buildDamage(s,'tap')),12800);
 s.heroes[0]=20;near(N(swordMasterBaseDamage(s)),12800);
});

test('cost starts at current level and bulk price equals the geometric sum',()=>{
 const r=Math.fround(1.075);
 near(N(playerUpgradeCost(1)),5*r);near(N(playerUpgradeCost(2)),5*r*r);
 const expected=Array.from({length:10},(_,i)=>5*r**(20+i)).reduce((a,b)=>a+b,0);
 near(N(playerUpgradeCost(20,10)),expected);
 assert.equal(N(playerUpgradeCost(20,0)),0);
 const s=fresh(1000);s.level=20;near(N(cost(s,-1,10)),expected);
 const discount=TT2_ARTIFACTS.findIndex(a=>a.effect==='AllUpgradeCost');
 assert.ok(discount>=0);s.tt2.artifacts[discount]=1;
 near(N(cost(s,-1,10)),expected*(1-TT2_ARTIFACTS[discount].value));
});

test('fractional purchase respects affordability and max-buy stops at the budget',()=>{
 const s=fresh(1000),price=N(cost(s,-1));
 s.gold=price-1e-5;apply(s,{type:'upgrade',at:1000});assert.equal(s.level,1);
 s.gold=price;apply(s,{type:'upgrade',at:1000});assert.equal(s.level,2);near(N(s.gold),0);
 s.gold=N(cost(s,-1,25))+1e-7;
 apply(s,{type:'upgrade',amount:0,at:1000});assert.equal(s.level,27);
 assert.ok(N(s.gold)>=0&&N(s.gold)<N(cost(s,-1)));
});

test('recalculation preserves progress and does not rewrite saved gold on load',()=>{
 const s=fresh(1000);s.level=100;s.best=400;s.stage=200;s.gold=B(123.456);
 s.tt2.artifacts[0]=10;const snapshot=JSON.stringify(s);
 const loaded=hydrate(JSON.parse(snapshot));N(swordMasterBaseDamage(loaded));N(cost(loaded,-1,25));
 assert.equal(JSON.stringify(loaded),snapshot);
 assert.equal(loaded.version,2);assert.equal(loaded.heroes.length,33);
});
