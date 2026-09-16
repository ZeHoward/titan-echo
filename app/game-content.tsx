'use client';
import {MONSTERS,monsterSheet} from '../lib/content';
import {memo} from 'react';
import TT2Panels from './tt2-panels';
// The upgrade panel is the longest list on the page. Its props are a state snapshot and two
// callbacks; when the caller keeps all three stable, React skips the whole subtree.
export default memo(TT2Panels);
export function MonsterSprite({id,basePath,className='',scale=1}:{id:number;basePath:string;className?:string;scale?:number}){const monster=MONSTERS[id%60];return <span role="img" aria-label={monster.name} className={`atlas-sprite ${className}`} style={{backgroundImage:`url("${basePath}${monsterSheet(id)}")`,backgroundPosition:`${monster.sprite%4/3*100}% ${Math.floor(monster.sprite/4)/2*100}%`,filter:`hue-rotate(${monster.variant*48}deg)`,['--titan-scale' as string]:String(scale)}}/>;}
