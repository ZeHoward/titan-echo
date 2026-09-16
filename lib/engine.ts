import {heroPassiveTotals,heroPowerBoost} from './tt2-hero-passives.ts';
import {playerBaseDamage,playerUpgradeCost} from './tt2-player.ts';
import {chargePet,petDamageFactor} from './tt2-pet-combat.ts';
import {RESOURCE_PERKS,perkValue,activatePerk,manaSeconds} from './tt2-perks.ts';
import {HERO_NAMES,PET_NAMES} from './zh-tw.ts';
import {advanceEggs,awardPet,dropGear,craftSet} from './tt2-collection.ts';
import {TT2_PETS,TT2_GEAR,TT2_DAILY,TT2_HEROES,TT2_HERO_MILESTONES} from './tt2-data.ts';
import {freshTT2,TT2_RULESET,TT2_ARTIFACTS,TT2_ACTIVE,TT2_TREE,effect,artifactAllDamage,buildMultiplier,upgradeArtifactCost,discoveryCost,drawArtifact,canBuyTalent,spentPoints,tt2Random,bonusDefinitions, type TT2State, type Build} from './tt2-rules.ts';
export {TT2_ARTIFACTS,TT2_TREE,discoveryCost};
import { EXTRA_HEROES, ARTIFACTS, MONSTERS, DAILY_TASKS, ACHIEVEMENTS, PERKS, ACTION_TYPES, type Effect } from './content.ts';
export { ARTIFACTS, MONSTERS, DAILY_TASKS, ACHIEVEMENTS, PERKS, ACTION_TYPES } from './content.ts';
export const HEROES=TT2_HEROES.map(h=>({name:HERO_NAMES[h.name],title:h.kind,icon:'⚔️',base:h.base,power:h.power}));
// Save indices remain stable: clone, deadly, war cry, fire sword, midas, strike.
export const SKILL_DATA=[5,1,4,3,2,0].map(i=>TT2_ACTIVE[i]);
export const SKILL_ORDER=[5,1,4,3,2,0];
export const SKILLS=SKILL_DATA.map((k,i)=>({name:['影分身之術','致命爆擊','戰爭狂嚎','火焰之劍','點石成金','天堂聖擊'][i],icon:['👥','🎯','📯','🔥','✋','☄️'][i],desc:['持續造成影分身傷害','提高致命攻擊傷害及觸發機率','提高英雄傷害','提高點擊傷害','提高各金源收益','造成一擊天堂傷害'][i],level:k.unlock,cooldown:k.cooldown,duration:k.duration}));
export type Gear={id:number;slot:number;rarity:number;power:number;level:number};
export type Trial={kind:'dungeon'|'challenge';tier:number;wave:number;base:number;endAt:number;period:number};
export type State={version:2;ruleset?:string;tt2?:TT2State;stage:number;best:number;kills:number;hp:number;gold:number;level:number;heroes:number[];relics:number;artifacts:number[];prestiges:number;taps:number;totalKills:number;cooldowns:number[];active:number[];bossEnd:number;farming:boolean;last:number;lastTap:number;lastFairy:number;diamonds:number;weapons:number[];evolutions:number[];wounded:number[];skillLevels:number[];gear:Gear[];equipped:number[];dust:number;lootCounter:number;bossKills:number;bossWounded:boolean;protection:number;seen:number[];achievements:number[];daily:{day:number;claimed:number[];taps:number;kills:number;upgrades:number;skills:number;fairies:number;login:boolean;dungeons:number[]};loginDay:number;streak:number;trial:Trial|null;weekly:{week:number;best:number;claimed:number[]};world:number;worldBest:number[];artifactSpent:number[];log:string[]};
export type Action={type:typeof ACTION_TYPES[number];index?:number;amount?:number;at:number};
const CAP=1e240;
const limit=(n:number)=>Math.min(CAP,Math.max(0,Number.isFinite(n)?n:CAP));
export const dayAt=(time:number)=>Math.floor(time/86400000);
export const weekAt=(time:number)=>Math.floor((dayAt(time)+3)/7);
function newDaily(day:number):State['daily']{return {day,claimed:[],taps:0,kills:0,upgrades:0,skills:0,fairies:0,login:false,dungeons:[]};}
export function fresh(now=Date.now()):State {return {version:2,ruleset:TT2_RULESET,tt2:freshTT2(now),stage:1,best:1,kills:0,hp:18,gold:0,level:1,heroes:Array(33).fill(0),relics:0,artifacts:ARTIFACTS.map(()=>0),prestiges:0,taps:0,totalKills:0,cooldowns:SKILLS.map(()=>0),active:SKILLS.map(()=>0),bossEnd:0,farming:false,last:now,lastTap:0,lastFairy:now,diamonds:0,weapons:Array(33).fill(0),evolutions:Array(33).fill(0),wounded:Array(33).fill(0),skillLevels:SKILLS.map(()=>0),gear:[],equipped:[-1,-1,-1,-1,-1],dust:0,lootCounter:0,bossKills:0,bossWounded:false,protection:0,seen:[0],achievements:[],daily:newDaily(dayAt(now)),loginDay:-1,streak:0,trial:null,weekly:{week:weekAt(now),best:0,claimed:[]},world:0,worldBest:[1,1],artifactSpent:ARTIFACTS.map(()=>0),log:[]};}
export function hydrate(s:State):State{// A save already on this ruleset is repaired, never re-migrated: the legacy path refunds artifacts
// and clears skill levels, so falling through with a missing tt2 block would wipe live progress.
if(s.ruleset===TT2_RULESET){s.tt2??=freshTT2(s.last??Date.now());if(!s.tt2.inventory)s.tt2={...freshTT2(s.last),...s.tt2};s.tt2.perkEnds??=[[],[]];s.tt2.rainLast??=s.last;s.tt2.petCharge??=0;s.tt2.petAttacks??=0;s.tt2.lastPetHit??=0;return s;}const base=fresh(s.last||Date.now());const original={...s};Object.assign(s,base,original,{version:2});for(const key of ['heroes','weapons','evolutions','wounded','artifacts','artifactSpent','skillLevels'] as const){const length=key==='artifacts'||key==='artifactSpent'?30:key==='skillLevels'?6:33;const old=original[key]||[];s[key]=Array.from({length},(_,i)=>Number.isFinite(old[i])?old[i]:key==='skillLevels'?1:0);}if(!original.artifactSpent)s.artifactSpent=s.artifacts.map((n,i)=>i<3?n*n:0);s.worldBest[0]=s.best;s.tt2=freshTT2(s.last);s.ruleset=TT2_RULESET;
 s.tt2.legacyArtifacts=[...s.artifacts];s.tt2.legacySpent=[...s.artifactSpent];s.relics=limit(s.relics+s.artifactSpent.reduce((a,b)=>a+b,0));
 s.artifacts.fill(0);s.artifactSpent.fill(0);s.active.fill(0);s.cooldowns.fill(0);s.skillLevels.fill(0);s.trial=null;s.world=0;s.evolutions.fill(0);s.wounded.fill(0);s.kills=0;s.hp=health(s);s.bossEnd=0;
 s.tt2.earnedPoints=Math.max(0,Math.floor(s.best/50)-1);s.tt2.points=s.tt2.earnedPoints;
 note(s,'已切換點擊泰坦二代 7.5 規則：舊神器投入退回聖物，舊收藏保留在備份；技能與神器效果重新校正。');return s;}
export function note(s:State,message:string){s.log=[message,...s.log].slice(0,15);}
export function bonus(_s:State,_effect:Effect){return 0;}
export function gearBonus(_s:State,_slot:number){return 1;}
export function passive(_s:State,_kind:number){return 0;}
export function skillPower(s:State,i:number){return SKILL_DATA[i].amount[Math.max(0,s.skillLevels[i]-1)]*stateEffect(s,SKILL_DATA[i].effect)*stateEffect(s,'AllActiveSkillAmount');}
export function skillDuration(s:State,i:number){return SKILLS[i].duration+stateEffect(s,SKILL_DATA[i].id+'SkillDuration')+stateEffect(s,'AllActiveSkillDuration');}
export function skillCooldown(s:State,i:number){return SKILLS[i].cooldown*(1-Math.min(.9,stateEffect(s,'AllActiveSkillCooldownRate')));}
export function critMultiplier(s:State){return 10*stateEffect(s,'CritDamage');}
export function tapDamage(s:State){return buildDamage(s,'tap');}
export function weaponSets(s:State){return Math.min(...s.weapons,...s.tt2!.extraWeapons);}
export function heroDps(s:State,i:number){const n=heroLevel(s,i),kind=TT2_HEROES[i].kind as 'Melee'|'Ranged'|'Spell';const milestone=TT2_HERO_MILESTONES.findLast(m=>m.level<=n)?.[kind]||1;return limit(HEROES[i].power*n*1.035**Math.max(0,n-1)*milestone*(1+((i<33?s.weapons[i]:s.tt2!.extraWeapons[i-33])||0)*.5*stateEffect(s,'HelperWeaponBoost'))*stateEffect(s,kind+'HelperDamage')*stateEffect(s,TT2_HEROES[i].spatial));}
export function dps(s:State){return limit(rawHeroDps(s)*stateEffect(s,'AllHelperDamage')*artifactAllDamage(s.tt2!)*stateEffect(s,'AllDamage')*(s.active[2]>s.last?skillPower(s,2):1)*gearBonus(s,1));}
export function monsterIndex(s:State){return s.trial?(s.trial.wave*7+s.trial.tier*12)%60:((s.stage-1)*6+s.kills)%60;}
export function monsterCount(_s:State){return 10;}
export function bossDuration(s:State){return 30+stateEffect(s,'BossTimerDuration');}
export function health(s:State){return limit(18*1.32**(s.stage-1)*(isBoss(s)?[2,3,4,5,8][(s.stage-1)%5]:1)*(1-Math.min(.9,stateEffect(s,'MonsterHP'))));}
export function isBoss(s:State){return !s.trial&&!s.farming&&s.kills>=monsterCount(s);}
export function reward(s:State){return goldReward(s,'monster');}
export function cost(s:State,index=-1,amount=1){
 if(index<0)return limit(playerUpgradeCost(s.level,amount)*['SwordMasterUpgradeCost','AllUpgradeCost','AllUpgradeCostFairy'].reduce((n,id)=>n*Math.max(0,1-stateEffect(s,id)),1));
 const n=heroLevel(s,index),rate=1.075;
 return Math.ceil(limit(HEROES[index].base*rate**n*(rate**amount-1)/(rate-1)*(1-Math.min(.9,stateEffect(s,'AllUpgradeCost')))*(1-Math.min(.9,stateEffect(s,'HelperUpgradeCost')))));
}
export function relicGain(s:State){return s.best>=60?Math.max(1,Math.floor(s.stage**1.7/100*stateEffect(s,'PrestigeRelic'))):0;}
export function artifactCost(s:State,i:number){return s.tt2!.artifacts[i]?upgradeArtifactCost(s.tt2!,i):discoveryCost(s.tt2!);}
export function evolveCost(s:State,i:number){return limit(HEROES[i].base*1e4**s.evolutions[i]*1e6);}
export function skillCost(s:State,i:number){return SKILL_DATA[i].cost[Math.min(34,s.skillLevels[i])];}
export function achievementProgress(s:State,i:number){const a=ACHIEVEMENTS[i];if(!a)return 0;if(a.metric==='hired')return s.heroes.filter((n,j)=>n>0||s.evolutions[j]>0).length;if(a.metric==='artifacts')return s.artifacts.filter(n=>n>0).length;return s[a.metric as 'taps'|'totalKills'|'best'|'prestiges'];}
function spawn(s:State){s.hp=health(s);s.bossEnd=isBoss(s)?s.last+bossDuration(s)*1000:0;s.bossWounded=false;const id=monsterIndex(s);if(!s.seen.includes(id))s.seen.push(id);}
function damage(s:State,amount:number){if(!Number.isFinite(amount)||amount<=0)return;s.hp-=amount;if(s.hp>0)return;
 const boss=isBoss(s),chest=!boss&&tt2Random(s.tt2!)<Math.min(1,.02+stateEffect(s,'ChestChance'));
 s.gold=limit(s.gold+goldReward(s,boss?'boss':chest?'chest':'monster'));s.totalKills++;s.daily.kills++;
 if(boss){if(s.stage>=16&&(s.stage-16)%20===0&&s.stage> s.tt2!.gearMilestone&&dropGear(s.tt2!,s.best))s.tt2!.gearMilestone=s.stage;s.bossKills++;s.stage=Math.min(1800,s.stage+1);s.best=Math.max(s.best,s.stage);s.kills=0;
  const points=Math.max(0,Math.floor(s.best/50)-1);if(points>s.tt2!.earnedPoints){s.tt2!.points+=points-s.tt2!.earnedPoints;s.tt2!.earnedPoints=points;}
 }else if(!s.farming)s.kills++;
 spawn(s);
}
export function advance(s:State,to:number){hydrate(s);if(!Number.isFinite(to))return s;to=Math.max(s.last,to);const gap=to-s.last;advanceEggs(s.tt2!,to);
 if(dayAt(to)>s.daily.day)s.daily={...s.daily,day:dayAt(to),claimed:[],taps:0,kills:0,upgrades:0,skills:0,fairies:0,login:false,dungeons:[]};
 if(gap>30000){const seconds=Math.min(gap/1000,8*3600);s.tt2!.mana=Math.min(manaMax(s),s.tt2!.mana+baseManaRegen(s)*manaSeconds(s.tt2!,s.last,s.last+seconds*1000));const offline={...s,last:to,active:Array(6).fill(0)};s.gold=limit(s.gold+Math.min(dps(offline)/Math.max(1,health({...offline,farming:true})),2)*reward(offline)*seconds*.5);s.last=to;s.active.fill(0);if(isBoss(s)){s.farming=true;s.kills=0;spawn(s);}return s;}
 while(s.last<to){const boundary=(Math.floor(s.last/100)+1)*100;const step=Math.min(boundary-s.last,to-s.last);s.last+=step;s.tt2!.mana=Math.min(manaMax(s),s.tt2!.mana+baseManaRegen(s)*manaSeconds(s.tt2!,s.last-step,s.last));
 if(isBoss(s)&&s.bossEnd&&s.last>=s.bossEnd){s.farming=true;s.kills=0;spawn(s);note(s,'頭目時間結束，切換金幣農場。');}
 if(s.last===boundary)autoBuyHeroes(s);
 if(s.last===boundary)damage(s,(dps(s)+(s.active[0]>s.last?buildDamage(s,'clone'):0))*.1);
 }return s;
}
export function apply(s:State,a:Action){advance(s,a.at);const i=a.index??0,t=s.tt2!;
 if(a.type==='resourcePerk'&&Number.isInteger(i)&&RESOURCE_PERKS[i]){
  const token=a.amount===1,price=RESOURCE_PERKS[i].cost;
  if((token?t.perkTokens>0:s.diamonds>=price)&&activatePerk(t,i,s.last)){if(token)t.perkTokens--;else s.diamonds-=price;if(i===0)t.mana=manaMax(s);if(i===1){t.rainLast=s.last;buyAffordableHeroes(s);}note(s,`已使用${RESOURCE_PERKS[i].name}，每層持續十二小時。`);}
 }
 if(a.type==='tap'&&s.last-s.lastTap>=45){s.lastTap=s.last;s.taps++;s.daily.taps++;t.lastCrit=tt2Random(t)<critChance(s);let n=tapDamage(s)*(t.lastCrit?10:1);if(s.active[1]>s.last&&tt2Random(t)<SKILL_DATA[1].second[s.skillLevels[1]-1])n*=skillPower(s,1);t.lastHit=n;damage(s,n);if(chargePet(t)){t.lastPetHit=petAttackDamage(s);t.petAttacks++;damage(s,t.lastPetHit);}}
 if(a.type==='upgrade'||a.type==='hero'){const id=a.type==='upgrade'?-1:i;if(id<-1||id>=HEROES.length||!Number.isInteger(id))return s;let count=a.amount??1;if(count===0){while(count<1000&&s.gold>=cost(s,id,count+1)&&(id<0?s.level:heroLevel(s,id))+count<2000)count++;}if(![1,10,25,100,1000,0].includes(a.amount??1)||!count)return s;const price=cost(s,id,count);if(s.gold>=price&&(id<0?s.level:heroLevel(s,id))+count<=2000){s.gold-=price;if(id<0)s.level+=count;else setHeroLevel(s,id,heroLevel(s,id)+count);}}
 if(a.type==='skill'&&Number.isInteger(i)&&i>=0&&i<6&&s.skillLevels[i]>0&&s.level>=SKILLS[i].level&&s.cooldowns[i]<=s.last&&t.mana>=skillMana(s,i)){
  t.mana-=skillMana(s,i);s.active[i]=s.last+skillDuration(s,i)*1000;s.cooldowns[i]=s.active[i]+skillCooldown(s,i)*1000;s.daily.skills++;
  if(i===5){damage(s,buildDamage(s,'heavenly'));s.active[i]=s.last;s.cooldowns[i]=s.last+skillCooldown(s,i)*1000;}
 }
 if(a.type==='skillUp'&&Number.isInteger(i)&&i>=0&&i<6&&s.level>=SKILLS[i].level&&s.skillLevels[i]<SKILL_DATA[i].max&&s.gold>=skillCost(s,i)){s.gold-=skillCost(s,i);s.skillLevels[i]++;}
 if(a.type==='discover'&&s.best>=60){const found=drawArtifact(t,s.relics);if(found){s.relics-=found.cost;note(s,`獲得神器：${TT2_ARTIFACTS[found.index].name}`);}}
 if(a.type==='artifact'&&Number.isInteger(i)&&i>=0&&i<103&&t.artifacts[i]>0){const price=artifactCost(s,i),max=TT2_ARTIFACTS[i].max||1e6;if(s.relics>=price&&t.artifacts[i]<max){s.relics-=price;t.spent[i]+=price;t.artifacts[i]++;}}
 if(a.type==='talent'&&Number.isInteger(i)&&i>=0&&i<TT2_TREE.length&&canBuyTalent(t,i,s.best)){t.points-=TT2_TREE[i].cost[t.tree[i]];t.tree[i]++;}
 if(a.type==='resetTalents'){t.points+=spentPoints(t);t.tree.fill(0);t.mana=Math.min(t.mana,manaMax(s));note(s,'技能點已返還。網頁版目前提供免費重配。');}
 if(a.type==='build'&&Number.isInteger(i)&&i>=0&&i<7)t.build=(['tap','pet','ship','clone','dagger','heavenly','goldGun'] as Build[])[i];
 if(a.type==='prestige'&&s.best>=60&&!s.trial){const gain=relicGain(s),reset=fresh(s.last);for(const key of ['best','prestiges','taps','totalKills','diamonds','weapons','gear','equipped','dust','lootCounter','bossKills','seen','achievements','daily','loginDay','streak','weekly','worldBest','log'] as const)Object.assign(reset,{[key]:structuredClone(s[key])});reset.tt2=structuredClone(t);reset.tt2.extraHeroes.fill(0);reset.tt2.petCharge=0;reset.tt2.lastPetHit=0;reset.tt2.mana=manaMax(reset);reset.prestiges++;reset.relics=s.relics+gain;reset.hp=health(reset);note(reset,`蛻變完成，獲得 ${gain} 聖物。`);return reset;}
 if(a.type==='boss'&&s.farming){s.farming=false;s.kills=monsterCount(s);spawn(s);}
 if(a.type==='fairy'&&s.last-s.lastFairy>=60000){s.lastFairy=s.last;s.daily.fairies++;s.gold=limit(s.gold+goldReward(s,'fairy'));note(s,'已領取妖精金幣。');}
 if(a.type==='equip'){const item=t.inventory.find(g=>g.id===i);if(item)t.equipped[TT2_GEAR[item.definition].slot]=i;}
 if(a.type==='petEquip'&&Number.isInteger(i)&&TT2_PETS[i]&&t.petLevels[i]>0)t.activePets[TT2_PETS[i].slot==='Damage'?0:1]=i;
 if(a.type==='egg'&&t.eggs>0){const pet=awardPet(t,s.best);if(pet>=0){t.eggs--;note(s,`獲得 ${PET_NAMES[TT2_PETS[pet].name]}，目前等級 ${t.petLevels[pet]}。`);}}
 if(a.type==='craft'&&Number.isInteger(i)&&craftSet(t,i,s.best))note(s,'製作完成；集齊五個部位後保留套裝效果。');
 if(a.type==='gearDiscard'&&Number.isInteger(i)&&!t.equipped.includes(i))t.inventory=t.inventory.filter(g=>g.id!==i);
 if(a.type==='daily'&&t.loginAt!==dayAt(s.last)){
  const reward=TT2_DAILY[t.loginIndex%TT2_DAILY.length];
  if(reward.reward==='Equipment'&&t.inventory.length+reward.amount>100)return s;
  t.loginAt=dayAt(s.last);t.loginIndex++;t.eventCurrency+=reward.event;
  if(reward.reward==='MonsterGold')s.gold=limit(s.gold+goldReward(s,'monster')*reward.amount);
  if(reward.reward==='Diamonds')s.diamonds+=reward.amount;
  if(reward.reward==='Equipment')for(let n=0;n<reward.amount;n++)dropGear(t,s.best);
  if(reward.reward==='Pet')for(let n=0;n<reward.amount;n++)awardPet(t,s.best);
  if(reward.reward==='EquipmentShards')t.shards+=reward.amount;
  if(reward.reward==='SkillPoint')t.points+=reward.amount;
  if(reward.reward==='Perk')t.perkTokens+=reward.amount;
  if(reward.reward==='HelperWeapon')for(let n=0;n<reward.amount;n++){const j=Math.floor(tt2Random(t)*37);if(j<33)s.weapons[j]++;else t.extraWeapons[j-33]++;}
  note(s,`已領取第 ${(t.loginIndex-1)%14+1} 天獎勵。`);
 }
 // Old daily quests, random forging, weekly solo trials, death and world switching
 // remain archived rather than paying invented rewards in the TT2 economy.
 return s;
}
export function fmt(n:number){if(n<10000)return Math.floor(n).toLocaleString('zh-TW');const units=['','萬','億','兆','京','垓','秭','穰','溝','澗','正','載'];const e=Math.floor(Math.log10(Math.max(1,n))/4);return e<units.length?(n/10**(4*e)).toFixed(1)+units[e]:`${(n/10**Math.floor(Math.log10(n))).toFixed(1)}×10^${Math.floor(Math.log10(n))}`;}

export function heroLevel(s:State,i:number){return i<33?s.heroes[i]:s.tt2!.extraHeroes[i-33];}
function setHeroLevel(s:State,i:number,n:number){if(i<33)s.heroes[i]=n;else s.tt2!.extraHeroes[i-33]=n;}
function rawHeroDps(s:State){return limit(HEROES.reduce((n,_,i)=>n+heroDps(s,i),0));}
export function manaMax(s:State){return 200+stateEffect(s,'ManaPoolCap');}
// Two clamped effects multiplied together still overflow, so the composed regen is clamped again.
function baseManaRegen(s:State){return limit((2+stateEffect(s,'ManaRegen'))/60*stateEffect(s,'ManaRegenMult'));}
export function manaRegen(s:State){return limit(baseManaRegen(s)*perkValue(s.tt2!,0,s.last));}
export function skillMana(s:State,i:number){return Math.max(0,SKILL_DATA[i].mana[Math.max(0,s.skillLevels[i]-1)]-stateEffect(s,SKILL_DATA[i].id+'SkillMana'));}
export function critChance(s:State){return Math.min(1,.02+stateEffect(s,'CritChance'));}
export function buildDamage(s:State,build:Build){const t=s.tt2!,active=s.active.filter(n=>n>s.last).length,c={tap:0,pet:.5,ship:1,clone:.5,dagger:.5,heavenly:.5,goldGun:.9}[build];
 // The intrinsic Sword Master curve is native-verified. Other build models
 // still use the existing reduction coefficients pending full reconstruction.
 const tapCoefficient={tap:1,pet:1,ship:0,clone:.6,dagger:1,heavenly:1,goldGun:.45}[build];
 let base=swordMasterBaseDamage(s)**tapCoefficient;
 if(c)base*=Math.max(1,rawHeroDps(s))**c;
 let n=base*buildMultiplier(t,build,active,isBoss(s),id=>stateEffect(s,id))*gearBonus(s,0);
 if(s.active[3]>s.last)n*=skillPower(s,3)**({tap:1,pet:1,ship:0,clone:.6,dagger:1,heavenly:1,goldGun:.45}[build]);
 if(s.active[2]>s.last)n*=skillPower(s,2)**c;
 if(build==='clone')n*=SKILL_DATA[0].amount[s.skillLevels[0]-1];
 if(build==='heavenly')n*=SKILL_DATA[5].amount[s.skillLevels[5]-1];
 return limit(n);
}
export function goldReward(s:State,source:'monster'|'boss'|'fairy'|'chest'|'pet'|'multi'){
 const t=s.tt2!,running=Math.min(4,s.active.filter(n=>n>s.last).length);
 let n=5*1.27**(s.stage-1)*stateEffect(s,'GoldAll')*stateEffect(s,'JackpotGold')*stateEffect(s,'GoldPerRunningActiveSkill')**running*(1+stateEffect(s,'GoldPerOwnedCardLevel')*t.cards)*gearBonus(s,2);
 if(source==='boss'||source==='pet')n*=10*stateEffect(s,'GoldBoss');
 if(source==='chest'||source==='fairy'||source==='multi')n*=10*stateEffect(s,'ChestAmount');
 if(source==='fairy'||source==='pet')n*=stateEffect(s,'GoldSpecialty');
 if(source==='fairy')n*=stateEffect(s,'FairyGold');if(source==='pet')n*=stateEffect(s,'PetGoldQTEAmount');if(source==='multi')n*=stateEffect(s,'MultiMonstersGold');
 if(s.active[4]>s.last)n*=skillPower(s,4)**(['fairy','pet'].includes(source)?.7:1);
 return limit(n);
}

// Visit strongest heroes first, without recursive actions or overspending.
function buyAffordableHeroes(s:State){
 for(let i=HEROES.length-1;i>=0;i--){let low=0,high=2000-heroLevel(s,i);
  while(low<high){const middle=Math.ceil((low+high)/2);if(cost(s,i,middle)<=s.gold)low=middle;else high=middle-1;}
  if(low){s.gold=Math.max(0,s.gold-cost(s,i,low));setHeroLevel(s,i,heroLevel(s,i)+low);}
 }
}
function autoBuyHeroes(s:State){const interval=perkValue(s.tt2!,1,s.last);if(interval&&s.last-s.tt2!.rainLast>=interval*1000){s.tt2!.rainLast=s.last;buyAffordableHeroes(s);}}

export function petAttackDamage(s:State){return limit(buildDamage(s,'pet')*petDamageFactor(s.tt2!));}

// Derived only; no duplicated levels or passive multipliers enter cloud saves.
const heroPassiveCache=new WeakMap<State,{signature:string;totals:Record<string,number>}>();
export function stateEffect(s:State,target:string){
 const levels=[...s.heroes,...s.tt2!.extraHeroes],boost=heroPowerBoost(s.tt2!),signature=levels.join(',')+'|'+boost.multiplicative+'|'+boost.additive;
 let cached=heroPassiveCache.get(s);
 if(!cached||cached.signature!==signature){cached={signature,totals:heroPassiveTotals(levels,boost)};heroPassiveCache.set(s,cached);}
 const additive=bonusDefinitions[target]?.additive,base=effect(s.tt2!,target),hero=cached.totals[target]??(additive?0:1);
 // Both branches are clamped: an unbounded effect used to reach the save as Infinity through mana,
 // skill duration and cooldown, which then failed snapshot validation on every write.
 return limit(additive?base+hero:base*hero);
}

export function swordMasterBaseDamage(s:State){return limit(playerBaseDamage(s.level)*stateEffect(s,'SwordMasterDamage'));}
