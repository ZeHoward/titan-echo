import {TT2_PETS,TT2_GEAR,TT2_SETS} from './tt2-data.ts';
import {tt2Random,type TT2State} from './tt2-rules.ts';
export const EGG_INTERVAL=4*60*60*1000;
export function advanceEggs(t:TT2State,now:number){
 if(t.eggs>=2){t.eggAt=now;return;}
 const count=Math.max(0,Math.floor((now-t.eggAt)/EGG_INTERVAL));
 if(count){t.eggs=Math.min(2,t.eggs+count);t.eggAt=t.eggs===2?now:t.eggAt+count*EGG_INTERVAL;}
}
export function awardPet(t:TT2State,best:number){
 const eligible=TT2_PETS.map((p,i)=>({p,i})).filter(({p})=>p.unlock<=best);
 if(!eligible.length)return -1;
 const i=eligible[Math.floor(tt2Random(t)*eligible.length)].i;t.petLevels[i]++;
 const slot=TT2_PETS[i].slot==='Damage'?0:1;if(t.activePets[slot]<0)t.activePets[slot]=i;return i;
}
export function collectGear(t:TT2State,definition:number,level:number){
 if(t.inventory.length>=100)return false;
 const g=TT2_GEAR[definition];if(!g)return false;
 t.inventory.push({id:t.nextGearId++,definition,level});
 const set=TT2_SETS.findIndex(s=>s.id===g.set);
 if(set>=0&&!t.pieces.some(p=>p.set===set&&p.slot===g.slot))t.pieces.push({set,slot:g.slot});
 if(set>=0&&t.pieces.filter(p=>p.set===set).length===5&&!t.sets.includes(set))t.sets.push(set);
 return true;
}
// Drop level/rarity distribution is explicitly a web approximation until the
// original server's sampling table is available. Item primary stats use CSV math.
export function dropGear(t:TT2State,best:number){
 const pool=TT2_GEAR.map((g,i)=>({g,i})).filter(({g})=>g.rarity===1&&!g.limited&&g.set==='None');
 return collectGear(t,pool[Math.floor(tt2Random(t)*pool.length)].i,Math.max(1,Math.floor(best/10)));
}
export function craftPrice(t:TT2State,set:number){const k=TT2_SETS[set];return k?.cost[Math.min(4,t.pieces.filter(p=>p.set===set).length)]||Infinity;}
export function craftSet(t:TT2State,set:number,best:number){
 const k=TT2_SETS[set];if(!k||!['Mythic','Legendary','Rare'].includes(k.rarity)||best<k.stage||t.inventory.length>=100)return false;
 const missing=[0,1,2,3,4].find(slot=>!t.pieces.some(p=>p.set===set&&p.slot===slot));if(missing===undefined)return false;
 const cost=craftPrice(t,set),definition=TT2_GEAR.findIndex(g=>g.set===k.id&&g.slot===missing);
 if(definition<0||!Number.isFinite(cost)||t.shards<cost)return false;
 if(!collectGear(t,definition,Math.max(1,Math.floor(best/10))))return false;t.shards-=cost;return true;
}
