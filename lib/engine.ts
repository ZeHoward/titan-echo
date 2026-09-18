import {heroPassiveTotals,heroPowerBoost} from './tt2-hero-passives.ts';
import {type Big,type BigLike,ZERO,ONE,isBig,big,fromNumber,fromText,toNumber,add,subtract,multiply,power,pow,scale,compare,sum,max as bigMax,atLeastZero,ceil as bigCeil,ratio} from './big-number.ts';
import {STAGE_CAP,HERO_LEVEL_CAP,PLAYER_LEVEL_CAP} from './tt2-limits.ts';
import {TT2_ACHIEVEMENTS,TT2_DAILY_TASKS} from './tt2-achievements.ts';
import {TT2_TUTORIAL} from './tt2-tutorial.ts';
export {TT2_TUTORIAL} from './tt2-tutorial.ts';
export {TT2_ACHIEVEMENTS,TT2_DAILY_TASKS,ACHIEVEMENT_PANEL_TEXT} from './tt2-achievements.ts';
import {playerBaseDamage,playerUpgradeCost} from './tt2-player.ts';
import {chargePet,petDamageFactor,activeCombatPet} from './tt2-pet-combat.ts';
import {RESOURCE_PERKS,perkValue,perkLevel,perkLimit,activatePerk,manaSeconds} from './tt2-perks.ts';
import {HERO_NAMES,PET_NAMES} from './zh-tw.ts';
import {advanceEggs,awardPet,dropGear,craftSet} from './tt2-collection.ts';
import {TT2_PETS,TT2_GEAR,TT2_DAILY,TT2_HEROES,TT2_HERO_MILESTONES} from './tt2-data.ts';
import {freshTT2,TT2_RULESET,TT2_ARTIFACTS,TT2_ACTIVE,TT2_TREE,effect,effectResolver,artifactAllDamage,buildMultiplier,upgradeArtifactCost,discoveryCost,drawArtifact,canBuyTalent,spentPoints,tt2Random,bonusDefinitions,TT2_QTE,QTE_TYPE,QTE_MIN_COOLDOWN,QTE_COOLDOWN_MULTIPLIERS,qteUnlocked,freshQTESlots, type TT2State, type Build} from './tt2-rules.ts';
export {TT2_ARTIFACTS,TT2_TREE,discoveryCost};
import { EXTRA_HEROES, ARTIFACTS, MONSTERS, PERKS, ACTION_TYPES, type Effect } from './content.ts';
import { bossSprite, pickMonsterSprite, spriteForMonster, stagePool } from './tt2-stages.ts';
import { SOURCE_NAMES } from './tt2-source-names.ts';
import { SKILL_TEXT } from './tt2-skill-text.ts';
export { ARTIFACTS, MONSTERS, PERKS, ACTION_TYPES } from './content.ts';
export const HEROES=TT2_HEROES.map(h=>({name:HERO_NAMES[h.name],title:h.kind,icon:'⚔️',base:h.base,power:h.power}));
// Save indices remain stable: clone, deadly, war cry, fire sword, midas, strike.
export const SKILL_DATA=[5,1,4,3,2,0].map(i=>TT2_ACTIVE[i]);
export const SKILL_ORDER=[5,1,4,3,2,0];
export const SKILLS=SKILL_DATA.map((k,i)=>({name:SOURCE_NAMES['ACTIVE_SKILL_NAME_'+k.id.toUpperCase()],icon:['👥','🎯','📯','🔥','✋','☄️'][i],desc:SKILL_TEXT[k.id]?.flavour??'',level:k.unlock,cooldown:k.cooldown,duration:k.duration}));
export type Gear={id:number;slot:number;rarity:number;power:number;level:number};
export type Trial={kind:'dungeon'|'challenge';tier:number;wave:number;base:number;endAt:number;period:number};
export type State={version:2;ruleset?:string;tt2?:TT2State;stage:number;best:number;kills:number;hp:Big;gold:Big;level:number;heroes:number[];relics:number;artifacts:number[];prestiges:number;taps:number;totalKills:number;cooldowns:number[];active:number[];bossEnd:number;farming:boolean;last:number;lastTap:number;lastFairy:number;diamonds:number;weapons:number[];evolutions:number[];wounded:number[];skillLevels:number[];gear:Gear[];equipped:number[];dust:number;lootCounter:number;bossKills:number;bossWounded:boolean;protection:number;seen:number[];monster?:number;achievements:Record<string,number>;daily:{day:number;claimed:string[];taps:number;kills:number;upgrades:number;skills:number;fairies:number;login:boolean;dungeons:number[];petLevels:number;equipment:number;prestiges:number};loginDay:number;streak:number;trial:Trial|null;weekly:{week:number;best:number;claimed:number[]};world:number;worldBest:number[];artifactSpent:number[];log:string[]};
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
export function fresh(now=Date.now()):State {return {version:2,ruleset:TT2_RULESET,tt2:freshTT2(now),stage:1,best:1,kills:0,hp:fromNumber(18),gold:{...ZERO},level:1,heroes:Array(33).fill(0),relics:0,artifacts:ARTIFACTS.map(()=>0),prestiges:0,taps:0,totalKills:0,cooldowns:SKILLS.map(()=>0),active:SKILLS.map(()=>0),bossEnd:0,farming:false,last:now,lastTap:0,lastFairy:now,diamonds:0,weapons:Array(33).fill(0),evolutions:Array(33).fill(0),wounded:Array(33).fill(0),skillLevels:SKILLS.map(()=>0),gear:[],equipped:[-1,-1,-1,-1,-1],dust:0,lootCounter:0,bossKills:0,bossWounded:false,protection:0,seen:[0],monster:spriteForMonster(stagePool(1)[0]),achievements:{},daily:newDaily(dayAt(now)),loginDay:-1,streak:0,trial:null,weekly:{week:weekAt(now),best:0,claimed:[]},world:0,worldBest:[1,1],artifactSpent:ARTIFACTS.map(()=>0),log:[]};}
export function hydrate(s:State):State{// A save already on this ruleset is repaired, never re-migrated: the legacy path refunds artifacts
// and clears skill levels, so falling through with a missing tt2 block would wipe live progress.
if(s.ruleset===TT2_RULESET){s.tt2??=freshTT2(s.last??Date.now());normaliseAmounts(s);s.monster??=settledMonster(s);const needsQTE=!s.tt2.qteReadyAt;if(!s.tt2.inventory)s.tt2={...freshTT2(s.last),...s.tt2};s.tt2.perkEnds??=[[],[]];s.tt2.rainLast??=s.last;s.tt2.petCharge??=0;s.tt2.petAttacks??=0;s.tt2.cloneAt??=s.last;if(needsQTE){s.tt2.qteReadyAt=freshQTESlots();s.tt2.qteExpireAt=freshQTESlots();migrateFairyQTE(s);}s.tt2.qteTaps??=0;clampLevels(s);return s;}
// Talent and skill levels index straight into their own tables. A save holding a level past the
// table's end reads undefined and every bonus built from it becomes NaN, so the levels are
// brought back into range on load rather than defended against at each of the dozen read sites.
function clampLevels(s:State){
 const t=s.tt2;if(!t)return;
 if(Array.isArray(t.tree))t.tree=t.tree.map((level,i)=>Math.min(Math.max(0,Number.isFinite(level)?level:0),TT2_TREE[i]?.max??0));
 // The cap is no longer fixed: AllActiveSkillCap raises it, so a save made while a set was
 // equipped must still load at the level it legitimately bought.
 s.skillLevels=s.skillLevels.map((level,i)=>Math.min(Math.max(0,Number.isFinite(level)?level:0),SKILL_DATA[i]?skillCap(s,i):0));
 // An artifact level does not index a table, but a level the upgrade path cannot reach still drives
 // its bonus into the engine ceiling, which then reads as "1e+240 秒" on a skill button. The cap is
 // the one apply() enforces when buying, so a save can only hold what play could have produced.
 if(Array.isArray(t.artifacts))t.artifacts=t.artifacts.map((level,i)=>
  Math.min(Math.max(0,Number.isFinite(level)?level:0),TT2_ARTIFACTS[i]?.max||1e6));
 // A skill timer written while a bonus was out of range can sit 10^240 seconds in the future, which
 // leaves the skill running for ever. Nothing legitimate lasts a day, so anything beyond that is an
 // artefact of a broken save and is treated as already over — clamping it to a day instead would
 // hand out a free day of the skill.
 const horizon=s.last+86400000;
 const settled=(at:number)=>Number.isFinite(at)&&at<=horizon?at:0;
 s.active=s.active.map(settled);
 s.cooldowns=s.cooldowns.map(settled);
}const base=fresh(s.last||Date.now());const original={...s};Object.assign(s,base,original,{version:2});for(const key of ['heroes','weapons','evolutions','wounded','artifacts','artifactSpent','skillLevels'] as const){const length=key==='artifacts'||key==='artifactSpent'?30:key==='skillLevels'?6:33;const old=original[key]||[];s[key]=Array.from({length},(_,i)=>Number.isFinite(old[i])?old[i]:key==='skillLevels'?1:0);}if(!original.artifactSpent)s.artifactSpent=s.artifacts.map((n,i)=>i<3?n*n:0);s.worldBest[0]=s.best;s.tt2=freshTT2(s.last);s.ruleset=TT2_RULESET;
 normaliseAmounts(s);
 s.tt2.legacyArtifacts=[...s.artifacts];s.tt2.legacySpent=[...s.artifactSpent];s.relics=limit(s.relics+s.artifactSpent.reduce((a,b)=>a+b,0));
 s.artifacts.fill(0);s.artifactSpent.fill(0);s.active.fill(0);s.cooldowns.fill(0);s.skillLevels.fill(0);s.trial=null;s.world=0;s.evolutions.fill(0);s.wounded.fill(0);s.kills=0;s.hp=health(s);s.bossEnd=0;
 s.tt2.earnedPoints=Math.max(0,Math.floor(s.best/50)-1);s.tt2.points=s.tt2.earnedPoints;
 s.monster=settledMonster(s);
 note(s,'已切換點擊泰坦二代 7.5 規則：舊神器投入退回聖物，舊收藏保留在備份；技能與神器效果重新校正。');return s;}
// Amounts are the only saved fields whose representation changed; everything else is untouched.
// Fields added after a save was written: repaired in place, never re-migrated.
function normaliseTallies(s:State){
 const t=s.tt2;if(!t)return;
 t.goldCollected=toAmount(t.goldCollected);
 for(const key of ['chestKills','bombKills','fairyRewards','heavenlyStrikes','crits','cloneAttacks','equipmentCollected','relicsCollected','perksUsed','tutorialStep','tutorialTaps'] as const){
  if(!Number.isFinite(t[key]))t[key]=0;
 }
 // 這一波的隻數是 2.16.0 才有的欄位，舊存檔沒有；沒有就是一隻，不是零隻。
 if(!Number.isFinite(t.multi)||t.multi<1)t.multi=1;
 // 連續登入天數是 2.20.0 才有的欄位。舊存檔沒有這個數字，但它們有 loginAt——
 // 上次領取如果就在昨天或今天，至少算一天，否則從零算起。
 if(!Number.isFinite(t.loginStreak)||t.loginStreak<0){
  const today=dayAt(s.last);
  t.loginStreak=t.loginAt===today||t.loginAt===today-1?1:0;
 }else t.loginStreak=Math.trunc(t.loginStreak);
 // 寶箱效果剩幾關是 2.18.0 才有的欄位。
 if(!Number.isFinite(t.chestStages)||t.chestStages<0)t.chestStages=0;
 else t.chestStages=Math.trunc(t.chestStages);
 // 炸彈泰坦的堆疊是 2.17.0 才有的：沒有就是沒有堆疊，而且只留得下正整數關數。
 t.bombStacks=(Array.isArray(t.bombStacks)?t.bombStacks:[])
  .filter(n=>Number.isFinite(n)&&n>=1).map(n=>Math.trunc(n));
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
 if(s.tt2){s.tt2.lastHit=toAmount(s.tt2.lastHit);s.tt2.lastPetHit=toAmount(s.tt2.lastPetHit);s.tt2.lastCloneHit=toAmount(s.tt2.lastCloneHit);}
}
function earnGold(s:State,gain:Big){s.gold=add(s.gold,gain);s.tt2!.goldCollected=add(s.tt2!.goldCollected,gain);}
export function note(s:State,message:string){s.log=[message,...s.log].slice(0,15);}
export function bonus(_s:State,_effect:Effect){return 0;}
export function gearBonus(_s:State,_slot:number){return 1;}
export function passive(_s:State,_kind:number){return 0;}
// A skill's tables stop at its max level; a save past that would read undefined and poison every
// number downstream, so every lookup is clamped to the table it is reading.
export function skillStep(i:number,level:number){return Math.min(Math.max(0,level-1),SKILL_DATA[i].amount.length-1);}
export function skillPower(s:State,i:number){return SKILL_DATA[i].amount[skillStep(i,s.skillLevels[i])]*stateEffect(s,SKILL_DATA[i].effect)*stateEffect(s,'AllActiveSkillAmount');}
// A bonus id that is not in the table falls through to the multiplicative neutral value 1, which
// is silently wrong when the caller is adding seconds or mana rather than scaling. Not every skill
// has every bonus - natively there is no BurstDamageSkillDuration, because the heavenly strike is
// instant - so these two add only the bonuses that exist. Without this the strike lasted 3+1 = 4s.
const skillBonus=(s:State,id:string)=>id in bonusDefinitions?stateEffect(s,id):0;
// Native SkillParsedInfo.GetDuration builds two sums and multiplies them: seconds start at 0 and
// collect this skill's SkillDuration plus AllActiveSkillDuration, the multiplier starts at 1 and
// collects this skill's SkillDurationMult plus AllActiveSkillDurationMult, then
// (duration + seconds) x multiplier. Both Mult bonuses are additive, so with no source the second
// sum stays at 1 and the duration is unchanged.
export function skillDuration(s:State,i:number){
 const seconds=SKILLS[i].duration+skillBonus(s,SKILL_DATA[i].id+'SkillDuration')+stateEffect(s,'AllActiveSkillDuration');
 return seconds*(1+skillBonus(s,SKILL_DATA[i].id+'SkillDurationMult')+stateEffect(s,'AllActiveSkillDurationMult'));
}
export function skillCooldown(s:State,i:number){return SKILLS[i].cooldown*(1-Math.min(.9,stateEffect(s,'AllActiveSkillCooldownRate')));}
// APK 8.2.0 bases from BonusModel.SetDefaultBonuses, which reads each one out of a ServerVarsModel
// static; live server overrides are unknown. Recorded in
// reference/tt2/8.2.0/bonus-defaults-evidence.json.
export const BONUS_DEFAULTS={critChance:Math.fround(.01),chestChance:Math.fround(.01),
 cloneAttackRate:4,multiMonsterChance:Math.fround(.01),multiMonsterMaxCount:4,
 megaBombChance:Math.fround(.001),megaBombMaxStacks:1} as const;
// MultiMonstersGold has a base in that table too, but it is 1.0 and the bonus is multiplicative, so
// it is already this project's neutral value - adding it here would double-count it. The two above
// are additive, whose neutral value is 0, so they do need their base.
// Not a bonus at all, so not in that table: the group's lower bound is read straight off the
// minMultiMonsterSpawns [ServerVar]. Same evidence file as the two bases above it.
export const MULTI_MONSTER_MIN=2;
// 炸彈泰坦（原生 Snap）的兩個 [ServerVar]：一疊的基礎關數，以及每疊讓該關隻數乘上的比例。
// 兩個都不是加成，所以不在上面那張表裡。見 reference/tt2/8.2.0/special-titan-evidence.json。
export const MEGA_BOMB={stageLength:10,titanRemoval:Math.fround(.9)} as const;
// 寶箱泰坦的兩個 [ServerVar]：一疊的基礎關數，以及寶箱金幣的倍率。
// treasureGold 是 15，引擎以前寫死 10。同一份證據檔。
export const CHESTERSON={stageLength:5,treasureGold:15} as const;
// 妖精的三個 [ServerVar]：額外妖精的上限、每多一隻機率乘的懲罰，以及妖精開始出現的關卡。
// 見 reference/tt2/8.2.0/fairy-evidence.json。
export const FAIRY={maxExtraSpawns:7,multiSpawnPenalty:Math.fround(.5),startStage:10} as const;
/** The crit boost skill's slot in this project's arrays; natively ActiveSkillID 3. */
const CRIT_BOOST_SKILL=SKILL_DATA.findIndex(k=>k.id==='CritBoost');
// Native PlayerModel.RefreshCriticalValues: the multiplier is playerCritMult x Bonus(CritDamage).
// Native RefreshCriticalValues has a third step this project had not read: while the crit boost
// skill (ActiveSkillID 3) is running, the crit multiplier is multiplied again by
// CritBoostSkillCritDamage. The first two steps - playerCritMult x CritDamage - were already here.
export function critMultiplier(s:State,resolve=stateResolver(s)){
 const boosted=s.active[CRIT_BOOST_SKILL]>s.last?resolve('CritBoostSkillCritDamage'):1;
 return 11.5*resolve('CritDamage')*boosted;
}
// The shadow clone swings on its own rhythm rather than riding the damage tick: native
// ShadowCloneAttackLoop waits 1 ÷ GetCloneAttackRate() seconds between swings, and that rate is
// max(1, Bonus(ShadowCloneSkillAttackRate) × Bonus(CompanionAttackRate)) — one attack a second
// before bonuses. Recorded in reference/tt2/8.2.0/damage-text-evidence.json.
export function cloneAttackRate(s:State){return Math.max(1,(BONUS_DEFAULTS.cloneAttackRate+stateEffect(s,'ShadowCloneSkillAttackRate'))*stateEffect(s,'CompanionAttackRate'));}
// 英雄轉點擊。原生 PlayerModel.GetTapDamage(等級, 轉換對象) 就是
// GetSwordMasterDamage(等級) ＋ GetTapFromHelpers(轉換對象) 兩項相加，後者是
// max(0, TapDamage 加成 × 英雄 DPS^該轉換的指數 × TapDamageFromHelpers × TapDamageFromHelpersMult)。
// 劍術大師那一支的指數是 helperToTapDPSPower = 0.5（影分身那一支是 0.6，各自有自己的欄位），
// 少了這個指數會大到離譜。TapDamageFromHelpers 目前唯一的來源是神器「大師之劍」，
// 倍率來自天賦 TapDmgFromHelpers；兩者都還沒接上時這一項是 0，點擊傷害與以前完全相同。
// 見 reference/tt2/8.2.0/tap-from-helpers-evidence.json。
const HELPER_TO_TAP_POWER=0.5;
export function tapFromHelpers(s:State):Big{
 const share=stateEffect(s,'TapDamageFromHelpers');
 if(!(share>0))return {...ZERO};
 const factor=share*stateEffect(s,'TapDamageFromHelpersMult')*stateEffect(s,'TapDamage');
 return atLeastZero(scale(power(bigMax({...ONE},rawHeroDps(s)),HELPER_TO_TAP_POWER),factor));}
export function tapDamage(s:State):Big{return add(buildDamage(s,'tap'),tapFromHelpers(s));}
export function weaponSets(s:State){return Math.min(...s.weapons,...s.tt2!.extraWeapons);}
// Resolving a bonus walks every artifact and pet, so the six keys the roster shares are resolved
// once per pass instead of once per hero: thirty-seven heroes used to ask a hundred and eleven times.
const HERO_EFFECT_KEYS=['HelperWeaponBoost','MeleeHelperDamage','RangedHelperDamage','SpellHelperDamage',
 'GroundHelperDamage','FlyingHelperDamage'] as const;
type HeroEffects=Record<string,number>;
const heroEffects=(s:State):HeroEffects=>{const resolve=stateResolver(s);
 return Object.fromEntries(HERO_EFFECT_KEYS.map(key=>[key,resolve(key)])) as HeroEffects;};
export function heroDps(s:State,i:number,shared?:HeroEffects):Big{const n=heroLevel(s,i),kind=TT2_HEROES[i].kind as 'Melee'|'Ranged'|'Spell';const milestone=TT2_HERO_MILESTONES.findLast(m=>m.level<=n)?.[kind]||1;
 if(n<=0)return {...ZERO};
 const effects=shared??heroEffects(s);
 // Each factor is finite on its own; multiplying them as numbers is what used to overflow.
 let value=scale(pow(1.035,Math.max(0,n-1)),HEROES[i].power*n);
 for(const factor of [milestone,1+((i<33?s.weapons[i]:s.tt2!.extraWeapons[i-33])||0)*.5*effects.HelperWeaponBoost,effects[kind+'HelperDamage'],effects[TT2_HEROES[i].spatial]])value=scale(value,factor);
 return value;}
export function dps(s:State):Big{let value=rawHeroDps(s);const resolve=stateResolver(s);
 for(const factor of [resolve('AllHelperDamage'),artifactAllDamage(s.tt2!),resolve('AllDamage'),s.active[2]>s.last?skillPower(s,2):1,gearBonus(s,1)])value=scale(value,factor);
 return value;}
// A trial fights its own wave order; a stage draws from the level's loaded monsters, and its
// boss is the one that level names rather than the same small monster tinted.
function chooseMonster(s:State){if(s.trial)return settledMonster(s);
 return isBoss(s)?bossSprite(s.stage):pickMonsterSprite(s.stage,tt2Random(s.tt2!));}
// The same choice without the roll, for a save that predates the field and for reads that must
// not touch the save: monsterIndex runs inside render, where spending rng would be a side effect.
function settledMonster(s:State){if(s.trial)return (s.trial.wave*7+s.trial.tier*12)%60;
 if(isBoss(s))return bossSprite(s.stage);
 const pool=stagePool(s.stage);return spriteForMonster(pool[Math.max(0,s.kills)%pool.length]);}
export function monsterIndex(s:State){const stored=s.monster;return typeof stored==='number'&&stored>=0&&stored<60?stored:settledMonster(s);}
// APK 8.2.0 ServerVarsModel static defaults; live server overrides are unknown. Native
// StageLogic.GetRawMonsterCountPerStage is base + stage * inc / (delta + stage), rounded by
// Math.Round (ties to even), and the arithmetic runs in float. Recorded in
// reference/tt2/8.2.0/monster-count-evidence.json.
const MONSTER_COUNT={base:8,inc:148,delta:32000} as const;
/** C#'s Math.Round(double): ties go to the even integer, unlike Math.round. */
function roundHalfEven(value:number){const floor=Math.floor(value),fraction=value-floor;
 return fraction>.5?floor+1:fraction<.5?floor:floor%2===0?floor:floor+1;}
// Native StageLogic.GetMonsterCountPerStage takes the rounded raw count and subtracts
// MonsterCountPerStage from it - the bonus reduces how many titans a stage holds, which is why the
// stats panel files it under reductions. The cast to int truncates, and the whole thing is floored
// at 1. The contract reduction belongs to a system this project has not built, so it is left out
// rather than folded in; the special-titan stack multiplier below it is implemented.
export function monsterCount(s:State){const stage=Math.max(1,s.stage);
 const ratio=Math.fround(Math.fround(Math.fround(stage)*Math.fround(MONSTER_COUNT.inc))/Math.fround(MONSTER_COUNT.delta+stage));
 const raw=roundHalfEven(Math.fround(ratio+Math.fround(MONSTER_COUNT.base)));
 let count=raw-Math.trunc(stateEffect(s,'MonsterCountPerStage'));
 // 炸彈泰坦的堆疊：每疊讓這一關的隻數再乘 0.9，最後才夾到 1——原生的 Math.Max 就在這之後。
 const stacks=s.tt2?.bombStacks?.length??0;
 if(stacks>0)count=Math.floor(count*MEGA_BOMB.titanRemoval**stacks);
 return Math.max(1,count);}
export function bossDuration(s:State){return 30+stateEffect(s,'BossTimerDuration');}
// 多重生成的一波是好幾隻各自滿血的泰坦，本專案把它們算成同一個血條：打完一波要花的時間、
// 拿到的金幣與推進的擊殺數因此都與原生一致。頭目不會多重生成。
export function health(s:State):Big{const group=isBoss(s)?1:Math.max(1,s.tt2?.multi||1);
 return scale(pow(1.32,s.stage-1),18*(isBoss(s)?[2,3,4,5,8][(s.stage-1)%5]:1)*group*(1-Math.min(.9,stateEffect(s,'MonsterHP'))));}
export function isBoss(s:State){return !s.trial&&!s.farming&&s.kills>=monsterCount(s);}
export function reward(s:State):Big{return goldReward(s,'monster');}
// APK 8.2.0 ServerVarsModel static default; live server overrides are unknown. The ratio is stored
// as a float there, and HelperInfo's constructor derives log(ratio) and ratio-1 from it, which is
// the same geometric series this cost is. Recorded in reference/tt2/8.2.0/helper-cost-evidence.json.
export const HELPER_DEFAULTS={costGrowth:Math.fround(1.08)} as const;
// The floor of the native prestige requirement: [ServerVar] minimumPrestigeStage, whose
// compiled-in default is 60 and which is the second argument of the Math.Max that ends
// PrestigeModel.GetPrestigeStage. The multiplier above that floor — half the highest prestige
// stage — is not implemented here, so reaching this stage once leaves prestige available.
export const PRESTIGE_DEFAULTS={minimumStage:60} as const;
export function cost(s:State,index=-1,count=1):Big{
 if(index<0)return scale(playerUpgradeCost(s.level,count),['SwordMasterUpgradeCost','AllUpgradeCost','AllUpgradeCostFairy'].reduce((n,id)=>n*Math.max(0,1-stateEffect(s,id)),1));
 const n=heroLevel(s,index),rate=HELPER_DEFAULTS.costGrowth;
 // The geometric sum itself always fits a double; it is multiplying it by base, which already
 // reaches 1e240 for the last heroes, that used to overflow. So the run is applied first.
 const run=scale(pow(rate,n),(rate**count-1)/(rate-1));
 return bigCeil(scale(run,HEROES[index].base*(1-Math.min(.9,stateEffect(s,'AllUpgradeCost')))*(1-Math.min(.9,stateEffect(s,'HelperUpgradeCost')))));
}
// The stage^1.7 / 100 part is still the 7.5 approximation of the native three-term curve, but the
// multipliers around it are the native ones. Following the GHDouble out-pointers through
// GetTotalRelicsFromStageCount gives the order: the curve is multiplied by PrestigeRelic, then by
// 1 + PrestigeRelicAdditive, then by the additive-multiplier term — which expands to
// 1 + 0.00017 * max(owned, next tier) and is therefore exactly 1 without that system — then
// by OnlyPrestigeRelic. Both of the ones applied here are inert on a clean save — the additive one
// defaults to 0 and comes from the mythic sets, the other defaults to 1 and has no source yet.
export function relicGain(s:State){
 if(s.best<PRESTIGE_DEFAULTS.minimumStage)return 0;
 const multiplier=stateEffect(s,'PrestigeRelic')*(1+stateEffect(s,'PrestigeRelicAdditive'))*stateEffect(s,'OnlyPrestigeRelic');
 // Native rounds the whole thing up (GHDouble.Ceiling), which also makes the project's own
 // "at least one" floor redundant for every reachable stage; it stays as a guard.
 return Math.max(1,Math.ceil(s.stage**1.7/100*multiplier));
}
export function artifactCost(s:State,i:number){return s.tt2!.artifacts[i]?upgradeArtifactCost(s.tt2!,i):discoveryCost(s.tt2!);}
export function evolveCost(s:State,i:number):Big{return scale(pow(1e4,s.evolutions[i]),HEROES[i].base*1e6);}
// Native ActiveSkillModel.GetActiveSkillMaxLevel adds AllActiveSkillCap to the skill's own
// defaultSkillCap, plus a per-class cap; none of those class bonuses has a source in this project.
// The tables carry 40 rows against a default cap of 30, so the rows above the cap are what this
// unlocks - level 35 of the shadow clone is 243x level 30, not a rounding difference.
export function skillCap(s:State,i:number){
 return Math.min(SKILL_DATA[i].amount.length,SKILL_DATA[i].max+stateEffect(s,'AllActiveSkillCap'));
}
export function skillCost(s:State,i:number){return SKILL_DATA[i].cost[Math.min(SKILL_DATA[i].cost.length-1,Math.max(0,s.skillLevels[i]))];}
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
// 多重泰坦生成。原生 MonsterController.SpawnMonster 每生成一次擲一次骰，中了就一次放一群上場，
// 而 MonsterModel.GetMonsterGoldDrop 收到那群的隻數，把整群的金幣一次結算。所以「一波幾隻」
// 同時決定血量、擊殺數與金幣倍率，這三者在本專案裡也就綁在同一個 s.tt2.multi 上。
// 見 reference/tt2/8.2.0/multi-monster-evidence.json。
// 特殊泰坦的生成機率是同一個模板：自己那一項 × SpecialTitanSpawnChance × AllProbabilityBoost。
// 寶箱那一項以前少乘了中間那個因子，這一版補上。見 special-titan-evidence.json。
export function chestChance(s:State,resolve=stateResolver(s)){
 return Math.min(1,(BONUS_DEFAULTS.chestChance+resolve('ChestChance'))
  *resolve('SpecialTitanSpawnChance')*resolve('AllProbabilityBoost'));}
export function megaBombChance(s:State,resolve=stateResolver(s)){
 return Math.min(1,(BONUS_DEFAULTS.megaBombChance+resolve('MegaBombSpawnChance'))
  *resolve('SpecialTitanSpawnChance')*resolve('AllProbabilityBoost'));}
/** 同時最多幾疊。原生把這個上限擋在生成端：滿層就不再生出炸彈泰坦。 */
export function megaBombMaxStacks(s:State,resolve=stateResolver(s)){
 return Math.max(0,Math.trunc(BONUS_DEFAULTS.megaBombMaxStacks+resolve('MegaBombMaxStacks')));}
/** 一疊維持幾關。 */
export function megaBombStackLength(s:State,resolve=stateResolver(s)){
 return Math.floor(MEGA_BOMB.stageLength*resolve('SpecialTitanStackDurationMult'));}
/** 寶箱泰坦一疊維持幾關。原生的上限是常數 1，所以只會有一疊。 */
export function chestersonStackLength(s:State,resolve=stateResolver(s)){
 return Math.floor((resolve('ChestersonGoldStageAmount')+CHESTERSON.stageLength)
  *resolve('SpecialTitanStackDurationMult'));}
// 多重妖精。原生 FairyController.MultiFairySpawn 先無條件生一隻，再跑一個迴圈擲額外的：
// 每一輪沒中就結束，中了就多一隻並把機率乘上懲罰，最多七隻。機率**不夾在 1**——
// 原生就是 Random.value < 機率，天賦滿級是 2.75，前幾輪必中。
/** 這一次領取的妖精，除了必得的那一隻之外還有幾隻。 */
export function rollExtraFairies(s:State,resolve=stateResolver(s)){
 let chance=resolve('FairySpawnChance')*resolve('AllProbabilityBoost'),extra=0;
 for(let n=1;n<=FAIRY.maxExtraSpawns;n++){
  if(tt2Random(s.tt2!)>=chance)break;
  extra++;chance*=FAIRY.multiSpawnPenalty;}
 return extra;}
/** 妖精要推到這一關才開始出現。原生看的是最高關卡，不是目前所在的關卡。 */
export function fairiesUnlocked(s:State){return s.best>=FAIRY.startStage;}
// QTE 排程。原生 QTEController 對每個已解鎖的類型跑一個冷卻 coroutine，冷卻結束就取消冷卻、
// 依 expireTime 排一個過期 coroutine，然後送出 OnQTEReady；沒人點的話過期後重排冷卻。
// 本專案沒有 coroutine，改用兩個時間戳：qteReadyAt 是冷卻結束的時刻，qteExpireAt 是
// ready 之後消失的時刻，兩者都以 -1 表示「沒有在跑」。ready 的狀態就是 qteExpireAt > 0。
// 目前只有妖精有消費端；寵物與英雄那幾型的資料與倍率都在，等各自那一段接上去。
const QTE_SCHEDULED:readonly number[]=[QTE_TYPE.Fairy,QTE_TYPE.PetAttack];
// 雷霆爆發（原生的 Mash QTE）要連打幾下：原生 PetController.BonusUpdatedHandler 在
// PetTapCountToAttack 變動時重算 max(1, mashQTENumTaps − 該加成)。那個 [ServerVar] 是 30，
// 與平常寵物攻擊的蓄力次數（本專案的 petRequiredTaps，20）是**兩個不同的數字**，不要混用。
const MASH_QTE_TAPS=30;
/** 這一次雷霆爆發要連打幾下。 */
export function petBurstTaps(s:State,resolve=stateResolver(s)){
 return Math.max(1,MASH_QTE_TAPS-Math.floor(resolve('PetTapCountToAttack')));}
/** 原生 PetModel.GetQTEBigAttack：平常那一擊乘上 PetAttackQTEDamage。 */
export function petBurstDamage(s:State):Big{
 return scale(petAttackDamage(s),stateEffect(s,'PetAttackQTEDamage'));}
/**
 * 原生 QTEController.GetCooldownDuration。資料表沒有這一型時回 0，**而且不套用下限**——
 * 原生的夾擠在分支之後，查不到的那條路直接跳過它。
 * @param roll 對應原生的 Random.Range(−1, 1)。
 */
export function qteCooldownSeconds(s:State,type:number,roll:number,resolve=stateResolver(s)){
 const info=TT2_QTE[type];if(!info)return 0;
 // 冷卻加成扣的是秒數，不是倍率：原生走 fsub，加成資料表也把它標成 additive／subtract／seconds。
 let n=(info.cooldown-resolve(info.cooldownBonus))*(1+info.randomness*roll);
 for(const id of QTE_COOLDOWN_MULTIPLIERS[type]||[])n*=resolve(id);
 return Math.max(QTE_MIN_COOLDOWN,n);}
/** 這一型現在是不是 ready（原生的 expire coroutine 正在跑）。 */
export function qteReady(t:TT2State,type:number){return t.qteExpireAt[type]>0;}
function scheduleQTECooldown(s:State,type:number){const t=s.tt2!;
 t.qteExpireAt[type]=-1;
 // 連打的進度不跨輪保留：沒打滿就過期的那一輪，下次要從頭來。
 if(type===QTE_TYPE.PetAttack)t.qteTaps=0;
 t.qteReadyAt[type]=s.last+qteCooldownSeconds(s,type,tt2Random(t)*2-1)*1000;}
/** 推進 QTE 的狀態機到 s.last。可在任何時間點呼叫，重複呼叫不會重複轉換。 */
export function advanceQTE(s:State){const t=s.tt2!;
 for(const type of QTE_SCHEDULED){
  // 原生的 ScheduleCooldown 只對已解鎖的類型排程；鎖著就什麼都不跑。
  if(!qteUnlocked(t,type)){t.qteReadyAt[type]=-1;t.qteExpireAt[type]=-1;continue;}
  if(qteReady(t,type)){if(s.last>=t.qteExpireAt[type])scheduleQTECooldown(s,type);continue;}
  if(t.qteReadyAt[type]<0){scheduleQTECooldown(s,type);continue;}
  if(s.last>=t.qteReadyAt[type]){t.qteReadyAt[type]=-1;t.qteExpireAt[type]=s.last+TT2_QTE[type].expire*1000;}}}
// 原生的計時器是 Unity coroutine，App 切到背景時不走。離線推進把時間戳整個往後平移，
// 等於「離線那段時間不算」，而不是補發錯過的每一次 ready。
function shiftQTE(t:TT2State,gap:number){
 for(const slots of [t.qteReadyAt,t.qteExpireAt])
  for(let i=0;i<slots.length;i++)if(slots[i]>0)slots[i]+=gap;}
// 舊存檔只有 lastFairy（本專案自訂的 60 秒冷卻）。已經可以領的直接進 ready，
// 還在冷卻的從上次領取的時刻起算一次新的冷卻，已經等過的時間照算。
function migrateFairyQTE(s:State){const t=s.tt2!,type=QTE_TYPE.Fairy;
 if(s.last-s.lastFairy>=60000){t.qteReadyAt[type]=-1;t.qteExpireAt[type]=s.last+TT2_QTE[type].expire*1000;return;}
 t.qteExpireAt[type]=-1;
 t.qteReadyAt[type]=s.lastFairy+qteCooldownSeconds(s,type,tt2Random(t)*2-1)*1000;}
/** 寶箱效果作用中嗎？作用中的那幾關，每一隻普通泰坦都是寶箱泰坦。 */
export function chestersonActive(s:State){return (s.tt2?.chestStages??0)>0;}
// 原生的 CanSpawnTitan 除了「還沒疊」還要求蛻變過一次，所以第一輪不會出現寶箱泰坦。
function canSpawnChesterson(s:State){return !chestersonActive(s)&&s.prestiges>0;}
/** 打死一隻炸彈泰坦：推一疊進佇列。原生推完還會夾住長度，那是同一關打死多隻時的防護。 */
function pushBombStack(s:State,resolve=stateResolver(s)){
 const length=megaBombStackLength(s,resolve);if(length<1)return;
 const stacks=s.tt2!.bombStacks;stacks.push(length);
 while(stacks.length>length)stacks.shift();}
/** 清掉一關：每一疊少一關，歸零的移除。 */
function ageBombStacks(t:TT2State){
 if(!t.bombStacks.length)return;
 t.bombStacks=t.bombStacks.map(n=>n-1).filter(n=>n>=1);}
export function multiMonsterChance(s:State,resolve=stateResolver(s)){
 return Math.min(1,(BONUS_DEFAULTS.multiMonsterChance+resolve('MultiMonsters'))*resolve('AllProbabilityBoost'));}
export function multiMonsterMaxCount(s:State,resolve=stateResolver(s)){
 return Math.max(MULTI_MONSTER_MIN,BONUS_DEFAULTS.multiMonsterMaxCount+resolve('MultiMonstersMaxCount'));}
/** 這一波的隻數：沒中骰就是一隻，中了就是 [下限, 上限] 之間的一個整數。頭目不參與。 */
function rollMultiMonsters(s:State){
 if(isBoss(s))return 1;
 const resolve=stateResolver(s);
 if(tt2Random(s.tt2!)>=multiMonsterChance(s,resolve))return 1;
 // 原生是 (int)Random.Range(min, max+1)：float 版是半開區間，取整後落在 min..max。
 const span=multiMonsterMaxCount(s,resolve)+1-MULTI_MONSTER_MIN;
 return Math.max(1,Math.trunc(MULTI_MONSTER_MIN+tt2Random(s.tt2!)*span));}
/** 一波金幣的倍率：原生只放大額外的那幾隻，所以一隻的一波永遠是 1 倍。 */
export function multiMonsterGold(s:State,count:number,resolve=stateResolver(s)){
 return count<2?1:1+(count-1)*resolve('MultiMonstersGold');}
function spawn(s:State){s.tt2!.multi=rollMultiMonsters(s);s.hp=health(s);s.bossEnd=isBoss(s)?s.last+bossDuration(s)*1000:0;s.bossWounded=false;s.monster=chooseMonster(s);const id=monsterIndex(s);if(!s.seen.includes(id))s.seen.push(id);}
// 跳泰坦與跳關不是一個全域數值：原生 StageLogic.GetTitanSkip／GetStageSkip 都以傷害來源分支，
// 把該來源專屬的加成加到共用的基礎值上再乘倍率，最後取整數；而且兩者都只從 OnMonsterDeath 進入，
// 所以是擊殺時觸發，不是每次命中。本專案有天堂聖擊、寵物攻擊與影分身三個來源；公會飛船、匕首、
// 金槍與寵物爆發要等對應流派實作，不能把它們的加成折算到別人身上。
// 只有部分來源有專屬的跳關倍率（寵物那條原生就沒有），沒有的就不乘。
// 見 reference/tt2/8.2.0/skip-evidence.json。
const SKIP_SOURCES={heavenly:{titan:'BurstSkillTitanSkip',stage:'BurstSkillStageSkip',stageMult:'BurstSkillStageSkipMult'},
 pet:{titan:'PetAttackTitanSkip',stage:'PetAttackStageSkip',stageMult:''},
 // 雷霆爆發走自己的 DamageType（PetBurst，列舉值 11）。原生的 GetStageSkip 有這一支，
 // GetTitanSkip **沒有**——它的 switch 沒有 PetBurst，落到 default，而那條路上結果槽在方法
 // 開頭就被清成 0，所以雷霆爆發完全不跳泰坦，連基礎的 TitanSkip 都不加。
 petBurst:{titan:'',stage:'PetQTEStageSkip',stageMult:''},
 clone:{titan:'ShadowCloneTitanSkip',stage:'ShadowCloneStageSkip',stageMult:'ShadowCloneStageSkipMult'}} as const;
export type SkipSource=keyof typeof SKIP_SOURCES;
export function titanSkip(s:State,source:SkipSource){const k=SKIP_SOURCES[source];
 if(!k.titan)return 0;
 return Math.max(0,Math.floor((stateEffect(s,'TitanSkip')+stateEffect(s,k.titan))*stateEffect(s,'TitanSkipMult')));}
export function stageSkip(s:State,source:SkipSource){const k=SKIP_SOURCES[source];
 return Math.max(0,Math.floor((stateEffect(s,'StageSkip')+stateEffect(s,k.stage))*(k.stageMult?stateEffect(s,k.stageMult):1)));}
// 清掉一個關卡的收尾：首達獎勵都以 s.best 為準，所以逐關跑一次就不會漏領也不會重複。
function clearStage(s:State,cleared:number){
 if(cleared>=16&&(cleared-16)%20===0&&cleared>s.tt2!.gearMilestone&&dropGear(s.tt2!,Math.max(s.best,cleared))){
  s.tt2!.gearMilestone=cleared;s.tt2!.equipmentCollected++;s.daily.equipment++;}
 ageBombStacks(s.tt2!);
 if(s.tt2!.chestStages>0)s.tt2!.chestStages--;
 s.stage=Math.min(STAGE_CAP,cleared+1);s.best=Math.max(s.best,s.stage);s.kills=0;
 const points=Math.max(0,Math.floor(s.best/50)-1);
 if(points>s.tt2!.earnedPoints){s.tt2!.points+=points-s.tt2!.earnedPoints;s.tt2!.earnedPoints=points;}}
// 被跳過的泰坦與關卡照樣給金幣：原生分別走 GetNonBossSplashGoldDrop 與 GetBossSplashGoldDrop。
// Native Cloaking, read off StageLogic.OnMonsterDeath: after each kill, if the player is cloaking
// and a roll comes in under CloakedSkipChance, CloakedSkipAmount stages are added to the skip.
// IsCloaking is "the talent is unlocked and the current stage is no further than the season's best
// plus CloakedStageDuration" - so it only helps while re-clearing ground already taken.
//
// CloakedStageDuration is the talent's fourth bonus column, and this project's talent data only
// carries the first two, so the native table value of 1 is used directly. The same gap hides a
// fourth bonus on twelve other talents; recorded in ROADMAP.md rather than papered over here.
const CLOAKED_STAGE_DURATION=1;
export function cloakedStageSkip(s:State,resolve=stateResolver(s)){
 const chance=resolve('CloakedSkipChance');
 if(chance<=0)return 0;
 if(s.stage>s.best+CLOAKED_STAGE_DURATION)return 0;
 if(tt2Random(s.tt2!)>=chance)return 0;
 return Math.max(0,Math.floor(resolve('CloakedSkipAmount')));
}
function applySkips(s:State,source:SkipSource){
 if(!isBoss(s)&&!s.farming){
  const room=Math.max(0,monsterCount(s)-1-s.kills),skipped=Math.min(titanSkip(s,source),room);
  for(let n=0;n<skipped;n++){earnGold(s,goldReward(s,'monster'));s.totalKills++;s.daily.kills++;s.kills++;}}
 const stages=stageSkip(s,source)+cloakedStageSkip(s);
 for(let n=0;n<stages&&s.stage<STAGE_CAP;n++){
  earnGold(s,goldReward(s,'boss'));s.bossKills++;clearStage(s,s.stage);}}
function damage(s:State,hit:Big,source?:SkipSource){if(compare(hit,{...ZERO})<=0)return;s.hp=subtract(s.hp,hit);if(compare(s.hp,{...ZERO})>0)return;
 const boss=isBoss(s),resolve=stateResolver(s);
 // 寶箱效果作用中時，這一關的每一隻都是寶箱泰坦——原生是在生成時把類別換掉，不是再擲一次骰。
 const converted=!boss&&chestersonActive(s);
 const rolled=!boss&&!converted&&canSpawnChesterson(s)&&tt2Random(s.tt2!)<chestChance(s,resolve);
 const chest=converted||rolled;
 // 一隻泰坦只能是一種，所以寶箱與炸彈互斥。原生的順序是先擲骰再看能不能生成，滿層就不生成。
 const bomb=!boss&&!chest&&tt2Random(s.tt2!)<megaBombChance(s,resolve)
  &&s.tt2!.bombStacks.length<megaBombMaxStacks(s,resolve);
 // 原生一次結算整群，不是逐隻給：隻數同時決定金幣倍率、擊殺數與寶箱計數——
 // 一波三隻在寶箱效果裡就是三隻寶箱泰坦，不是一隻。
 const group=boss?1:Math.max(1,s.tt2!.multi||1);
 earnGold(s,scale(goldReward(s,boss?'boss':chest?'chest':'monster'),multiMonsterGold(s,group)));if(chest)s.tt2!.chestKills+=group;
 if(bomb){pushBombStack(s);s.tt2!.bombKills++;}
 // 只有擲骰打到的那一隻會開啟效果；被效果轉成寶箱的那些不會把它自己續期。
 if(rolled)s.tt2!.chestStages=chestersonStackLength(s,resolve);
 s.totalKills+=group;s.daily.kills+=group;
 if(boss){s.bossKills++;clearStage(s,s.stage);}else if(!s.farming)s.kills+=group;
 if(source)applySkips(s,source);
 spawn(s);
}
export function advance(s:State,to:number){hydrate(s);if(!Number.isFinite(to))return s;to=Math.max(s.last,to);const gap=to-s.last;advanceEggs(s.tt2!,to);
 if(dayAt(to)>s.daily.day)s.daily=newDaily(dayAt(to));
 if(gap>30000){const seconds=Math.min(gap/1000,8*3600);s.tt2!.mana=Math.min(manaMax(s),s.tt2!.mana+baseManaRegen(s)*manaSeconds(s.tt2!,s.last,s.last+seconds*1000));const offline={...s,last:to,active:Array(6).fill(0)};earnGold(s,scale(reward(offline),Math.min(ratio(dps(offline),bigMax({...ONE},health({...offline,farming:true}))),2)*seconds*.5));s.last=to;s.active.fill(0);shiftQTE(s.tt2!,gap);advanceQTE(s);if(isBoss(s)){s.farming=true;s.kills=0;spawn(s);}return s;}
 while(s.last<to){const boundary=(Math.floor(s.last/100)+1)*100;const step=Math.min(boundary-s.last,to-s.last);s.last+=step;s.tt2!.mana=Math.min(manaMax(s),s.tt2!.mana+baseManaRegen(s)*manaSeconds(s.tt2!,s.last-step,s.last));
 if(isBoss(s)&&s.bossEnd&&s.last>=s.bossEnd){s.farming=true;s.kills=0;spawn(s);note(s,'頭目時間結束，切換金幣農場。');}
 if(s.last===boundary)autoBuyHeroes(s);
 if(s.last===boundary)advanceQTE(s);
 if(s.last===boundary)damage(s,scale(dps(s),.1));
 // The clone used to be folded into that tick, which made it invisible and threw away its attack
 // rate: the same damage per second arrived in ten silent instalments. It is its own attack now,
 // one per 1 ÷ cloneAttackRate seconds, rounded up to the 100ms tick the simulation walks on.
 if(s.last===boundary&&s.active[0]>s.last){const t=s.tt2!,rate=cloneAttackRate(s),interval=1000/rate;
  // buildDamage is this project's per-second figure, so a swing is that divided by the rate: the
  // rhythm follows the original (four a second before bonuses) without multiplying the damage by it.
  if(s.last-t.cloneAt>=interval){t.cloneAt+=interval;t.lastCloneHit=scale(buildDamage(s,'clone'),1/rate);t.cloneAttacks++;damage(s,t.lastCloneHit,'clone');}}
 }return s;
}
export function apply(s:State,a:Action){advance(s,a.at);const i=a.index??0,t=s.tt2!;
 if(a.type==='resourcePerk'&&Number.isInteger(i)&&RESOURCE_PERKS[i]){
  const token=a.amount===1,price=RESOURCE_PERKS[i].cost,full=perkLevel(t,i,s.last)>=perkLimit(t);
  if((token?t.perkTokens>0:s.diamonds>=price)&&activatePerk(t,i,s.last)){t.perksUsed++;if(token)t.perkTokens--;else s.diamonds-=price;if(i===0)t.mana=manaMax(s);if(i===1){t.rainLast=s.last;buyAffordableHeroes(s);}note(s,`已使用${RESOURCE_PERKS[i].name}，${full?'層數已滿，剩餘時間最短的一層換成十二小時。':'每層持續十二小時。'}`);}
 }
 if(a.type==='tap'&&s.last-s.lastTap>=45){s.lastTap=s.last;s.taps++;s.daily.taps++;t.tutorialTaps++;t.lastCrit=tt2Random(t)<critChance(s);if(t.lastCrit)t.crits++;let n=scale(tapDamage(s),t.lastCrit?critMultiplier(s):1);if(s.active[1]>s.last&&tt2Random(t)<SKILL_DATA[1].second[skillStep(1,s.skillLevels[1])])n=scale(n,skillPower(s,1));t.lastHit=n;damage(s,n);if(chargePet(t)){t.lastPetHit=petAttackDamage(s);t.petAttacks++;damage(s,t.lastPetHit,'pet');}
  // 雷霆爆發：QTE ready 的時候同一下點擊也算進連打，湊滿就放一次大的。
  // 原生的 MashQTETapHandler 是獨立的按鈕，本專案沒有場上的寵物實體，所以併進戰鬥區的點擊。
  if(qteReady(t,QTE_TYPE.PetAttack)&&activeCombatPet(t)>=0){t.qteTaps++;
   if(t.qteTaps>=petBurstTaps(s)){t.qteTaps=0;
    t.lastPetHit=petBurstDamage(s);t.petAttacks++;damage(s,t.lastPetHit,'petBurst');
    scheduleQTECooldown(s,QTE_TYPE.PetAttack);note(s,'雷霆爆發！');}}}
 if(a.type==='upgrade'||a.type==='hero'){const id=a.type==='upgrade'?-1:i;if(id<-1||id>=HEROES.length||!Number.isInteger(id))return s;let count=a.amount??1;const cap=id<0?PLAYER_LEVEL_CAP:HERO_LEVEL_CAP;
  if(count===0){while(count<1000&&compare(s.gold,cost(s,id,count+1))>=0&&(id<0?s.level:heroLevel(s,id))+count<cap)count++;}if(![1,10,25,100,1000,0].includes(a.amount??1)||!count)return s;const price=cost(s,id,count);
  if(compare(s.gold,price)>=0&&(id<0?s.level:heroLevel(s,id))+count<=cap){s.gold=atLeastZero(subtract(s.gold,price));if(id<0)s.level+=count;else setHeroLevel(s,id,heroLevel(s,id)+count);}}
 if(a.type==='skill'&&Number.isInteger(i)&&i>=0&&i<6&&s.skillLevels[i]>0&&s.level>=SKILLS[i].level&&s.cooldowns[i]<=s.last&&t.mana>=skillMana(s,i)){
  t.mana-=skillMana(s,i);s.active[i]=s.last+skillDuration(s,i)*1000;s.cooldowns[i]=s.active[i]+skillCooldown(s,i)*1000;s.daily.skills++;
  // The native loop waits out one interval before the first swing, so the clock starts on the cast.
  if(i===0)t.cloneAt=s.last;
  if(i===5){t.heavenlyStrikes++;damage(s,buildDamage(s,'heavenly'),'heavenly');s.active[i]=s.last;s.cooldowns[i]=s.last+skillCooldown(s,i)*1000;}
 }
 if(a.type==='skillUp'&&Number.isInteger(i)&&i>=0&&i<6&&s.level>=SKILLS[i].level&&s.skillLevels[i]<skillCap(s,i)&&compare(s.gold,fromNumber(skillCost(s,i)))>=0){s.gold=atLeastZero(subtract(s.gold,fromNumber(skillCost(s,i))));s.skillLevels[i]++;}
 if(a.type==='discover'&&s.best>=PRESTIGE_DEFAULTS.minimumStage){const found=drawArtifact(t,s.relics);if(found){s.relics-=found.cost;note(s,`獲得神器：${TT2_ARTIFACTS[found.index].name}`);}}
 if(a.type==='artifact'&&Number.isInteger(i)&&i>=0&&i<103&&t.artifacts[i]>0){const price=artifactCost(s,i),max=TT2_ARTIFACTS[i].max||1e6;if(s.relics>=price&&t.artifacts[i]<max){s.relics-=price;t.spent[i]+=price;t.artifacts[i]++;}}
 if(a.type==='talent'&&Number.isInteger(i)&&i>=0&&i<TT2_TREE.length&&canBuyTalent(t,i,s.best)){t.points-=TT2_TREE[i].cost[t.tree[i]];t.tree[i]++;}
 if(a.type==='resetTalents'){t.points+=spentPoints(t);t.tree.fill(0);t.mana=Math.min(t.mana,manaMax(s));note(s,'技能點已返還。網頁版目前提供免費重配。');}
 if(a.type==='build'&&Number.isInteger(i)&&i>=0&&i<7)t.build=(['tap','pet','ship','clone','dagger','heavenly','goldGun'] as Build[])[i];
 if(a.type==='prestige'&&s.best>=PRESTIGE_DEFAULTS.minimumStage&&!s.trial){const gain=relicGain(s),reset=fresh(s.last);for(const key of ['best','prestiges','taps','totalKills','diamonds','weapons','gear','equipped','dust','lootCounter','bossKills','seen','achievements','daily','loginDay','streak','weekly','worldBest','log'] as const)Object.assign(reset,{[key]:structuredClone(s[key])});reset.tt2=structuredClone(t);reset.tt2.extraHeroes.fill(0);reset.tt2.petCharge=0;reset.tt2.lastPetHit={...ZERO};reset.tt2.cloneAt=reset.last;reset.tt2.lastCloneHit={...ZERO};reset.tt2.mana=manaMax(reset);reset.prestiges++;reset.relics=s.relics+gain;reset.tt2.relicsCollected=t.relicsCollected+gain;reset.daily.prestiges++;reset.hp=health(reset);note(reset,`蛻變完成，獲得 ${gain} 聖物。`);return reset;}
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
 // 原生 HandleQTEFinished：點下去就結束這一輪、重排冷卻。沒點的話由 advanceQTE 讓它過期。
 if(a.type==='fairy'&&fairiesUnlocked(s)&&qteReady(t,QTE_TYPE.Fairy)){s.lastFairy=s.last;scheduleQTECooldown(s,QTE_TYPE.Fairy);
  // 一次領取可能來好幾隻：原生排程牠們依序飛進來，本專案沒有場上實體，所以一次結算完。
  const fairies=1+rollExtraFairies(s);
  s.daily.fairies+=fairies;s.tt2!.fairyRewards+=fairies;
  for(let n=0;n<fairies;n++)earnGold(s,goldReward(s,'fairy'));
  note(s,fairies>1?`已領取妖精金幣，這次來了 ${fairies} 隻。`:'已領取妖精金幣。');}
 if(a.type==='equip'){const item=t.inventory.find(g=>g.id===i);if(item)t.equipped[TT2_GEAR[item.definition].slot]=i;}
 if(a.type==='petEquip'&&Number.isInteger(i)&&TT2_PETS[i]&&t.petLevels[i]>0)t.activePets[TT2_PETS[i].slot==='Damage'?0:1]=i;
 if(a.type==='egg'&&t.eggs>0){const before=t.petLevels.reduce((n,v)=>n+v,0);const pet=awardPet(t,s.best);if(pet>=0){t.eggs--;s.daily.petLevels+=Math.max(0,t.petLevels.reduce((n,v)=>n+v,0)-before);note(s,`獲得 ${PET_NAMES[TT2_PETS[pet].name]}，目前等級 ${t.petLevels[pet]}。`);}}
 if(a.type==='craft'&&Number.isInteger(i)&&craftSet(t,i,s.best))note(s,'製作完成；集齊五個部位後保留套裝效果。');
 if(a.type==='gearDiscard'&&Number.isInteger(i)&&!t.equipped.includes(i))t.inventory=t.inventory.filter(g=>g.id!==i);
 if(a.type==='daily'&&t.loginAt!==dayAt(s.last)){
  const reward=TT2_DAILY[t.loginIndex%TT2_DAILY.length];
  if(reward.reward==='Equipment'&&t.inventory.length+reward.amount>100)return s;
  // 上次領取就在昨天才算接下去；隔了一天以上就從第一天重新算起。
  t.loginStreak=t.loginAt===dayAt(s.last)-1?t.loginStreak+1:1;
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
function rawHeroDps(s:State):Big{const shared=heroEffects(s);return sum(HEROES.map((_,i)=>heroDps(s,i,shared)));}
// Native PlayerModel.RefreshManaCap: the cap is not a fixed number. ActiveSkillModel
// .GetSkillManaCapAmount starts at manaCapInitial and adds manaCapPerSkill for each unlocked active
// skill, then the two pool bonuses apply. APK 8.2.0 defaults are 0 and 35, so a player with every
// skill unlocked sits at 210 and one with none has no mana bar at all — which is also when there is
// nothing to spend it on. Recorded in reference/tt2/8.2.0/servervar-defaults.json.
// capBonusMax is maximumManaCapBonusAmount: the ceiling the mana cap is clamped to before it is
// used as a damage multiplier. Six skills put this project's cap at 210, so it never binds here.
export const MANA_DEFAULTS={capInitial:0,capPerSkill:35,regenPerMinute:2,capBonusMax:5000} as const;
export function unlockedSkills(s:State){return SKILLS.filter(k=>s.level>=k.level).length;}
export function manaMax(s:State){
 const base=MANA_DEFAULTS.capInitial+MANA_DEFAULTS.capPerSkill*unlockedSkills(s);
 return limit((base+stateEffect(s,'ManaPoolCap'))*stateEffect(s,'ManaPoolCapPercent'));}
// Two clamped effects multiplied together still overflow, so the composed regen is clamped again.
// Native RefreshManaRegen: (manaRegenBaseInMinutes + Bonus(ManaRegen)) x Bonus(ManaRegenMult)
// / 60 x Bonus(AllManaGained) — the same shape this already had, with the base confirmed as 2.
function baseManaRegen(s:State){return limit((MANA_DEFAULTS.regenPerMinute+stateEffect(s,'ManaRegen'))/60
 *stateEffect(s,'ManaRegenMult')*stateEffect(s,'AllManaGained'));}
export function manaRegen(s:State){return limit(baseManaRegen(s)*perkValue(s.tt2!,0,s.last));}
export function skillMana(s:State,i:number){return Math.max(0,SKILL_DATA[i].mana[skillStep(i,s.skillLevels[i])]-skillBonus(s,SKILL_DATA[i].id+'SkillMana'));}
// Native: min(Bonus(CritChance) x Bonus(AllProbabilityBoost), maxCritChance), and maxCritChance
// is 1. The chance bonus is additive on top of the base, the probability boost is a multiplier.
export function critChance(s:State){
 return Math.min(1,(BONUS_DEFAULTS.critChance+stateEffect(s,'CritChance'))*stateEffect(s,'AllProbabilityBoost'));}
// Native RefreshDamageBonusPerManaCap: when Bonus(DamagePerManaCap) is not the bonus's identity,
// AllDamage x= clamp(currentManaCap, 0, maximumManaCapBonusAmount) x that bonus - no leading 1, so
// the mana cap itself is the multiplier. When the bonus is at its identity the modifier is removed
// instead of applied.
//
// Deliberate departure: natively a mana cap of 0 would multiply all damage by 0. Native pacing
// never reaches that state, but this project can - the Corrupted set has no stage requirement, so
// a save can own it before the Sword Master hits 100 and unlocks the first skill, and a damage of
// zero is unrecoverable because gold only comes from kills. With no cap yet, the term is skipped.
export function manaCapDamage(s:State,resolve=stateResolver(s)){
 // The native check is against GetBonusIdentity, not zero, and that distinction matters here:
 // DamagePerManaCap is a multiplicative bonus, so with no source it reads 1, and treating 1 as
 // "present" would multiply everyone's damage by their whole mana cap.
 const identity=bonusDefinitions['DamagePerManaCap']?.additive?0:1;
 const perManaCap=resolve('DamagePerManaCap');
 if(perManaCap===identity)return 1;
 const cap=Math.min(MANA_DEFAULTS.capBonusMax,Math.max(0,manaMax(s)));
 return cap?cap*perManaCap:1;
}
// Native RefreshDamagePerHelperWeaponBonus: AllDamage x= total weapon levels x the bonus, with two
// guards and no leading 1 - it skips when the total is 0, and when the bonus is at its identity.
// Neither guard covers a low total, so natively a set granting 0.1 per level is a loss below ten
// levels. That is the native behaviour and it is recoverable, so it is kept as is.
export function helperWeaponDamage(s:State,resolve=stateResolver(s)){
 const identity=bonusDefinitions['DamagePerHelperWeapon']?.additive?0:1;
 const perWeapon=resolve('DamagePerHelperWeapon');
 if(perWeapon===identity)return 1;
 const levels=s.weapons.reduce((a,b)=>a+b,0)+s.tt2!.extraWeapons.reduce((a,b)=>a+b,0);
 return levels?levels*perWeapon:1;
}
// 連續登入天數。原生 DailyRewardModel.UpdateBonusPerConsecutiveLoginDay 把「連續幾天」當**指數**：
// AllDamage ×= Pow(DamagePerConsecutiveLoginDay, 狀態完好 ? 夾住的天數 : 0)。
// 指數先設 0，只有在 GetCollected() ≤ COLLECTED_TODAY 時才換成 LoginStreakCapped，
// 所以**漏領一天整項就變成 1**，不是慢慢遞減。夾的上限是 NUMBER_OF_DAYS。
// 見 reference/tt2/8.2.0/login-streak-evidence.json。
export const LOGIN_STREAK_DAYS=14;
/** 連續登入還算不算數：今天領過，或上次領取就在昨天。 */
export function loginStreakIntact(s:State){
 const t=s.tt2!,today=dayAt(s.last);
 return t.loginAt===today||t.loginAt===today-1;}
/** 目前算數的連續天數，已經夾在 0 與上限之間。 */
export function loginStreakDays(s:State){
 return loginStreakIntact(s)?Math.min(LOGIN_STREAK_DAYS,Math.max(0,s.tt2!.loginStreak-1)):0;}
export function consecutiveLoginDamage(s:State,resolve=stateResolver(s)){
 const per=resolve('DamagePerConsecutiveLoginDay');
 return per===1?1:per**loginStreakDays(s);
}
// Native StatsTrackedBonusModel.UpdateDamagePerMaxStageBonus: AllDamage x= bonus ** max stage.
// GHDouble.Pow(value, exponent) takes the bonus as the base, so the stage is the exponent. The
// bonus is multiplicative, so with no source it reads 1 and 1 ** anything is still 1.
export function maxStageDamage(s:State,resolve=stateResolver(s)){
 const per=resolve('DamagePerMaxStage');
 return per===1?1:per**Math.max(0,s.best);
}
export function buildDamage(s:State,build:Build):Big{const t=s.tt2!,active=s.active.filter(n=>n>s.last).length,c={tap:0,pet:.5,ship:1,clone:.5,dagger:.5,heavenly:.5,goldGun:.9}[build];
 // The intrinsic Sword Master curve is native-verified. Other build models
 // still use the existing reduction coefficients pending full reconstruction.
 const tapCoefficient={tap:1,pet:1,ship:0,clone:.6,dagger:1,heavenly:1,goldGun:.45}[build];
 let n=power(swordMasterBaseDamage(s),tapCoefficient);
 if(c)n=multiply(n,power(bigMax({...ONE},rawHeroDps(s)),c));
 const resolve=stateResolver(s);
 n=scale(n,buildMultiplier(t,build,active,isBoss(s),resolve)*gearBonus(s,0)*manaCapDamage(s,resolve)*helperWeaponDamage(s,resolve)*maxStageDamage(s,resolve)*consecutiveLoginDamage(s,resolve));
 if(s.active[3]>s.last)n=scale(n,skillPower(s,3)**({tap:1,pet:1,ship:0,clone:.6,dagger:1,heavenly:1,goldGun:.45}[build]));
 if(s.active[2]>s.last)n=scale(n,skillPower(s,2)**c);
 if(build==='clone')n=scale(n,SKILL_DATA[0].amount[skillStep(0,s.skillLevels[0])]);
 if(build==='heavenly')n=scale(n,SKILL_DATA[5].amount[skillStep(5,s.skillLevels[5])]);
 return n;
}
// 多重生成的倍率不在這裡：原生 GetMonsterGoldDrop 對整群只乘 1 + (隻數 − 1) × MultiMonstersGold，
// 既不走寶箱那條 ChestAmount，也不是逐隻給，所以它由 multiMonsterGold() 套在結果外面。
export function goldReward(s:State,source:'monster'|'boss'|'fairy'|'chest'|'pet'):Big{
 const t=s.tt2!,running=Math.min(4,s.active.filter(n=>n>s.last).length);
 let n=scale(pow(1.27,s.stage-1),5);
 // Native RefreshGoldPerPlayerLevelBonus: GoldAll x= 1 + Sword Master level x GoldPerSwordMasterLevel,
 // applied only when the bonus is above zero. Shaped like the card-level term just below it.
 const resolve=stateResolver(s);
 for(const factor of [resolve('GoldAll'),resolve('JackpotGold'),resolve('GoldPerRunningActiveSkill')**running,1+resolve('GoldPerOwnedCardLevel')*t.cards,1+resolve('GoldPerSwordMasterLevel')*s.level,gearBonus(s,2)])n=scale(n,factor);
 if(source==='boss'||source==='pet')n=scale(n,10*resolve('GoldBoss'));
 // 寶箱與妖精走同一個倍率：原生的 GetFairyGoldAmount 以 GetChestersonGold 起算，而那就是
 // GetMonsterGoldDrop 帶 MonsterClass.Chesterson，所以兩者都是 treasureGold × ChestAmount。
 if(source==='chest'||source==='fairy')n=scale(n,CHESTERSON.treasureGold*resolve('ChestAmount'));
 if(source==='fairy'||source==='pet')n=scale(n,resolve('GoldSpecialty'));
 if(source==='fairy')n=scale(n,resolve('FairyGold'));if(source==='pet')n=scale(n,resolve('PetGoldQTEAmount'));
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
/** The hero-passive totals for this save, rebuilt only when a level or the boost moved. */
function heroPassives(s:State){
 const levels=[...s.heroes,...s.tt2!.extraHeroes],boost=heroPowerBoost(s.tt2!),signature=levels.join(',')+'|'+boost.multiplicative+'|'+boost.additive;
 let cached=heroPassiveCache.get(s);
 if(!cached||cached.signature!==signature){cached={signature,totals:heroPassiveTotals(levels,boost)};heroPassiveCache.set(s,cached);}
 return cached.totals;
}
// Building that signature copies 37 levels and joins them into a string, and the bonus lookup under
// it re-walks both cache stamps. A damage number asks for well over a dozen bonuses, so the hot
// paths take the resolver once and reuse it; stateEffect stays for the one-off callers.
export function stateResolver(s:State){
 const totals=heroPassives(s),resolve=effectResolver(s.tt2!);
 return (target:string)=>{
  const additive=bonusDefinitions[target]?.additive,hero=totals[target]??(additive?0:1);
  // Both branches are clamped: an unbounded effect used to reach the save as Infinity through mana,
  // skill duration and cooldown, which then failed snapshot validation on every write.
  return limit(additive?resolve(target)+hero:resolve(target)*hero);
 };
}
export function stateEffect(s:State,target:string){return stateResolver(s)(target);}

export function swordMasterBaseDamage(s:State):Big{return scale(playerBaseDamage(s.level),stateEffect(s,'SwordMasterDamage'));}
