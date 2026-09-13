import {HERO_SKILLS} from './tt2-hero-skills.ts';
import {TT2_HEROES} from './tt2-data.ts';
import {bonusDefinitions,cap} from './tt2-rules.ts';

// Formula/timing or the actual reward event is not implemented yet.
export const PENDING_HERO_EFFECTS=new Set(['TapDamageFromHelpers','Goldx10Chance','MultiMonstersGold','PetGoldQTEAmount']);
export const heroSkills=(index:number)=>HERO_SKILLS.filter(k=>k.owner===TT2_HEROES[index]?.id);
const indices=new Map(TT2_HEROES.map((h,i)=>[h.id,i]));
export function heroPassiveTotals(levels:number[]){
 const totals:Record<string,number>={};
 for(const k of HERO_SKILLS){
  if((levels[indices.get(k.owner)!]||0)<k.level||PENDING_HERO_EFFECTS.has(k.effect))continue;
  const additive=bonusDefinitions[k.effect]?.additive;
  totals[k.effect]=additive?(totals[k.effect]||0)+k.value:cap((totals[k.effect]??1)*k.value);
 }
 return totals;
}
