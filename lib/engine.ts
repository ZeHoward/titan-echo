import {heroPassiveTotals,heroPowerBoost} from './tt2-hero-passives.ts';
import {type Big,type BigLike,ZERO,ONE,isBig,big,fromNumber,fromText,toNumber,add,subtract,multiply,power,pow,scale,compare,sum,max as bigMax,atLeastZero,ceil as bigCeil,ratio} from './big-number.ts';
import {STAGE_CAP,HERO_LEVEL_CAP,PLAYER_LEVEL_CAP} from './tt2-limits.ts';
import {TT2_ACHIEVEMENTS,TT2_DAILY_TASKS} from './tt2-achievements.ts';
import {TT2_TUTORIAL} from './tt2-tutorial.ts';
export {TT2_TUTORIAL} from './tt2-tutorial.ts';
export {TT2_ACHIEVEMENTS,TT2_DAILY_TASKS,ACHIEVEMENT_PANEL_TEXT} from './tt2-achievements.ts';
import {playerBaseDamage,playerUpgradeCost} from './tt2-player.ts';
import {chargePet,petDamageFactor} from './tt2-pet-combat.ts';
import {RESOURCE_PERKS,perkValue,activatePerk,manaSeconds} from './tt2-perks.ts';
import {HERO_NAMES,PET_NAMES} from './zh-tw.ts';
import {advanceEggs,awardPet,dropGear,craftSet} from './tt2-collection.ts';
import {TT2_PETS,TT2_GEAR,TT2_DAILY,TT2_HEROES,TT2_HERO_MILESTONES} from './tt2-data.ts';
import {freshTT2,TT2_RULESET,TT2_ARTIFACTS,TT2_ACTIVE,TT2_TREE,effect,artifactAllDamage,buildMultiplier,upgradeArtifactCost,discoveryCost,drawArtifact,canBuyTalent,spentPoints,tt2Random,bonusDefinitions, type TT2State, type Build} from './tt2-rules.ts';
export {TT2_ARTIFACTS,TT2_TREE,discoveryCost};
import { EXTRA_HEROES, ARTIFACTS, MONSTERS, PERKS, ACTION_TYPES, type Effect } from './content.ts';
export { ARTIFACTS, MONSTERS, PERKS, ACTION_TYPES } from './content.ts';
export const HEROES=TT2_HEROES.map(h=>({name:HERO_NAMES[h.name],title:h.kind,icon:'⚔️',base:h.base,power:h.power}));
// Save indices remain stable: clone, deadly, war cry, fire sword, midas, strike.
export const SKILL_DATA=[5,1,4,3,2,0].map(i=>TT2_ACTIVE[i]);
export const SKILL_ORDER=[5,1,4,3,2,0];
export const SKILLS=SKILL_DATA.map((k,i)=>({name:['影分身之術','致命爆擊','戰爭狂嚎','火焰之劍','點石成金','天堂聖擊'][i],icon:['👥','🎯','📯','🔥','✋','☄️'][i],desc:['持續造成影分身傷害','提高致命攻擊傷害及觸發機率','提高英雄傷害','提高點擊傷害','提高各金源收益','造成一擊天堂傷害'][i],level:k.unlock,cooldown:k.cooldown,duration:k.duration}));
export type Gear={id:number;slot:number;rarity:number;power:number;level:number};
export type Trial={kind:'dungeon'|'challenge';tier:number;wave:number;base:number;endAt:number;period:number};
export type State={version:2;ruleset?:string;tt2?:TT2State;stage:number;best:number;kills:number;hp:Big;gold:Big;level:number;heroes:number[];relics:number;artifacts:number[];prestiges:number;taps:number;totalKills:number;cooldowns:number[];active:number[];bossEnd:number;farming:boolean;last:number;lastTap:number;lastFairy:number;diamonds:number;weapons:number[];evolutions:number[];wounded:number[];skillLevels:number[];gear:Gear[];equipped:number[];dust:number;lootCounter:number;bossKills:number;bossWounded:boolean;protection:number;seen:number[];achievements:Record<string,number>;daily:{day:number;claimed:string[];taps:number;kills:number;upgrades:number;skills:number;fairies:number;login:boolean;dungeons:number[];petLevels:number;equipment:number;prestiges:number};loginDay:number;streak:number;trial:Trial|null;weekly:{week:number;best:number;claimed:number[]};world:number;worldBest:number[];artifactSpent:number[];log:string[]};
export type Action={type:typeof ACTION_TYPES[number];index?:number;amount?:number;at:number};
// Multipliers stay plain numbers and keep this ceiling; the stage-driven magnitudes (health,
// damage, gold, costs) no longer do, so a value's size is bounded by its factors, not by 1e240.
const CAP=1e240;
const limit=(n:number)=>Math.min(CAP,Math.max(0,Number.isFinite(n)?n:CAP));
// A save written before 2.8 holds these as plain numbers; anything unusable reads as zero.
export const toAmount=(value:unknown):Big=>isBig(value)?big(value)
 :typeof value==='number'&&Number.isFinite(value)?fromNumber(Math.max(0,value)):{...ZERO};
export const dayAt=(time:number)=>Math.floor(time/86400000);
export const weekAt=(time:number)=>Math.floor((dayAt(time)+3)/7);
function newDaily(day:number):State['daily']{return {day,claimed:[],taps:0,kills:0,upgrades:0,skills:0,fairies:0,login:false,dungeons:[],petLevels:0,equipment:0,prestiges:0};}
export function fresh(now=Date.now()):State {return {version:2,ruleset:TT2_RULESET,tt2:freshTT2(now),stage:1,best:1,kills:0,hp:fromNumber(18),gold:{...ZERO},level:1,heroes:Array(33).fill(0),relics:0,artifacts:ARTIFACTS.map(()=>0),prestiges:0,taps:0,totalKills:0,cooldowns:SKILLS.map(()=>0),active:SKILLS.map(()=>0),bossEnd:0,farming:false,last:now,lastTap:0,lastFairy:now,diamonds:0,weapons:Array(33).fill(0),evolutions:Array(33).fill(0),wounded:Array(33).fill(0),skillLevels:SKILLS.map(()=>0),gear:[],equipped:[-1,-1,-1,-1,-1],dust:0,lootCounter:0,bossKills:0,bossWounded:false,protection:0,seen:[0],achievements:{},daily:newDaily(dayAt(now)),loginDay:-1,streak:0,trial:null,weekly:{week:weekAt(now),best:0,claimed:[]},world:0,worldBest:[1,1],artifactSpent:ARTIFACTS.map(()=>0),log:[]};}
export function hydrate(s:State):State{// A save already on this ruleset is repaired, never re-migrated: the legacy path refunds artifacts
// and clears skill levels, so falling through with a missing tt2 block would wipe live progress.
if(s.ruleset===TT2_RULESET){s.tt2??=freshTT2(s.last??Date.now());normaliseAmounts(s);if(!s.tt2.inventory)s.tt2={...freshTT2(s.last),...s.tt2};s.tt2.perkEnds??=[[],[]];s.tt2.rainLast??=s.last;s.tt2.petCharge??=0;s.tt2.petAttacks??=0;return s;}const base=fresh(s.last||Date.now());const original={...s};Object.assign(s,base,original,{version:2});for(const key of ['heroes','weapons','evolutions','wounded','artifacts','artifactSpent','skillLevels'] as const){const length=key==='artifacts'||key==='artifactSpent'?30:key==='skillLevels'?6:33;const old=original[key]||[];s[key]=Array.from({length},(_,i)=>Number.isFinite(old[i])?old[i]:key==='skillLevels'?1:0);}if(!original.artifactSpent)s.artifactSpent=s.artifacts.map((n,i)=>i<3?n*n:0);s.worldBest[0]=s.best;s.tt2=freshTT2(s.last);s.ruleset=TT2_RULESET;
 normaliseAmounts(s);
 s.tt2.legacyArtifacts=[...s.artifacts];s.tt2.legacySpent=[...s.artifactSpent];s.relics=limit(s.relics+s.artifactSpent.reduce((a,b)=>a+b,0));
 s.artifacts.fill(0);s.artifactSpent.fill(0);s.active.fill(0);s.cooldowns.fill(0);s.skillLevels.fill(0);s.trial=null;s.world=0;s.evolutions.fill(0);s.wounded.fill(0);s.kills=0;s.hp=health(s);s.bossEnd=0;
 s.tt2.earnedPoints=Math.max(0,Math.floor(s.best/50)-1);s.tt2.points=s.tt2.earnedPoints;
 note(s,'已切換點擊泰坦二代 7.5 規則：舊神器投入退回聖物，舊收藏保留在備份；技能與神器效果重新校正。');return s;}
// Amounts are the only saved fields whose representation changed; everything else is untouched.
// Fields added after a save was written: repaired in place, never re-migrated.
function normaliseTallies(s:State){
 const t=s.tt2;if(!t)return;
 t.goldCollected=toAmount(t.goldCollected);
 for(const key of ['chestKills','fairyRewards','heavenlyStrikes','crits','equipmentCollected','relicsCollected','perksUsed','tutorialStep','tutorialTaps'] as const){
  if(!Number.isFinite(t[key]))t[key]=0;
 }
 // Claimed tiers used to be positions in a list this project invented, which was never claimable
 // and never written to. Anything an older build left there names nothing, so it is dropped.
 if(!s.achievements||Array.isArray(s.achievements))s.achievements={};
 // Daily claims used to be positions in a list this project invented; they are now type names.
 s.daily.claimed=(s.daily.claimed??[]).filter(name=>typeof name==='string');
 for(const key of ['petLevels','equipment','prestiges'] as const){
  if(!Number.isFinite(s.daily[key]))s.daily[key]=0;
 }
}
function normaliseAmounts(s:State){
 // A snapshot that came back from Sheets carries goldAmount beside the saturated number.
 const wire=s as State&{goldAmount?:unknown};
 s.gold=toAmount(wire.goldAmount??s.gold);delete wire.goldAmount;
 normaliseTallies(s);
 s.hp=toAmount(s.hp);
 if(s.tt2){s.tt2.lastHit=toAmount(s.tt2.lastHit);s.tt2.lastPetHit=toAmount(s.tt2.lastPetHit);}
}
function earnGold(s:State,gain:Big){s.gold=add(s.gold,gain);s.tt2!.goldCollected=add(s.tt2!.goldCollected,gain);}
export function note(s:State,message:string){s.log=[message,...s.log].slice(0,15);}
export function bonus(_s:State,_effect:Effect){return 0;}
export function gearBonus(_s:State,_slot:number){return 1;}
export function passive(_s:State,_kind:number){return 0;}
export function skillPower(s:State,i:number){return SKILL_DATA[i].amount[Math.max(0,s.skillLevels[i]-1)]*stateEffect(s,SKILL_DATA[i].effect)*stateEffect(s,'AllActiveSkillAmount');}
export function skillDuration(s:State,i:number){return SKILLS[i].duration+stateEffect(s,SKILL_DATA[i].id+'SkillDuration')+stateEffect(s,'AllActiveSkillDuration');}
export function skillCooldown(s:State,i:number){return SKILLS[i].cooldown*(1-Math.min(.9,stateEffect(s,'AllActiveSkillCooldownRate')));}
export function critMultiplier(s:State){return 10*stateEffect(s,'CritDamage');}
export function tapDamage(s:State):Big{return buildDamage(s,'tap');}
export function weaponSets(s:State){return Math.min(...s.weapons,...s.tt2!.extraWeapons);}
export function heroDps(s:State,i:number):Big{const n=heroLevel(s,i),kind=TT2_HEROES[i].kind as 'Melee'|'Ranged'|'Spell';const milestone=TT2_HERO_MILESTONES.findLast(m=>m.level<=n)?.[kind]||1;
 if(n<=0)return {...ZERO};
 // Each factor is finite on its own; multiplying them as numbers is what used to overflow.
 let value=scale(pow(1.035,Math.max(0,n-1)),HEROES[i].power*n);
 for(const factor of [milestone,1+((i<33?s.weapons[i]:s.tt2!.extraWeapons[i-33])||0)*.5*stateEffect(s,'HelperWeaponBoost'),stateEffect(s,kind+'HelperDamage'),stateEffect(s,TT2_HEROES[i].spatial)])value=scale(value,factor);
 return value;}
export function dps(s:State):Big{let value=rawHeroDps(s);
 for(const factor of [stateEffect(s,'AllHelperDamage'),artifactAllDamage(s.tt2!),stateEffect(s,'AllDamage'),s.active[2]>s.last?skillPower(s,2):1,gearBonus(s,1)])value=scale(value,factor);
 return value;}
export function monsterIndex(s:State){return s.trial?(s.trial.wave*7+s.trial.tier*12)%60:((s.stage-1)*6+s.kills)%60;}
export function monsterCount(_s:State){return 10;}
export function bossDuration(s:State){return 30+stateEffect(s,'BossTimerDuration');}
export function health(s:State):Big{return scale(pow(1.32,s.stage-1),18*(isBoss(s)?[2,3,4,5,8][(s.stage-1)%5]:1)*(1-Math.min(.9,stateEffect(s,'MonsterHP'))));}
export function isBoss(s:State){return !s.trial&&!s.farming&&s.kills>=monsterCount(s);}
export function reward(s:State):Big{return goldReward(s,'monster');}
export function cost(s:State,index=-1,count=1):Big{
 if(index<0)return scale(playerUpgradeCost(s.level,count),['SwordMasterUpgradeCost','AllUpgradeCost','AllUpgradeCostFairy'].reduce((n,id)=>n*Math.max(0,1-stateEffect(s,id)),1));
 const n=heroLevel(s,index),rate=1.075;
 // The geometric sum itself always fits a double; it is multiplying it by base, which already
 // reaches 1e240 for the last heroes, that used to overflow. So the run is applied first.
 const run=scale(pow(rate,n),(rate**count-1)/(rate-1));
 return bigCeil(scale(run,HEROES[index].base*(1-Math.min(.9,stateEffect(s,'AllUpgradeCost')))*(1-Math.min(.9,stateEffect(s,'HelperUpgradeCost')))));
}
export function relicGain(s:State){return s.best>=60?Math.max(1,Math.floor(s.stage**1.7/100*stateEffect(s,'PrestigeRelic'))):0;}
export function artifactCost(s:State,i:number){return s.tt2!.artifacts[i]?upgradeArtifactCost(s.tt2!,i):discoveryCost(s.tt2!);}
export function evolveCost(s:State,i:number):Big{return scale(pow(1e4,s.evolutions[i]),HEROES[i].base*1e6);}
export function skillCost(s:State,i:number){return SKILL_DATA[i].cost[Math.min(34,s.skillLevels[i])];}
// The two the engine cannot count honestly: neither system exists yet, so neither is claimable.
export const UNMEASURED_ACHIEVEMENTS:Record<string,string>={
 ParticipatedTournament:'錦標賽尚未實作，沒有可計數的參賽事件',
 Manny:'魔力瑪尼這個特殊敵人尚未實作',
};
// The five daily tasks whose event this engine does not raise, and the one the package itself
// switches off. Each is listed so the panel can say why rather than showing an empty bar.
export const UNMEASURED_DAILY_TASKS:Record<string,string>={
 WatchVideos:'網頁版沒有廣告影片',
 SoloRaidAttacks:'單人突襲尚未實作',
 DiamondFairies:'鑽石妖精尚未實作，目前的妖精只給金幣',
 PerkFairy:'增益妖精尚未實作',
 DailyEquipment:'「每日裝備」的來源在安裝包內沒有可判定的定義',
};
/** The reward currencies this project actually holds; the rest of the row is recorded, not paid. */
export const DAILY_TASK_PAID=['Diamonds','HolidayCurrency'] as const;
export function dailyTaskAvailable(index:number){
 const task=TT2_DAILY_TASKS[index];
 return !!task&&task.active&&!UNMEASURED_DAILY_TASKS[task.type];
}
export function dailyTaskProgress(s:State,index:number){
 const task=TT2_DAILY_TASKS[index];
 if(!dailyTaskAvailable(index))return 0;
 switch(task!.type){
  case 'PetLevels':return s.daily.petLevels;
  case 'CollectedEquipment':return s.daily.equipment;
  case 'ClickFairies':return s.daily.fairies;
  case 'Prestiges':return s.daily.prestiges;
  default:return 0;
 }
}
export function dailyTaskDone(s:State,index:number){
 const task=TT2_DAILY_TASKS[index];
 return dailyTaskAvailable(index)&&dailyTaskProgress(s,index)>=task!.requirement;
}
export function dailyTaskClaimed(s:State,index:number){
 return s.daily.claimed.includes(TT2_DAILY_TASKS[index]?.type);
}
// The tutorial reads the same four measures the package names, and the tap objective counts
// taps since the step began rather than lifetime taps (tutorial-evidence.json).
export function tutorialStep(s:State){const t=s.tt2!;return t.tutorialStep<TT2_TUTORIAL.length?TT2_TUTORIAL[t.tutorialStep]:null;}
export function tutorialProgress(s:State){
 const step=tutorialStep(s);if(!step)return 0;
 switch(step.objective){
  case 'TapCount':return s.tt2!.tutorialTaps;
  case 'SwordMasterLevel':return s.level;
  case 'ReachStage':return s.best;
  case 'UnlockHelperCount':return s.heroes.filter((n,i)=>n>0||s.evolutions[i]>0).length+s.tt2!.extraHeroes.filter(n=>n>0).length;
  default:return 0;
 }
}
export function tutorialMet(s:State){const step=tutorialStep(s);return !!step&&tutorialProgress(s)>=step.amount;}
export function tutorialText(s:State){
 const step=tutorialStep(s);if(!step)return '';
 return step.fills?step.text.replace('{0}',String(step.amount)):step.text;
}
/** Advance past every objective already met, paying each step's gold once. */
function advanceTutorial(s:State){
 const t=s.tt2!;
 for(let guard=0;guard<TT2_TUTORIAL.length&&tutorialMet(s);guard++){
  const step=TT2_TUTORIAL[t.tutorialStep];
  if(step.gold>0)earnGold(s,scale(goldReward(s,'monster'),step.gold));
  t.tutorialStep++;t.tutorialTaps=0;
 }
}
const ACHIEVEMENT_TIERS:Big[][]=TT2_ACHIEVEMENTS.map(a=>a.requirement.map(text=>fromText(text)));
const heroSum=(s:State)=>s.heroes.reduce((n,v)=>n+v,0)+s.tt2!.extraHeroes.reduce((n,v)=>n+v,0);
/** Lifetime progress for one achievement, in the same units as its requirement. */
export function achievementProgress(s:State,index:number):Big{
 const a=TT2_ACHIEVEMENTS[index],t=s.tt2!;
 if(!a||UNMEASURED_ACHIEVEMENTS[a.type])return {...ZERO};
 switch(a.type){
  case 'MonsterKill':return fromNumber(s.totalKills);
  case 'BossKill':return fromNumber(s.bossKills);
  case 'Chesterson':return fromNumber(t.chestKills);
  case 'CollectGold':return {...t.goldCollected};
  case 'ReachStage':return fromNumber(s.best);
  case 'CollectRelics':return fromNumber(t.relicsCollected);
  case 'OwnArtifacts':return fromNumber(t.artifacts.filter(n=>n>0).length);
  case 'HelperDPS':return dps(s);
  case 'TapCount':return fromNumber(s.taps);
  case 'PrestigeCount':return fromNumber(s.prestiges);
  case 'HelperLevels':return fromNumber(heroSum(s));
  case 'FairyCount':return fromNumber(t.fairyRewards);
  case 'CriticalCount':return fromNumber(t.crits);
  case 'JumpAttackCount':return fromNumber(t.heavenlyStrikes);
  case 'PetLevel':return fromNumber(t.petLevels.reduce((n,v)=>n+v,0));
  case 'EquipmentCollected':return fromNumber(t.equipmentCollected);
  case 'TotalSkillPoints':return fromNumber(t.earnedPoints);
  case 'UnlockHeroes':return fromNumber(s.heroes.filter((n,i)=>n>0||s.evolutions[i]>0).length+t.extraHeroes.filter(n=>n>0).length);
  case 'Weapons':return fromNumber(s.weapons.reduce((n,v)=>n+v,0)+t.extraWeapons.reduce((n,v)=>n+v,0));
  case 'Perk':return fromNumber(t.perksUsed);
  default:return {...ZERO};
 }
}
/** How many tiers the current progress has reached, 0 to five. */
export function achievementTier(s:State,index:number){
 const tiers=ACHIEVEMENT_TIERS[index];if(!tiers)return 0;
 const progress=achievementProgress(s,index);
 return tiers.filter(target=>compare(progress,target)>=0).length;
}
export function achievementClaimed(s:State,index:number){
 return s.achievements[TT2_ACHIEVEMENTS[index]?.type]??0;
}
/** Diamonds waiting to be collected for tiers already reached. */
export function achievementReward(s:State,index:number){
 const a=TT2_ACHIEVEMENTS[index];if(!a)return 0;
 return a.diamondReward.slice(achievementClaimed(s,index),achievementTier(s,index)).reduce((n,v)=>n+v,0);
}
function spawn(s:State){s.hp=health(s);s.bossEnd=isBoss(s)?s.last+bossDuration(s)*1000:0;s.bossWounded=false;const id=monsterIndex(s);if(!s.seen.includes(id))s.seen.push(id);}
function damage(s:State,hit:Big){if(compare(hit,{...ZERO})<=0)return;s.hp=subtract(s.hp,hit);if(compare(s.hp,{...ZERO})>0)return;
 const boss=isBoss(s),chest=!boss&&tt2Random(s.tt2!)<Math.min(1,.02+stateEffect(s,'ChestChance'));
 earnGold(s,goldReward(s,boss?'boss':chest?'chest':'monster'));if(chest)s.tt2!.chestKills++;s.totalKills++;s.daily.kills++;
 if(boss){if(s.stage>=16&&(s.stage-16)%20===0&&s.stage> s.tt2!.gearMilestone&&dropGear(s.tt2!,s.best)){s.tt2!.gearMilestone=s.stage;s.tt2!.equipmentCollected++;s.daily.equipment++;}s.bossKills++;s.stage=Math.min(STAGE_CAP,s.stage+1);s.best=Math.max(s.best,s.stage);s.kills=0;
  const points=Math.max(0,Math.floor(s.best/50)-1);if(points>s.tt2!.earnedPoints){s.tt2!.points+=points-s.tt2!.earnedPoints;s.tt2!.earnedPoints=points;}
 }else if(!s.farming)s.kills++;
 spawn(s);
}
export function advance(s:State,to:number){hydrate(s);if(!Number.isFinite(to))return s;to=Math.max(s.last,to);const gap=to-s.last;advanceEggs(s.tt2!,to);
 if(dayAt(to)>s.daily.day)s.daily=newDaily(dayAt(to));
 if(gap>30000){const seconds=Math.min(gap/1000,8*3600);s.tt2!.mana=Math.min(manaMax(s),s.tt2!.mana+baseManaRegen(s)*manaSeconds(s.tt2!,s.last,s.last+seconds*1000));const offline={...s,last:to,active:Array(6).fill(0)};earnGold(s,scale(reward(offline),Math.min(ratio(dps(offline),bigMax({...ONE},health({...offline,farming:true}))),2)*seconds*.5));s.last=to;s.active.fill(0);if(isBoss(s)){s.farming=true;s.kills=0;spawn(s);}return s;}
 while(s.last<to){const boundary=(Math.floor(s.last/100)+1)*100;const step=Math.min(boundary-s.last,to-s.last);s.last+=step;s.tt2!.mana=Math.min(manaMax(s),s.tt2!.mana+baseManaRegen(s)*manaSeconds(s.tt2!,s.last-step,s.last));
 if(isBoss(s)&&s.bossEnd&&s.last>=s.bossEnd){s.farming=true;s.kills=0;spawn(s);note(s,'頭目時間結束，切換金幣農場。');}
 if(s.last===boundary)autoBuyHeroes(s);
 if(s.last===boundary)damage(s,scale(add(dps(s),s.active[0]>s.last?buildDamage(s,'clone'):{...ZERO}),.1));
 }return s;
}
export function apply(s:State,a:Action){advance(s,a.at);const i=a.index??0,t=s.tt2!;
 if(a.type==='resourcePerk'&&Number.isInteger(i)&&RESOURCE_PERKS[i]){
  const token=a.amount===1,price=RESOURCE_PERKS[i].cost;
  if((token?t.perkTokens>0:s.diamonds>=price)&&activatePerk(t,i,s.last)){t.perksUsed++;if(token)t.perkTokens--;else s.diamonds-=price;if(i===0)t.mana=manaMax(s);if(i===1){t.rainLast=s.last;buyAffordableHeroes(s);}note(s,`已使用${RESOURCE_PERKS[i].name}，每層持續十二小時。`);}
 }
 if(a.type==='tap'&&s.last-s.lastTap>=45){s.lastTap=s.last;s.taps++;s.daily.taps++;t.tutorialTaps++;t.lastCrit=tt2Random(t)<critChance(s);if(t.lastCrit)t.crits++;let n=scale(tapDamage(s),t.lastCrit?10:1);if(s.active[1]>s.last&&tt2Random(t)<SKILL_DATA[1].second[s.skillLevels[1]-1])n=scale(n,skillPower(s,1));t.lastHit=n;damage(s,n);if(chargePet(t)){t.lastPetHit=petAttackDamage(s);t.petAttacks++;damage(s,t.lastPetHit);}}
 if(a.type==='upgrade'||a.type==='hero'){const id=a.type==='upgrade'?-1:i;if(id<-1||id>=HEROES.length||!Number.isInteger(id))return s;let count=a.amount??1;const cap=id<0?PLAYER_LEVEL_CAP:HERO_LEVEL_CAP;
  if(count===0){while(count<1000&&compare(s.gold,cost(s,id,count+1))>=0&&(id<0?s.level:heroLevel(s,id))+count<cap)count++;}if(![1,10,25,100,1000,0].includes(a.amount??1)||!count)return s;const price=cost(s,id,count);
  if(compare(s.gold,price)>=0&&(id<0?s.level:heroLevel(s,id))+count<=cap){s.gold=atLeastZero(subtract(s.gold,price));if(id<0)s.level+=count;else setHeroLevel(s,id,heroLevel(s,id)+count);}}
 if(a.type==='skill'&&Number.isInteger(i)&&i>=0&&i<6&&s.skillLevels[i]>0&&s.level>=SKILLS[i].level&&s.cooldowns[i]<=s.last&&t.mana>=skillMana(s,i)){
  t.mana-=skillMana(s,i);s.active[i]=s.last+skillDuration(s,i)*1000;s.cooldowns[i]=s.active[i]+skillCooldown(s,i)*1000;s.daily.skills++;
  if(i===5){t.heavenlyStrikes++;damage(s,buildDamage(s,'heavenly'));s.active[i]=s.last;s.cooldowns[i]=s.last+skillCooldown(s,i)*1000;}
 }
 if(a.type==='skillUp'&&Number.isInteger(i)&&i>=0&&i<6&&s.level>=SKILLS[i].level&&s.skillLevels[i]<SKILL_DATA[i].max&&compare(s.gold,fromNumber(skillCost(s,i)))>=0){s.gold=atLeastZero(subtract(s.gold,fromNumber(skillCost(s,i))));s.skillLevels[i]++;}
 if(a.type==='discover'&&s.best>=60){const found=drawArtifact(t,s.relics);if(found){s.relics-=found.cost;note(s,`獲得神器：${TT2_ARTIFACTS[found.index].name}`);}}
 if(a.type==='artifact'&&Number.isInteger(i)&&i>=0&&i<103&&t.artifacts[i]>0){const price=artifactCost(s,i),max=TT2_ARTIFACTS[i].max||1e6;if(s.relics>=price&&t.artifacts[i]<max){s.relics-=price;t.spent[i]+=price;t.artifacts[i]++;}}
 if(a.type==='talent'&&Number.isInteger(i)&&i>=0&&i<TT2_TREE.length&&canBuyTalent(t,i,s.best)){t.points-=TT2_TREE[i].cost[t.tree[i]];t.tree[i]++;}
 if(a.type==='resetTalents'){t.points+=spentPoints(t);t.tree.fill(0);t.mana=Math.min(t.mana,manaMax(s));note(s,'技能點已返還。網頁版目前提供免費重配。');}
 if(a.type==='build'&&Number.isInteger(i)&&i>=0&&i<7)t.build=(['tap','pet','ship','clone','dagger','heavenly','goldGun'] as Build[])[i];
 if(a.type==='prestige'&&s.best>=60&&!s.trial){const gain=relicGain(s),reset=fresh(s.last);for(const key of ['best','prestiges','taps','totalKills','diamonds','weapons','gear','equipped','dust','lootCounter','bossKills','seen','achievements','daily','loginDay','streak','weekly','worldBest','log'] as const)Object.assign(reset,{[key]:structuredClone(s[key])});reset.tt2=structuredClone(t);reset.tt2.extraHeroes.fill(0);reset.tt2.petCharge=0;reset.tt2.lastPetHit={...ZERO};reset.tt2.mana=manaMax(reset);reset.prestiges++;reset.relics=s.relics+gain;reset.tt2.relicsCollected=t.relicsCollected+gain;reset.daily.prestiges++;reset.hp=health(reset);note(reset,`蛻變完成，獲得 ${gain} 聖物。`);return reset;}
 if(a.type==='achievement'&&Number.isInteger(i)&&TT2_ACHIEVEMENTS[i]&&!UNMEASURED_ACHIEVEMENTS[TT2_ACHIEVEMENTS[i].type]){
  const tier=achievementTier(s,i),reward=achievementReward(s,i);
  if(reward>0){s.diamonds+=reward;s.achievements={...s.achievements,[TT2_ACHIEVEMENTS[i].type]:tier};
   note(s,`成就達成第 ${tier} 階，獲得 ${reward} 鑽石。`);}
 }
 if(a.type==='dailyTask'&&Number.isInteger(i)&&dailyTaskAvailable(i)&&dailyTaskDone(s,i)&&!dailyTaskClaimed(s,i)){
  const task=TT2_DAILY_TASKS[i];s.daily={...s.daily,claimed:[...s.daily.claimed,task.type]};
  for(const prize of task.rewards){
   if(prize.reward==='Diamonds')s.diamonds+=prize.amount;
   if(prize.reward==='HolidayCurrency')t.eventCurrency+=prize.amount;
  }
  note(s,`每日成就完成：${task.description.replace('{0}',String(task.requirement))}`);
 }
 if(a.type==='boss'&&s.farming){s.farming=false;s.kills=monsterCount(s);spawn(s);}
 if(a.type==='fairy'&&s.last-s.lastFairy>=60000){s.lastFairy=s.last;s.daily.fairies++;s.tt2!.fairyRewards++;earnGold(s,goldReward(s,'fairy'));note(s,'已領取妖精金幣。');}
 if(a.type==='equip'){const item=t.inventory.find(g=>g.id===i);if(item)t.equipped[TT2_GEAR[item.definition].slot]=i;}
 if(a.type==='petEquip'&&Number.isInteger(i)&&TT2_PETS[i]&&t.petLevels[i]>0)t.activePets[TT2_PETS[i].slot==='Damage'?0:1]=i;
 if(a.type==='egg'&&t.eggs>0){const before=t.petLevels.reduce((n,v)=>n+v,0);const pet=awardPet(t,s.best);if(pet>=0){t.eggs--;s.daily.petLevels+=Math.max(0,t.petLevels.reduce((n,v)=>n+v,0)-before);note(s,`獲得 ${PET_NAMES[TT2_PETS[pet].name]}，目前等級 ${t.petLevels[pet]}。`);}}
 if(a.type==='craft'&&Number.isInteger(i)&&craftSet(t,i,s.best))note(s,'製作完成；集齊五個部位後保留套裝效果。');
 if(a.type==='gearDiscard'&&Number.isInteger(i)&&!t.equipped.includes(i))t.inventory=t.inventory.filter(g=>g.id!==i);
 if(a.type==='daily'&&t.loginAt!==dayAt(s.last)){
  const reward=TT2_DAILY[t.loginIndex%TT2_DAILY.length];
  if(reward.reward==='Equipment'&&t.inventory.length+reward.amount>100)return s;
  t.loginAt=dayAt(s.last);t.loginIndex++;t.eventCurrency+=reward.event;
  if(reward.reward==='MonsterGold')earnGold(s,scale(goldReward(s,'monster'),reward.amount));
  if(reward.reward==='Diamonds')s.diamonds+=reward.amount;
  if(reward.reward==='Equipment')for(let n=0;n<reward.amount;n++)if(dropGear(t,s.best)){t.equipmentCollected++;s.daily.equipment++;}
  if(reward.reward==='Pet')for(let n=0;n<reward.amount;n++){const before=t.petLevels.reduce((x,v)=>x+v,0);awardPet(t,s.best);s.daily.petLevels+=Math.max(0,t.petLevels.reduce((x,v)=>x+v,0)-before);}
  if(reward.reward==='EquipmentShards')t.shards+=reward.amount;
  if(reward.reward==='SkillPoint')t.points+=reward.amount;
  if(reward.reward==='Perk')t.perkTokens+=reward.amount;
  if(reward.reward==='HelperWeapon')for(let n=0;n<reward.amount;n++){const j=Math.floor(tt2Random(t)*37);if(j<33)s.weapons[j]++;else t.extraWeapons[j-33]++;}
  note(s,`已領取第 ${(t.loginIndex-1)%14+1} 天獎勵。`);
 }
 advanceTutorial(s);
 // Old daily quests, random forging, weekly solo trials, death and world switching
 // remain archived rather than paying invented rewards in the TT2 economy.
 return s;
}
// A value that cannot be shown must never reach the screen as "NaN": show zero instead.
export function fmt(value:BigLike){
 const v=isBig(value)?big(value):fromNumber(Number.isFinite(value)?Math.max(0,value):value===Infinity?Number.MAX_VALUE:0);
 if(v.s<=0)return '0';
 if(v.e<4)return Math.floor(toNumber(v)).toLocaleString('zh-TW');
 const units=['','萬','億','兆','京','垓','秭','穰','溝','澗','正','載'];
 const step=Math.floor(v.e/4);
 return step<units.length?(v.s*10**(v.e-4*step)).toFixed(1)+units[step]:`${v.s.toFixed(1)}×10^${v.e}`;
}

export function heroLevel(s:State,i:number){return i<33?s.heroes[i]:s.tt2!.extraHeroes[i-33];}
function setHeroLevel(s:State,i:number,n:number){if(i<33)s.heroes[i]=n;else s.tt2!.extraHeroes[i-33]=n;}
function rawHeroDps(s:State):Big{return sum(HEROES.map((_,i)=>heroDps(s,i)));}
export function manaMax(s:State){return 200+stateEffect(s,'ManaPoolCap');}
// Two clamped effects multiplied together still overflow, so the composed regen is clamped again.
function baseManaRegen(s:State){return limit((2+stateEffect(s,'ManaRegen'))/60*stateEffect(s,'ManaRegenMult'));}
export function manaRegen(s:State){return limit(baseManaRegen(s)*perkValue(s.tt2!,0,s.last));}
export function skillMana(s:State,i:number){return Math.max(0,SKILL_DATA[i].mana[Math.max(0,s.skillLevels[i]-1)]-stateEffect(s,SKILL_DATA[i].id+'SkillMana'));}
export function critChance(s:State){return Math.min(1,.02+stateEffect(s,'CritChance'));}
export function buildDamage(s:State,build:Build):Big{const t=s.tt2!,active=s.active.filter(n=>n>s.last).length,c={tap:0,pet:.5,ship:1,clone:.5,dagger:.5,heavenly:.5,goldGun:.9}[build];
 // The intrinsic Sword Master curve is native-verified. Other build models
 // still use the existing reduction coefficients pending full reconstruction.
 const tapCoefficient={tap:1,pet:1,ship:0,clone:.6,dagger:1,heavenly:1,goldGun:.45}[build];
 let n=power(swordMasterBaseDamage(s),tapCoefficient);
 if(c)n=multiply(n,power(bigMax({...ONE},rawHeroDps(s)),c));
 n=scale(n,buildMultiplier(t,build,active,isBoss(s),id=>stateEffect(s,id))*gearBonus(s,0));
 if(s.active[3]>s.last)n=scale(n,skillPower(s,3)**({tap:1,pet:1,ship:0,clone:.6,dagger:1,heavenly:1,goldGun:.45}[build]));
 if(s.active[2]>s.last)n=scale(n,skillPower(s,2)**c);
 if(build==='clone')n=scale(n,SKILL_DATA[0].amount[s.skillLevels[0]-1]);
 if(build==='heavenly')n=scale(n,SKILL_DATA[5].amount[s.skillLevels[5]-1]);
 return n;
}
export function goldReward(s:State,source:'monster'|'boss'|'fairy'|'chest'|'pet'|'multi'):Big{
 const t=s.tt2!,running=Math.min(4,s.active.filter(n=>n>s.last).length);
 let n=scale(pow(1.27,s.stage-1),5);
 for(const factor of [stateEffect(s,'GoldAll'),stateEffect(s,'JackpotGold'),stateEffect(s,'GoldPerRunningActiveSkill')**running,1+stateEffect(s,'GoldPerOwnedCardLevel')*t.cards,gearBonus(s,2)])n=scale(n,factor);
 if(source==='boss'||source==='pet')n=scale(n,10*stateEffect(s,'GoldBoss'));
 if(source==='chest'||source==='fairy'||source==='multi')n=scale(n,10*stateEffect(s,'ChestAmount'));
 if(source==='fairy'||source==='pet')n=scale(n,stateEffect(s,'GoldSpecialty'));
 if(source==='fairy')n=scale(n,stateEffect(s,'FairyGold'));if(source==='pet')n=scale(n,stateEffect(s,'PetGoldQTEAmount'));if(source==='multi')n=scale(n,stateEffect(s,'MultiMonstersGold'));
 if(s.active[4]>s.last)n=scale(n,skillPower(s,4)**(['fairy','pet'].includes(source)?.7:1));
 return n;
}

// Visit strongest heroes first, without recursive actions or overspending.
function buyAffordableHeroes(s:State){
 for(let i=HEROES.length-1;i>=0;i--){let low=0,high=HERO_LEVEL_CAP-heroLevel(s,i);
  while(low<high){const middle=Math.ceil((low+high)/2);if(compare(cost(s,i,middle),s.gold)<=0)low=middle;else high=middle-1;}
  if(low){s.gold=atLeastZero(subtract(s.gold,cost(s,i,low)));setHeroLevel(s,i,heroLevel(s,i)+low);}
 }
}
function autoBuyHeroes(s:State){const interval=perkValue(s.tt2!,1,s.last);if(interval&&s.last-s.tt2!.rainLast>=interval*1000){s.tt2!.rainLast=s.last;buyAffordableHeroes(s);}}

export function petAttackDamage(s:State):Big{return scale(buildDamage(s,'pet'),petDamageFactor(s.tt2!));}

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

export function swordMasterBaseDamage(s:State):Big{return scale(playerBaseDamage(s.level),stateEffect(s,'SwordMasterDamage'));}
