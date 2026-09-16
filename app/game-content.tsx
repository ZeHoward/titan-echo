'use client';
import {MONSTERS,monsterSheet} from '../lib/content';
export {default} from './tt2-panels';
export function MonsterSprite({id,basePath,className=''}:{id:number;basePath:string;className?:string}){const monster=MONSTERS[id%60];return <span role="img" aria-label={monster.name} className={`atlas-sprite ${className}`} style={{backgroundImage:`url("${basePath}${monsterSheet(id)}")`,backgroundPosition:`${monster.sprite%4/3*100}% ${Math.floor(monster.sprite/4)/2*100}%`,filter:`hue-rotate(${monster.variant*48}deg)`}}/>;}
