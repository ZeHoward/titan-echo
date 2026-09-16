import {PLAYER_MILESTONES} from './tt2-player-milestones.ts';
import {type Big, ONE, ZERO, fromText, pow, scale} from './big-number.ts';

// APK 8.2.0 ServerVarsModel static defaults; live server overrides are unknown.
export const PLAYER_DEFAULTS={damage:1,costBase:5,costGrowth:Math.fround(1.075)} as const;

// TotalNew reaches 9.07E+363, so the table carries its source text and is parsed once on use.
const totals=PLAYER_MILESTONES.map(m=>fromText(m.total));

export function playerBaseDamage(level:number):Big{return scale(playerMilestone(level),level*PLAYER_DEFAULTS.damage);}
export function playerUpgradeCost(level:number,amount=1):Big{
 if(amount<=0)return {...ZERO};
 const r=PLAYER_DEFAULTS.costGrowth;
 // base * r^level * (r^amount - 1)/(r - 1); r^level is the only part that outgrows a double.
 return scale(pow(r,level),PLAYER_DEFAULTS.costBase*Math.expm1(amount*Math.log(r))/(r-1));
}

// TotalNew is already cumulative. Multiplying the rows again overcounts it.
export function playerMilestone(level:number):Big{
 const index=PLAYER_MILESTONES.findLastIndex(m=>m.level<=level);
 return index<0?{...ONE}:{...totals[index]};
}
export function nextPlayerMilestone(level:number,levelCap=PLAYER_MILESTONES[PLAYER_MILESTONES.length-1].level){
 return PLAYER_MILESTONES.find(m=>m.level>level&&m.level<=levelCap);
}
