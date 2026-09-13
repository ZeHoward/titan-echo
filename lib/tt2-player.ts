import {PLAYER_MILESTONES} from './tt2-player-milestones.ts';

// APK 8.2.0 ServerVarsModel static defaults; live server overrides are unknown.
export const PLAYER_DEFAULTS={damage:1,costBase:5,costGrowth:Math.fround(1.075)} as const;
export function playerBaseDamage(level:number){return Math.min(1e240,level*playerMilestone(level)*PLAYER_DEFAULTS.damage);}
export function playerUpgradeCost(level:number,amount=1){
 if(amount<=0)return 0;
 const r=PLAYER_DEFAULTS.costGrowth;
 return Math.min(1e240,PLAYER_DEFAULTS.costBase*r**level*Math.expm1(amount*Math.log(r))/(r-1));
}

// TotalNew is already cumulative. Multiplying the rows again overcounts it.
export function playerMilestone(level:number){return PLAYER_MILESTONES.findLast(m=>m.level<=level)?.total??1;}
export function nextPlayerMilestone(level:number,levelCap=2000){return PLAYER_MILESTONES.find(m=>m.level>level&&m.level<=levelCap);}
