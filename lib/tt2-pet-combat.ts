import {TT2_PETS} from './tt2-data.ts';
import {effect,cap,type TT2State} from './tt2-rules.ts';
export function activeCombatPet(t:TT2State){const i=t.activePets[0];return Number.isInteger(i)&&i>=0&&TT2_PETS[i]?.slot==='Damage'&&t.petLevels[i]>0?i:-1;}
export function petRequiredTaps(t:TT2State){return Math.max(1,20-Math.floor(effect(t,'PetTapCountToAttack')));}
// Piecewise pet damage coefficients from the pinned 7.5 PetInfo table.
// Sum active/passive contributions separately from artifact PetDamage multipliers.
export function petDamageFactor(t:TT2State){
 if(activeCombatPet(t)<0)return 0;
 return cap(1+TT2_PETS.reduce((sum,p,i)=>{
  const level=t.petLevels[i]||0;if(!level)return sum;
  const fraction=t.activePets.includes(i)?1:Math.min(1,Math.floor(level/5)*.05);
  const amount=p.damage+Math.min(level,40)*p.damageInc[0]+Math.min(Math.max(0,level-40),40)*p.damageInc[1]+Math.max(0,level-80)*p.damageInc[2];
  return sum+amount*fraction;
 },0));
}
export function chargePet(t:TT2State){
 if(activeCombatPet(t)<0){t.petCharge=0;return false;}
 t.petCharge++;
 if(t.petCharge<petRequiredTaps(t))return false;
 t.petCharge=0;return true;
}
