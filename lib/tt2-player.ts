import {PLAYER_MILESTONES} from './tt2-player-milestones.ts';

// TotalNew is already cumulative. Multiplying the rows again overcounts it.
export function playerMilestone(level:number){return PLAYER_MILESTONES.findLast(m=>m.level<=level)?.total??1;}
export function nextPlayerMilestone(level:number,levelCap=2000){return PLAYER_MILESTONES.find(m=>m.level>level&&m.level<=levelCap);}
