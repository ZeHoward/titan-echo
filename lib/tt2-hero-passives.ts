import {HERO_SKILLS} from './tt2-hero-skills.ts';
import {TT2_HEROES} from './tt2-data.ts';
import {bonusDefinitions,cap,effect,type TT2State} from './tt2-rules.ts';

// Formula/timing or the actual reward event is not implemented yet.
export const PENDING_HERO_EFFECTS=new Set(['Goldx10Chance','MultiMonstersGold','PetGoldQTEAmount']);
export const heroSkills=(index:number)=>HERO_SKILLS.filter(k=>k.owner===TT2_HEROES[index]?.id);
const indices=new Map(TT2_HEROES.map((h,i)=>[h.id,i]));
export type HeroPowerBoost={multiplicative:number;additive:number};
const noBoost:HeroPowerBoost={multiplicative:0,additive:0};
export function heroPowerBoost(t:TT2State):HeroPowerBoost{return {
 multiplicative:effect(t,'HelperMultiplicativeSkillBoost'),
 additive:effect(t,'HelperAdditiveSkillBoost'),
};}
export function heroSkillValue(skill:typeof HERO_SKILLS[number],boost:HeroPowerBoost=noBoost){
 if(PENDING_HERO_EFFECTS.has(skill.effect))return skill.value;
 return cap(skill.value*(1+(bonusDefinitions[skill.effect]?.additive?boost.additive:boost.multiplicative)));
}
export function heroPassiveTotals(levels:number[],boost:HeroPowerBoost=noBoost){
 const totals:Record<string,number>={};
 for(const k of HERO_SKILLS){
  if((levels[indices.get(k.owner)!]||0)<k.level||PENDING_HERO_EFFECTS.has(k.effect))continue;
  const additive=bonusDefinitions[k.effect]?.additive;
  const value=heroSkillValue(k,boost);
  totals[k.effect]=additive?(totals[k.effect]||0)+value:cap((totals[k.effect]??1)*value);
 }
 return totals;
}
