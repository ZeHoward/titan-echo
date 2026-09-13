import {effect,type TT2State} from './tt2-rules.ts';
// TT2 7.5.0 PerkInfo.csv; IDs here are stable web save indices.
export const RESOURCE_PERKS=[
 {id:'ManaPotion',name:'魔力藥水',icon:'🧪',cost:100,duration:43200000,values:[1.5,1.75,2,2.25],description:'立即補滿魔力，並提高魔力回復倍率。'},
 {id:'MakeItRain',name:'黃金雨',icon:'🌧️',cost:100,duration:43200000,values:[45,15,5,3],description:'定時使用現有金幣，自動招募及升級英雄。'},
] as const;
export function perkLevel(t:TT2State,i:number,now:number){return (t.perkEnds?.[i]||[]).filter(end=>end>now).length;}
export function perkLimit(t:TT2State){return Math.min(4,3+Math.max(0,Math.floor(effect(t,'PerkMaxLevel'))));}
export function perkValue(t:TT2State,i:number,now:number){const n=perkLevel(t,i,now);return n?RESOURCE_PERKS[i].values[Math.min(3,n-1)]:i===0?1:0;}
export function activatePerk(t:TT2State,i:number,now:number){
 if(!Number.isInteger(i)||!RESOURCE_PERKS[i]||perkLevel(t,i,now)>=perkLimit(t))return false;
 t.perkEnds[i]=t.perkEnds[i].filter(end=>end>now);t.perkEnds[i].push(now+RESOURCE_PERKS[i].duration);return true;
}
// Integrate expiry boundaries, so a potion cannot boost an entire offline
// interval after expiring partway through it.
export function manaSeconds(t:TT2State,from:number,to:number){
 const ends=[from,...t.perkEnds[0].filter(end=>end>from&&end<to).sort((a,b)=>a-b),to];
 return ends.slice(1).reduce((sum,end,i)=>sum+(end-ends[i])/1000*perkValue(t,0,ends[i]),0);
}
