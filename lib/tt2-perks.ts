import {effect,type TT2State} from './tt2-rules.ts';
// TT2 7.5.0 PerkInfo.csv; IDs here are stable web save indices.
export const RESOURCE_PERKS=[
 {id:'ManaPotion',name:'魔力藥水',icon:'🧪',cost:100,duration:43200000,values:[1.5,1.75,2,2.25],description:'立即補滿魔力，並提高魔力回復倍率。'},
 {id:'MakeItRain',name:'黃金雨',icon:'🌧️',cost:100,duration:43200000,values:[45,15,5,3],description:'定時使用現有金幣，自動招募及升級英雄。'},
] as const;
// The native cap on how much AutoBuyHeroesMultDuringMakeItRain may shorten the interval, kept at
// float precision because that is how ServerVarsModel.autoBuyHeroesMaxBonus is stored.
const AUTO_BUY_MAX_BONUS=Math.fround(.95);
export function perkLevel(t:TT2State,i:number,now:number){return (t.perkEnds?.[i]||[]).filter(end=>end>now).length;}
export function perkLimit(t:TT2State){return Math.min(4,3+Math.max(0,Math.floor(effect(t,'PerkMaxLevel'))));}
/** What Make It Rain's tabled interval is multiplied by; 1 with no GoldRain set equipped. */
export function rainIntervalScale(t:TT2State){return 1-Math.min(effect(t,'AutoBuyHeroesMultDuringMakeItRain'),AUTO_BUY_MAX_BONUS);}
// GetBonusAmountA indexes the four amounts by stack count, clamped at both ends, and puts a
// multiplier in front of the result — 1 for every perk except Make It Rain.
export function perkValue(t:TT2State,i:number,now:number){
 const n=perkLevel(t,i,now);if(!n)return i===0?1:0;
 const amount=RESOURCE_PERKS[i].values[Math.min(3,n-1)];
 return i===1?amount*rainIntervalScale(t):amount;
}
// A full stack does not refuse the activation: the native ActivatePerk calls RemoveOldestStack,
// which clears the timer with the least time left, and adds the new stack anyway. Spending at the
// limit therefore trades the shortest stack for a fresh twelve hours rather than doing nothing.
export function activatePerk(t:TT2State,i:number,now:number){
 if(!Number.isInteger(i)||!RESOURCE_PERKS[i])return false;
 const live=t.perkEnds[i].filter(end=>end>now).sort((a,b)=>a-b);
 if(live.length>=perkLimit(t))live.shift();
 live.push(now+RESOURCE_PERKS[i].duration);t.perkEnds[i]=live;return true;
}
// Integrate expiry boundaries, so a potion cannot boost an entire offline
// interval after expiring partway through it.
export function manaSeconds(t:TT2State,from:number,to:number){
 const ends=[from,...t.perkEnds[0].filter(end=>end>from&&end<to).sort((a,b)=>a-b),to];
 return ends.slice(1).reduce((sum,end,i)=>sum+(end-ends[i])/1000*perkValue(t,0,ends[i]),0);
}
