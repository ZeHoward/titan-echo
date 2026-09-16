import {type Big,ZERO} from './big-number.ts';
import {EXTRA_EFFECT_LABELS} from './zh-tw.ts';
import {TT2_ARTIFACTS,TT2_ACTIVE,TT2_BONUSES,TT2_TREE,TT2_SETS,TT2_DISCOVERY,TT2_PETS,TT2_GEAR} from './tt2-data.ts';
export {TT2_ARTIFACTS,TT2_ACTIVE,TT2_TREE,TT2_SETS};
export const TT2_RULESET='tt2-7.5.0';
export type Build='tap'|'pet'|'ship'|'clone'|'dagger'|'heavenly'|'goldGun';
export type EquipmentItem={id:number;definition:number;level:number};
export type TT2State={petCharge:number;petAttacks:number;lastPetHit:Big;perkEnds:number[][];rainLast:number;inventory:EquipmentItem[];equipped:number[];nextGearId:number;activePets:number[];eggAt:number;eggs:number;gearMilestone:number;loginIndex:number;loginAt:number;eventCurrency:number;perkTokens:number;extraWeapons:number[];artifacts:number[];spent:number[];enchanted:number[];tree:number[];points:number;earnedPoints:number;sets:number[];pieces:{set:number;slot:number}[];shards:number;build:Build;mana:number;rng:number;extraHeroes:number[];petLevels:number[];cards:number;scrolls:number[];clan:boolean;lastCrit:boolean;lastHit:Big;bossRelics:number[];legacyArtifacts:number[];legacySpent:number[];goldCollected:Big;chestKills:number;fairyRewards:number;heavenlyStrikes:number;crits:number;equipmentCollected:number;relicsCollected:number;perksUsed:number;tutorialStep:number;tutorialTaps:number};
export function freshTT2(seed:number):TT2State{return {petCharge:0,petAttacks:0,lastPetHit:{...ZERO},perkEnds:[[],[]],rainLast:seed,inventory:[],equipped:[-1,-1,-1,-1,-1],nextGearId:1,activePets:[-1,-1],eggAt:seed,eggs:0,gearMilestone:0,loginIndex:0,loginAt:-1,eventCurrency:0,perkTokens:0,extraWeapons:Array(4).fill(0),artifacts:Array(103).fill(0),spent:Array(103).fill(0),enchanted:[],tree:Array(TT2_TREE.length).fill(0),points:0,earnedPoints:0,sets:[],pieces:[],shards:0,build:'tap',mana:200,rng:(seed>>>0)||1,extraHeroes:Array(4).fill(0),petLevels:Array(30).fill(0),cards:0,scrolls:Array(37).fill(0),clan:false,lastCrit:false,lastHit:{...ZERO},bossRelics:[],legacyArtifacts:[],legacySpent:[],goldCollected:{...ZERO},chestKills:0,fairyRewards:0,heavenlyStrikes:0,crits:0,equipmentCollected:0,relicsCollected:0,perksUsed:0,tutorialStep:0,tutorialTaps:0};}
export function tt2Random(t:TT2State){t.rng=(Math.imul(t.rng,1664525)+1013904223)>>>0;return t.rng/4294967296;}
export const cap=(v:number)=>Math.max(0,Math.min(1e240,Number.isFinite(v)?v:1e240));
type BonusDefinition={description:string;group:string;combos:string[];additive:boolean;subtract:boolean;seconds:boolean;percent:boolean};
export const bonusDefinitions=TT2_BONUSES as Record<string,BonusDefinition>;
export const EFFECT_LABELS:Record<string,string>={
 PrestigeRelic:'蛻變聖物',GoldPerOwnedCardLevel:'依突襲卡總等級增加所有金幣',GoldPerRunningActiveSkill:'每個施放中技能的金幣加成（最多四個）',ChestAmount:'寶箱泰坦金幣',GoldBoss:'頭目金幣',GoldAll:'所有金幣',UnskilledGold:'所有金幣與累積金幣',JackpotGold:'累積金幣',FairyGold:'妖精金幣',PetGoldQTEAmount:'米達斯之心金幣',MultiMonstersGold:'多重泰坦金幣',GoldSpecialty:'妖精與米心金幣',DamagePerOwnedCardLevel:'依突襲卡總等級增加所有傷害',DamagePerRunningActiveSkill:'每個施放中技能的傷害加成（最多四個）',HSArtifactDamage:'神器總傷害',AllDamage:'所有傷害',TapDamage:'點擊傷害',SwordAttackDamage:'劍攻擊傷害（天堂／影分身／匕首／金槍）',CritDamage:'暴擊傷害',FundamentalDamage:'點擊與英雄傷害',AllHelperDamage:'所有英雄傷害',MeleeHelperDamage:'近戰英雄傷害',RangedHelperDamage:'遠程英雄傷害',SpellHelperDamage:'咒術英雄傷害',GroundHelperDamage:'地面英雄傷害',FlyingHelperDamage:'飛行英雄傷害',PetDamage:'寵物傷害',ClanShipDamage:'公會飛船傷害',UltraDaggerDamage:'匕首傷害',GoldGunDamage:'金槍傷害',CompanionDamage:'同伴傷害（寵物／飛船／影分身）',LegacyPetDamageEffect:'傳統寵物的傷害加成效果',LegacyPetGoldEffect:'傳統寵物的金幣加成效果',ExoticPetDamageEffect:'異國寵物的傷害加成效果',ExoticPetGoldEffect:'異國寵物的金幣加成效果',BoostedSwordAttackDamage:'所有傷害與暴擊傷害',TitanSlayer:'天堂傷害與劍裝備效果',EquipmentPetEffect:'裝備寵物效果',TitanDamage:'普通泰坦傷害',BossDamage:'頭目傷害',KnightBonusBoost:'寵物、點擊、火劍效果',WarlordBonusBoost:'飛船、英雄、戰嚎效果',SorcererBonusBoost:'天堂、影分身、點石成金效果',RogueBonusBoost:'匕首、致命爆擊效果',AllEquipmentEffect:'所有裝備主要效果',SwordBoost:'劍裝備效果',HelmetBoost:'頭盔效果',ArmorBoost:'衣服效果',AuraBoost:'靈氣效果',SlashBoost:'砍痕效果',SophiaComboBoost:'劍效果與近戰英雄傷害',NohniComboBoost:'頭盔效果與飛行英雄傷害',LanceComboBoost:'衣服效果與地面英雄傷害',KronusComboBoost:'靈氣效果與咒術英雄傷害',SajeComboBoost:'砍痕效果與遠程英雄傷害',AllActiveSkillAmount:'所有主動技能效果',BurstDamageSkillAmount:'天堂聖擊效果',CritBoostSkillAmount:'致命爆擊效果',HandOfMidasSkillAmount:'點石成金效果',TapBoostSkillAmount:'火焰之劍效果',HelperBoostSkillAmount:'戰爭狂嚎效果',ShadowCloneSkillAmount:'影分身效果',DualPetAmount:'雙重召喚效果',CannonDamage:'雷霆船效果與金槍傷害',StreamOfBladesSkillAmount:'刀片流效果',TwilightBoost:'天堂與影分身傷害',AllActiveSkillCooldownRate:'全部主動技能冷卻縮減',AllActiveSkillDuration:'全部主動技能持續秒數',CritBoostSkillDuration:'致命爆擊持續秒數',HandOfMidasSkillDuration:'點石成金持續秒數',TapBoostSkillDuration:'火焰之劍持續秒數',HelperBoostSkillDuration:'戰爭狂嚎持續秒數',ShadowCloneSkillDuration:'影分身持續秒數',BurstDamageSkillMana:'天堂聖擊魔力消耗減少',CritBoostSkillMana:'致命爆擊魔力消耗減少',HandOfMidasSkillMana:'點石成金魔力消耗減少',TapBoostSkillMana:'火焰之劍魔力消耗減少',HelperBoostSkillMana:'戰爭狂嚎魔力消耗減少',ShadowCloneSkillMana:'影分身魔力消耗減少',ManaPoolCap:'魔力上限',AllManaSourceMult:'所有魔力回復',ManaRefundPercent:'施法魔力返還機率',ChestChance:'寶箱泰坦機率',JackpotGoldChance:'十倍金幣機率',FairySpawnChance:'多重妖精機率',CritChance:'暴擊機率',MultiMonsters:'多重泰坦機率',StageSkipMonsterSpawnChance:'波特機率',MegaBombSpawnChance:'炸彈泰坦機率',ManaMonsterSpawnChance:'魔力馬尼機率',AllProbabilityBoost:'全部機率效果',AllUpgradeCost:'全部金幣升級費用減少',HelperUpgradeCost:'英雄升級費用減少',HelperWeaponBoost:'英雄武器效果',HelperWeaponSetBoost:'英雄武器套裝效果',ClanScrollBoost:'英雄卷軸效果',ClanScrollSetBoost:'卷軸套裝效果',TapDamageFromHelpers:'英雄傷害轉為點擊傷害',AllArtifactDamageEffect:'傷害神器效果',AllArtifactGoldEffect:'金幣神器效果',DamagePerOwnedArtifact:'每件神器增加所有傷害',MonsterHP:'所有泰坦生命減少',BossTimerDuration:'頭目戰時間',
};
export const effectLabel=(id:string)=>EFFECT_LABELS[id]||EXTRA_EFFECT_LABELS[id]||'特殊效果';
export function effectText(id:string,value:number){const d=bonusDefinitions[id];const number=(n:number)=>n>=1000?n.toExponential(2):Number(n.toPrecision(4)).toString();if(d?.additive)return `${d.subtract?'−':'+'}${number(value*(d.percent?100:1))}${d.percent?'%':d.seconds?' 秒':''}`;return `×${number(value)}`;}
export function artifactValue(t:TT2State,i:number){const a=TT2_ARTIFACTS[i],level=t.artifacts[i]||0;if(!level)return bonusDefinitions[a.effect]?.additive?0:1;const magnitude=a.value*level**a.exponent;return cap((bonusDefinitions[a.effect]?.additive?magnitude:1+magnitude)*(t.enchanted.includes(i)?a.enchant:1));}
function reaches(from:string,target:string,seen=new Set<string>()):boolean{if(from===target)return true;if(seen.has(from))return false;seen.add(from);return (bonusDefinitions[from]?.combos||[]).some(c=>reaches(c,target,new Set(seen)));}
// Keep independent multipliers independent; additive chance/seconds/cost modifiers
// are summed. Composite bonuses use the CSV's explicit expansion graph.
const effectCache=new WeakMap<TT2State,{signature:string;values:Map<string,number>}>();
export function baseEffect(t:TT2State,target:string){
 const signature=t.artifacts.join(',')+'|'+t.tree.join(',')+'|'+t.sets.join(',')+'|'+t.enchanted.join(',');
 let cached=effectCache.get(t);if(!cached||cached.signature!==signature){cached={signature,values:new Map()};effectCache.set(t,cached);}
 const found=cached.values.get(target);if(found!==undefined)return found;
 const additive=bonusDefinitions[target]?.additive;let total=additive?0:1;
 const put=(n:number)=>{total=additive?total+n:cap(total*n);};
 TT2_ARTIFACTS.forEach((a,i)=>{if(t.artifacts[i]>0&&reaches(a.effect,target)){let n=artifactValue(t,i);if(!a.max&&a.effect!=='PrestigeRelic'){const group=bonusDefinitions[a.effect]?.group;const boost=group==='Damage'?98:group==='Gold'?99:-1;if(boost>=0&&boost!==i&&t.artifacts[boost]>0)n=cap(n*artifactValue(t,boost));}put(n);}});
 TT2_TREE.forEach((k,i)=>{const level=t.tree[i]||0;if(level)for(const e of k.effects)if(reaches(e.type,target))put(e.values[level]);});
 TT2_SETS.forEach((set,i)=>{if(t.sets.includes(i))for(const e of set.effects)if(reaches(e.type,target)&&!e.perDay)put(e.amount);});
 cached.values.set(target,total);return total;
}
export function artifactAllDamage(t:TT2State){return cap((1+TT2_ARTIFACTS.reduce((n,a,i)=>n+a.damage*(t.artifacts[i]||0),0))*effect(t,'HSArtifactDamage'));}
export function petBonus(t:TT2State,i:number){
 const p=TT2_PETS[i],level=t.petLevels[i]||0,additive=bonusDefinitions[p.effect]?.additive;
 if(!level)return additive?0:1;
 const selected=t.activePets.includes(i),fraction=selected?1:Math.min(1,Math.floor(level/5)*.05);
 const steps=Math.max(0,Math.floor((Math.min(level,p.improvementMax)-100)/50));
 let full=(p.base+level*p.inc)*p.improvement**steps;
 const group=bonusDefinitions[p.effect]?.group;
 if(group==='Damage'||group==='Gold')full*=baseEffect(t,p.family+'Pet'+group+'Effect');
 if(p.effect.endsWith('Boost'))full*=baseEffect(t,'EquipmentPetEffect');
 return cap(additive?full*fraction:1+(full-1)*fraction);
}
function petEffect(t:TT2State,target:string){let n=bonusDefinitions[target]?.additive?0:1;TT2_PETS.forEach((p,i)=>{if(reaches(p.effect,target))n=bonusDefinitions[target]?.additive?n+petBonus(t,i):cap(n*petBonus(t,i));});return n;}
export function equipmentValue(item:EquipmentItem){const g=TT2_GEAR[item.definition];return cap(g.base+g.inc*(item.level**g.exp1+g.expBase**(item.level**g.exp2)));}
export function equipmentEffect(t:TT2State,item:EquipmentItem){
 const g=TT2_GEAR[item.definition],boost=['SwordBoost','HelmetBoost','ArmorBoost','AuraBoost','SlashBoost'][g.slot];
 let n=equipmentValue(item)*baseEffect(t,'AllEquipmentEffect')*baseEffect(t,boost)*petEffect(t,boost);
 if(g.slot!==3){const aura=t.inventory.find(x=>x.id===t.equipped[3]);if(aura&&reaches(TT2_GEAR[aura.definition].effect,boost))n*=equipmentEffect(t,aura);}
 return cap(n);
}
export function effect(t:TT2State,target:string){
 const additive=bonusDefinitions[target]?.additive;let n=baseEffect(t,target),p=petEffect(t,target);n=additive?n+p:cap(n*p);
 for(const item of t.inventory){const g=TT2_GEAR[item.definition];if(t.equipped[g.slot]===item.id&&reaches(g.effect,target)){const value=equipmentEffect(t,item);n=additive?n+value:cap(n*value);}}
 return n;
}
export function discoveryCost(t:TT2State){return TT2_DISCOVERY[t.artifacts.filter(n=>n>0).length]||1e240;}
export function upgradeArtifactCost(t:TT2State,i:number){const a=TT2_ARTIFACTS[i];return Math.max(1,Math.round(a.cost*(t.artifacts[i]+1)**a.costExponent));}
export function canDiscover(t:TT2State){return t.artifacts.some(n=>n===0);}
export function discoveryPool(t:TT2State){const missing=TT2_ARTIFACTS.map((a,i)=>({a,i})).filter(({i})=>!t.artifacts[i]);const pool=Math.min(...missing.map(({a})=>a.pool));return missing.filter(({a})=>a.pool===pool).map(({i})=>i);}
export function drawArtifact(t:TT2State,relics:number){const cost=discoveryCost(t),pool=discoveryPool(t);if(!pool.length||relics<cost)return null;const i=pool[Math.floor(tt2Random(t)*pool.length)];t.artifacts[i]=1;t.spent[i]=cost;return {index:i,cost};}
export function spentPoints(t:TT2State,branch?:string){return TT2_TREE.reduce((n,k,i)=>n+(!branch||k.branch===branch?k.cost.slice(0,t.tree[i]||0).reduce((a,b)=>a+b,0):0),0);}
export function canBuyTalent(t:TT2State,i:number,best:number){const k=TT2_TREE[i],level=t.tree[i]||0;if(!k||level>=k.max||t.points<k.cost[level]||best<k.stage[level]||spentPoints(t,k.branch)<k.required)return false;const prerequisite=TT2_TREE.findIndex(n=>n.id===k.prerequisite);return prerequisite<0||t.tree[prerequisite]>0;}
// Exponents are damage-reduction coefficients, not a linear percentage discount.
export const BUILD_COEFFICIENTS:Record<Build,{tap:number;hero:number}>={tap:{tap:1,hero:0},pet:{tap:1,hero:.5},ship:{tap:0,hero:1},clone:{tap:.6,hero:.5},dagger:{tap:1,hero:.5},heavenly:{tap:1,hero:.5},goldGun:{tap:.45,hero:.9}};
export function buildMultiplier(t:TT2State,build:Build,active:number,boss=false,resolve=(id:string)=>effect(t,id)){const c=BUILD_COEFFICIENTS[build];let n=artifactAllDamage(t)*resolve('AllDamage')*resolve('CritDamage')*resolve('TapDamage')**c.tap*resolve('AllHelperDamage')**c.hero;
 n*=resolve('DamagePerRunningActiveSkill')**Math.min(4,active);
 n*=1+(resolve('DamagePerOwnedCardLevel')-1)*t.cards;
 n*=1+(resolve('DamagePerOwnedArtifact')-1)*t.artifacts.filter(n=>n>0).length;
 if(['pet','ship','clone'].includes(build))n*=resolve('CompanionDamage');
 if(['heavenly','clone','dagger','goldGun'].includes(build))n*=resolve('SwordAttackDamage');
 n*=resolve(boss?'BossDamage':'TitanDamage');
 const own={tap:'TapDamage',pet:'PetDamage',ship:'ClanShipDamage',clone:'ShadowCloneSkillAmount',dagger:'UltraDaggerDamage',heavenly:'BurstDamageSkillAmount',goldGun:'GoldGunDamage'}[build];
 if(build!=='tap')n*=resolve(own);
 return cap(n);
}
