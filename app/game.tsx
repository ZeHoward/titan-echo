'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserRequest, readBrowserSave, saveBrowserSnapshot } from '../lib/browser-storage';
import { Swords, Trophy, Sparkles, Volume2, VolumeX, Settings, X, Cloud, Download, HelpCircle, ChevronRight, Shield, Crown, Zap, RotateCcw, CircleUserRound } from 'lucide-react';
import { SKILLS, SKILL_ORDER, skillMana, manaMax, fresh, advance, apply, hydrate, health, isBoss, tapDamage, dps, relicGain, fmt, critMultiplier, monsterIndex, monsterCount, bossDuration, buildDamage, type State, type Action } from '../lib/engine';
import { ZERO, compare, ratio } from '../lib/big-number';
import { tutorialStep, tutorialProgress, tutorialText } from '../lib/engine';
import { MONSTERS, monsterSheet, sheetWarmOrder } from '../lib/content';
import { TT2_THEMES, themeIndex, themeStageRange } from '../lib/tt2-themes';
import { monsterScale, themesInBand } from '../lib/tt2-stages';
import GameContent, {MonsterSprite} from './game-content';
import CloudSave from './cloud-save';
import ReleaseNotes from './release-notes';
import {APP_VERSION} from '../lib/releases';
import {activeCombatPet,petRequiredTaps} from '../lib/tt2-pet-combat';
import {TT2_PETS} from '../lib/tt2-data';
import {PET_NAMES} from '../lib/zh-tw';
import {BATTLE_INTERVAL,clampFloat,PANEL_INTERVAL,panelDue,panelSyncsOn,redraws} from '../lib/ui-cadence';
import {AUDIO_DEFAULTS,type AudioSettings} from '../lib/audio';
import {DAMAGE_TEXT_DEFAULTS,DAMAGE_TEXT_OPTIONS,DAMAGE_TEXT_STORAGE_KEY,normaliseDamageText,showsDamageText,type DamageTextSettings} from '../lib/damage-text';
import {playCue,readAudioSettings,syncMusic,writeAudioSettings} from './sound';

// The display options live beside the volumes: per browser, not in the save, since they say nothing
// about progress. Storage can be blocked, so a failed read just shows every number.
function readDamageText():DamageTextSettings{
 try{const stored=window.localStorage.getItem(DAMAGE_TEXT_STORAGE_KEY);return normaliseDamageText(stored===null?null:JSON.parse(stored));}
 catch{return normaliseDamageText(null);}
}
function writeDamageText(settings:DamageTextSettings){
 try{window.localStorage.setItem(DAMAGE_TEXT_STORAGE_KEY,JSON.stringify(settings));}
 catch{/* Private windows and blocked storage: the setting just does not survive a reload. */}
}

// A stage holds 8 titans early on and 120 at the level cap, so the dots stop being readable at
// some point. Up to a dozen they are the clearest thing to draw; past that the same progress is a
// bar, and the exact count is already spelled out above the monster.
const WAVE_DOT_LIMIT=12;
// How long a damage number stays up. The clone swings four times a second, so its number has to
// clear before the next three arrive; everything else keeps the original 850ms.
const FLOAT_LIFE:Record<string,number>={clone:420};
function WaveProgress({killed,total}:{killed:number;total:number}){
 if(total<=WAVE_DOT_LIMIT)return <div className="wave-dots">{Array.from({length:total},(_,i)=><i key={i} className={i<killed?'done':''}/>)}</div>;
 return <div className="wave-bar"><div style={{width:`${Math.min(100,killed/total*100)}%`}}/></div>;
}

type GameResponse={state:State;revision:number;name:string;now:number;offlineGold:import('../lib/big-number').Big;error?:string};
type Row={name:string;best:number;prestiges:number;mine:boolean};
export default function Game({pagesMode=false,basePath='/'}:{pagesMode?:boolean;basePath?:string}){
 const request=pagesMode?browserRequest:fetch;
 const savedLabel=pagesMode?'本機已儲存':'雲端已儲存';
 const state=useRef<State>(fresh());const queue=useRef<Action[]>([]);const revision=useRef(0);const userRef=useRef(false);const busy=useRef(false);const clockOffset=useRef(0);
 const [s,setS]=useState<State>(()=>fresh());const [panelState,setPanelState]=useState<State>(()=>fresh());const panelAt=useRef(0);const [tab,setTab]=useState('heroes');const [user,setUser]=useState<string|null>(null);const [sync,setSync]=useState('連線中');const [modal,setModal]=useState('');const [name,setName]=useState('');const [notice,setNotice]=useState('');const [rows,setRows]=useState<Row[]>([]);const [rankError,setRankError]=useState('');const [volumes,setVolumes]=useState<AudioSettings>(()=>({...AUDIO_DEFAULTS}));const [damageText,setDamageText]=useState<DamageTextSettings>(()=>({...DAMAGE_TEXT_DEFAULTS}));const [hit,setHit]=useState(0);const [floats,setFloats]=useState<{id:number,x:number,y:number,text:string,crit:boolean,kind:string}[]>([]);const [ready,setReady]=useState(false);
 const actRef=useRef<(a:Omit<Action,'at'>)=>void>(()=>{});
 function toast(text:string){setNotice(text);setTimeout(()=>setNotice(''),3500);}
  const volumesRef=useRef(volumes);volumesRef.current=volumes;
 const damageTextRef=useRef(damageText);damageTextRef.current=damageText;
 // Sounds that follow the battle rather than a button. The first pass only records where things
 // stand, so loading a save mid-boss does not fire every cue at once.
 const watched=useRef({stage:-1,boss:false,gear:-1});
 // The clone's swing happens inside advance(), not in response to a button, so the number it earns
 // has to be noticed after the fact. The first pass only records the count: loading a save that was
 // written mid-skill must not print the swing it already took.
 const seenCloneAttacks=useRef(-1);
 function watchForClone(s:State){const count=s.tt2!.cloneAttacks;
  // Four a second at one fixed spot would stack into an unreadable pile, so each swing lands near
  // the clone rather than exactly on it, and its number fades faster than a tap's.
  if(seenCloneAttacks.current>=0&&count>seenCloneAttacks.current)
   float(`🌑 ${fmt(s.tt2!.lastCloneHit)}`,'clone',32+Math.random()*12-6,30+Math.random()*10-5);
  seenCloneAttacks.current=count;}
 function watchForCues(s:State){const seen=watched.current,boss=isBoss(s),gear=s.tt2!.equipmentCollected;
  if(seen.stage>=0){if(s.stage>seen.stage)cue('victory');if(boss&&!seen.boss)cue('boss');if(gear>seen.gear)cue('drop');}
  watched.current={stage:s.stage,boss,gear};}
 function cue(name:Parameters<typeof playCue>[0]){playCue(name,volumesRef.current);}
 // Which action earns which sound. Anything not listed stays silent rather than sharing a cue.
 const ACTION_CUES:Partial<Record<Action['type'],Parameters<typeof playCue>[0]>>={skill:'skill',upgrade:'upgrade',hero:'upgrade',skillUp:'upgrade',evolve:'upgrade',talent:'upgrade',artifact:'upgrade',discover:'drop',craft:'drop',equip:'drop',fairy:'drop',prestige:'prestige'};
 function act(a:Omit<Action,'at'>){if(!ready)return;const action={...a,at:Date.now()+clockOffset.current};const before=state.current.log[0];const strikes=state.current.tt2?.heavenlyStrikes||0;state.current=apply(state.current,action);if(state.current.log[0]&&state.current.log[0]!==before)toast(state.current.log[0]);if(userRef.current)queue.current.push(action);const sound=ACTION_CUES[a.type];if(sound)cue(sound);
  if(a.type==='skill'&&(state.current.tt2?.heavenlyStrikes||0)>strikes)float(`☄️ ${fmt(buildDamage(state.current,'heavenly'))}`,'heavenly',50,24);
  setS({...state.current});if(panelSyncsOn(a.type))showPanel(action.at);}
 function showPanel(now:number){panelAt.current=now;setPanelState({...state.current});}
 // Damage that is not the tap itself still has to be visible, or the builds look like they do
 // nothing: the pet swipe and the heavenly strike each get their own number.
 // A number is centred on where it happened, so near an edge half of it would fall outside the
 // battle area and be cut off by its overflow. The band is measured from the arena rather than
 // fixed, because the same percentage is a very different distance on a phone and on a desktop.
 // Each source can be turned off on its own, the way the original splits the option per damage
 // source rather than offering one switch for all of them.
 function float(text:string,kind:string,x=50,y=42){if(!showsDamageText(damageTextRef.current,kind))return;const id=performance.now()+Math.random();
  const safe=clampFloat(x,arena.current?.offsetWidth||0);
  setFloats(f=>[...f.slice(-15),{id,x:safe,y,text,crit:kind==='crit',kind}]);
  setTimeout(()=>setFloats(f=>f.filter(a=>a.id!==id)),FLOAT_LIFE[kind]??850);}
 // The panel's own props never change identity, so a frame that leaves the snapshot alone costs
 // nothing: React compares the three and skips the subtree.
 const panelAct=useCallback((a:Omit<Action,'at'>)=>actRef.current(a),[]);
 const openPrestige=useCallback(()=>setModal('prestige'),[]);
 actRef.current=act;
 function strike(x=50,y=42){if(!ready)return;const attacks=state.current.tt2?.petAttacks||0;act({type:'tap'});const t=state.current.tt2;const crit=t?.lastCrit||false;setHit(h=>h+1);cue(crit?'crit':'tap');float(fmt(t?.lastHit||0),crit?'crit':'tap',x,y);
  // chargePet() fires on the tap that fills the meter, so the swipe lands on this same frame.
  if(t&&t.petAttacks>attacks){cue('skill');float(`⚡ ${fmt(t.lastPetHit)}`,'pet',Math.min(92,x+18),Math.max(8,y-16));}}
 async function save(){
  if(!userRef.current||busy.current)return;busy.current=true;
  const batch=queue.current.splice(0,pagesMode?queue.current.length:250);setSync('儲存中');
  try{
   if(pagesMode){
    const saved=await saveBrowserSnapshot(state.current,revision.current,crypto.randomUUID());
    revision.current=saved.revision;
    // Saving acknowledges a snapshot, never replaces the live simulation.
   }else{
    const res=await request('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:revision.current,actions:batch}),keepalive:true});
    const data=await res.json() as GameResponse;
    if(res.status===409)throw Error('LOCAL_CONFLICT');
    if(!res.ok)throw Error(data.error||'暫時無法同步');
    revision.current=data.revision;let next=data.state;
    for(const a of queue.current)next=apply(next,{...a,at:Math.max(next.last,a.at)});
    state.current=advance(next,Date.now()+clockOffset.current);setS({...state.current});showPanel(Date.now()+clockOffset.current);
   }
   setSync(savedLabel);
  }catch(error){
   queue.current.unshift(...batch);
   if(error instanceof Error&&error.message==='LOCAL_CONFLICT'){
    userRef.current=false;setReady(false);setModal('conflict');setSync('其他分頁已有新進度・已暫停');
   }else setSync('儲存失敗・將自動重試');
  }finally{busy.current=false;}
 }
 const arena=useRef<HTMLButtonElement|null>(null);
 const warmed=useRef(new Set<string>());
 function warmImage(file:string){const url=basePath+file;if(warmed.current.has(url))return;warmed.current.add(url);const img=new Image();img.src=url;void img.decode().catch(()=>{});}
 // The five sprite sheets are 3.5MB together. Fetching them all at mount held up the sheet the
 // player is actually looking at. Only that one is fetched up front; the rest follow while the tab
 // is idle, nearest-needed first, so a monster switch still never waits for a cold sheet.
 const currentSheet=ready?monsterSheet(monsterIndex(s)):'';
 useEffect(()=>{if(currentSheet)warmImage(currentSheet);},[currentSheet,basePath]);
 // Volumes are a device preference, not save data: the same account on a phone and a desktop
 // wants different levels, and the save format is shared with the cloud sheet.
 useEffect(()=>{setVolumes(readAudioSettings());setDamageText(readDamageText());},[]);
 useEffect(()=>{writeDamageText(damageText);},[damageText]);
 useEffect(()=>{writeAudioSettings(volumes);syncMusic(volumes);},[volumes]);
 useEffect(()=>{if(!ready)return;const order=sheetWarmOrder(monsterIndex(state.current));const idle=typeof window.requestIdleCallback==='function';let at=0,handle=0;const step=()=>{if(at>=order.length)return;warmImage(order[at++]);handle=idle?window.requestIdleCallback(step,{timeout:3000}):window.setTimeout(step,500);};handle=idle?window.requestIdleCallback(step,{timeout:3000}):window.setTimeout(step,1500);return()=>{if(idle)window.cancelIdleCallback(handle);else clearTimeout(handle);};},[ready,basePath]);
 useEffect(()=>{let alive=true;request('/api/game').then(async r=>{if(r.status===401){if(alive){setSync('訪客試玩・不保存');setReady(true);}return;}if(!r.ok)throw Error();const data=await r.json() as GameResponse;if(!alive)return;clockOffset.current=data.now-Date.now();state.current=hydrate(data.state);revision.current=data.revision;userRef.current=true;setUser(data.name);setName(data.name);setS({...data.state});showPanel(Date.now()+clockOffset.current);setSync(savedLabel);setReady(true);if(compare(data.offlineGold,ZERO)>0)toast(`歡迎回來！英雄帶回 ${fmt(data.offlineGold)} 金幣`);}).catch(()=>{if(alive){setSync(pagesMode?'瀏覽器儲存不可用・不保存':'離線試玩・不保存');setReady(true);}});return()=>{alive=false;};},[]);
 // The simulation keeps its 100ms cadence whatever the tab is doing; a hidden tab only skips the
 // redraw, so backgrounded play still earns at the live rate instead of falling to offline pay.
 useEffect(()=>{if(!ready||modal==='cloud')return;const tick=setInterval(()=>{const now=Date.now()+clockOffset.current;advance(state.current,now);if(!redraws(document.visibilityState))return;watchForCues(state.current);watchForClone(state.current);setS({...state.current});if(panelDue(now,panelAt.current))showPanel(now);},BATTLE_INTERVAL);const saving=setInterval(()=>void save(),3000);const visibility=()=>{const now=Date.now()+clockOffset.current;if(document.visibilityState==='hidden'){void save();return;}advance(state.current,now);setS({...state.current});showPanel(now);};document.addEventListener('visibilitychange',visibility);return()=>{clearInterval(tick);clearInterval(saving);document.removeEventListener('visibilitychange',visibility);};},[ready,modal]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{const target=e.target as HTMLElement|null;if(target?.matches?.('input,textarea,button,a')||modal)return;if(e.code==='Space'){e.preventDefault();if(!e.repeat)strike();}if(/^[1-6]$/.test(e.key))actRef.current({type:'skill',index:SKILL_ORDER[Number(e.key)-1]});};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[modal,ready]);
 useEffect(()=>{if(modal!=='rank')return;let live=true;setRankError('');const load=()=>request('/api/leaderboard').then(r=>{if(!r.ok)throw Error();return r.json() as Promise<{rows:Row[]}>;}).then(d=>{if(live)setRows(d.rows);}).catch(()=>{if(live)setRankError('排行榜暫時無法載入，請稍後重試。');});void load();const t=setInterval(load,10000);return()=>{live=false;clearInterval(t);};},[modal]);
 useEffect(()=>{const mc=(document as unknown as {modelContext?:{registerTool:(t:unknown,o:unknown)=>void}}).modelContext;if(!mc)return;const controller=new AbortController();mc.registerTool({name:'titan_status',description:'Read the current adventure, hero levels and available upgrades.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true},execute:()=>({stage:state.current.stage,gold:state.current.gold,level:state.current.level,heroes:state.current.heroes})},{signal:controller.signal});mc.registerTool({name:'titan_upgrade',description:'Spend earned gold to upgrade the sword master or a hired hero.',inputSchema:{type:'object',properties:{heroIndex:{type:'integer',minimum:-1,maximum:32}},required:['heroIndex']},execute:(input:unknown)=>{const i=(input as {heroIndex:number}).heroIndex;if(!Number.isInteger(i)||i<-1||i>32)throw Error('Invalid hero');actRef.current({type:i<0?'upgrade':'hero',index:i,amount:1});return {gold:state.current.gold,level:state.current.level,heroes:state.current.heroes};}},{signal:controller.signal});return()=>controller.abort();},[]);
 const combatPet=activeCombatPet(s.tt2!);
 const theme=themeIndex(s.stage),region=theme%10;const boss=isBoss(s);const monster=MONSTERS[monsterIndex(s)];const seconds=Math.max(0,Math.ceil(((s.trial?.endAt??s.bossEnd)-s.last)/1000));const fairy=s.last-s.lastFairy>=60000;
 async function exportBeforeMigration(){try{const backup=await readBrowserSave('before-tt2-migration');const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='titan-echo-before-tt2.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{toast('這個瀏覽器沒有修正前的存檔備份');}}
 function exportSave(){const blob=new Blob([JSON.stringify({game:'Titan Echo',version:2,exported:new Date().toISOString(),state:s},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='titan-echo-save.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已匯出冒險紀錄');}
 async function rename(){if(!name.trim())return;try{const r=await request('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});if(!r.ok)throw Error();setUser(name.trim());toast('冒險者名稱已更新');setModal('');}catch{toast('名稱更新失敗，請重試');}}
 async function openCloud(){if(busy.current){toast('正在保存，請稍後再試');return;}await save();if(!userRef.current)return;if(queue.current.length){toast('請先完成本機儲存，再開啟雲端存檔');return;}setModal('cloud');}
 return <main className="game-shell">
  <header className="topbar"><a className="brand" href={basePath} aria-label="泰坦遠征首頁"><span className="brand-mark"><Swords size={26}/></span><span>泰坦<span className="brand-gold"> 遠征</span><small>泰 坦 遠 征</small></span></a><div className="top-center"><span className="live-dot"/> 放置冒險 <span className="divider">/</span> 第 {s.prestiges+1} 次遠征</div><div className="top-actions"><button onClick={()=>setModal('rank')}><Trophy size={18}/><span>{pagesMode?'本機紀錄':'排行榜'}</span></button><button aria-label={volumes.effects>0?'關閉音效':'開啟音效'} onClick={()=>setVolumes(v=>({...v,effects:v.effects>0?0:0.6}))}>{volumes.effects>0?<Volume2 size={19}/>:<VolumeX size={19}/>}</button><button aria-label="設定" onClick={()=>setModal('settings')}><Settings size={19}/></button><button className="profile" onClick={()=>setModal('account')}><CircleUserRound size={22}/><span>{user||'訪客冒險者'}</span></button></div></header>
  <div className="main-grid">
   <aside className="journey-panel"><div className="eyebrow">遠征紀事</div><h1>遠征日誌</h1><div className="journey-art"><Swords size={40}/><span>劍士之路</span><small>每一次揮劍，都更接近傳說。</small></div><div className="journey-stat"><span>最高關卡</span><strong>{String(s.best).padStart(3,'0')}</strong></div><div className="journey-stat"><span>累計擊敗</span><strong>{fmt(s.totalKills)}</strong></div><div className="journey-stat"><span>轉生次數</span><strong>{s.prestiges}</strong></div><div className="section-line"/><div className="eyebrow">世界地圖</div><div className="world-list">{TT2_THEMES.slice(0,themesInBand(s.stage)).map((t,i)=>{const {first,last}=themeStageRange(i,s.stage);return <div key={t.id} className={theme===i?'world active':'world'}><span className="world-node">{theme===i?'◆':i+1}</span><div>{t.name}<small>關卡 {first}—{last}</small></div>{theme===i&&<ChevronRight size={16}/>}</div>;})}</div><button className="help-link" onClick={()=>setModal('help')}><HelpCircle size={17}/> 冒險指南 <span>↗</span></button><button className="version version-link" onClick={()=>setModal('updates')} aria-label={`查看版本 ${APP_VERSION} 更新紀錄`}>網頁版 {APP_VERSION} · 更新紀錄<br/><span>點擊泰坦二代 7.5 規則校正中</span></button></aside>
   <section className={`battle-panel region-${region}`} aria-label="戰鬥區">
    <div className="battle-bg world-atlas" style={{backgroundImage:`url("${basePath}worlds-atlas.webp")`,backgroundPosition:`${region%5/4*100}% ${Math.floor(region/5)*100}%`}}/><div className="battle-shade"/><div className="stage-top"><button className="zone-tag" onClick={()=>setModal('help')}>✦ {s.trial?(s.trial.kind==='dungeon'?'每日地下城':'極限試煉'):TT2_THEMES[theme].name}</button><div className="stage-number"><span>關卡</span><strong>{String(s.stage).padStart(3,'0')}</strong></div><span className="wave-tag">{s.trial?`第 ${s.trial.wave+1} 波`:boss?'⚔ 頭目戰':s.farming?'金幣農場':`${s.kills+1} / ${monsterCount(s)}`}</span></div>
    <div className="currency"><div><span className="coin">金</span><strong>{fmt(s.gold)}</strong><small>金幣</small></div><div><span className="relic">◆</span><strong>{fmt(s.relics)}</strong><small>聖物</small></div><button className="diamond-wallet" onClick={()=>setTab('shop')} title="開啟旅人商店">💎<strong>{fmt(s.diamonds)}</strong></button></div>
    <div className="enemy-health"><div><span>{boss?'♛ ':''}{monster.name}</span><small>{fmt(s.hp)} / {fmt(health(s))}</small></div><div className="hp-track"><div style={{width:`${Math.max(0,ratio(s.hp,health(s))*100)}%`}}/></div>{boss||s.trial?<div className="boss-clock"><span>⏳ {seconds} 秒</span><div style={{width:`${seconds/(s.trial?(s.trial.kind==='dungeon'?60:120):bossDuration(s))*80}%`}}/></div>:<WaveProgress killed={s.kills} total={monsterCount(s)}/>}</div>
    <button ref={arena} className="monster-target" aria-label="攻擊泰坦（也可按空白鍵）" disabled={!ready} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();strike((e.clientX-rect.left)/rect.width*100,(e.clientY-rect.top)/rect.height*100);}} onClick={e=>{if(e.detail===0)strike();}}><span className="monster-shadow"/>{ready&&<MonsterSprite key={`${monster.id}-${hit}`} id={monster.id} basePath={basePath} scale={monsterScale(s.stage)} className={`monster ${hit?'struck':''} ${boss?'boss':''}`}/>}{floats.map(f=><span key={f.id} className={`damage-number ${f.kind}`} style={{left:`${f.x}%`,top:`${f.y}%`}}>{f.crit?'暴擊 ':''}{f.text}</span>)}<img key={"hero-"+hit} className={`swordsman ${hit?"swing":""}`} src={`${basePath}swordsman.webp`} alt="劍術大師" draggable={false}/><span className="tap-ring"/><span className="tap-prompt">{ready?'點擊巨獸，揮劍出擊':'正在準備遠征…'}</span></button>
    <button className="pet-combat-status" onClick={()=>setTab('collection')} aria-label="查看寵物戰鬥與收藏">{combatPet>=0?<><strong>⚡ {PET_NAMES[TT2_PETS[combatPet].name]}</strong><span>蓄力 {s.tt2!.petCharge} / {petRequiredTaps(s.tt2!)}</span><progress max={petRequiredTaps(s.tt2!)} value={s.tt2!.petCharge} aria-label="寵物攻擊蓄力"/>{compare(s.tt2!.lastPetHit,ZERO)>0&&<small>上次攻擊 {fmt(s.tt2!.lastPetHit)}</small>}</>:<><strong>寵物攻擊</strong><span>取得並派出傷害寵物後啟用</span></>}</button>
    {fairy&&<button className="fairy" title="領取仙女金幣" onClick={()=>act({type:'fairy'})}>🧚<small>點我領金幣</small></button>}
    {s.farming&&!s.trial&&<button className="retry-boss" onClick={()=>act({type:'boss'})}><Swords size={16}/> 再次挑戰頭目</button>}
    {s.trial&&<button className="trial-exit" onClick={()=>act({type:'leaveTrial'})}>退出挑戰</button>}<div className="battle-bottom"><div className="damage-stats"><div><Swords size={18}/><span>點擊傷害<strong>{fmt(tapDamage(s))}</strong></span></div><div><Zap size={18}/><span>英雄每秒傷害<strong>{fmt(dps(s))}</strong></span></div></div><div className="skill-bar">{SKILL_ORDER.map(i=>{const k=SKILLS[i];const cd=Math.max(0,Math.ceil((s.cooldowns[i]-s.last)/1000)),locked=s.level<k.level||s.skillLevels[i]===0,active=s.active[i]>s.last;return <button key={k.name} className={`skill ${active?'skill-active':''}`} disabled={!ready||locked||cd>0||(s.tt2?.mana||0)<skillMana(s,i)} onClick={()=>act({type:'skill',index:i})} title={`${k.name}：${k.desc}。劍士 等級 ${k.level} 解鎖；冷卻 ${k.cooldown} 秒。`}><span>{k.icon}</span><small>{locked?`等級 ${k.level}`:cd?`${cd} 秒`:k.name}</small><kbd>{SKILL_ORDER.indexOf(i)+1}</kbd></button>;})}</div><div className="battle-caption"><span>魔力 {(s.tt2?.mana||0).toFixed(0)} / {manaMax(s).toFixed(0)}</span>{tutorialStep(s)&&<span className="tutorial-hint">{tutorialText(s)}{tutorialStep(s)!.showProgress?` · ${Math.min(tutorialProgress(s),tutorialStep(s)!.amount)} / ${tutorialStep(s)!.amount}`:''}</span>}<span className="live-dot"/> 英雄自動戰鬥中 <span>空白鍵攻擊 · 1–6 技能</span></div></div>
   </section>
   <section className="upgrade-panel"><div className="panel-header"><div><div className="eyebrow">強化戰力</div><h2>集結你的力量</h2></div><Shield size={25}/></div><div className="tabs" role="tablist" aria-label="升級類別">{[['heroes','英雄',Swords],['artifacts','神器',Sparkles],['skills','技能',Zap],['equipment','裝備',Shield],['adventure','技能樹',Crown],['collection','收藏',Trophy],['shop','商店',Sparkles],['prestige','轉生',RotateCcw]].map(([id,label,Icon])=><button key={id as string} role="tab" aria-selected={tab===id} onClick={()=>setTab(id as string)} className={tab===id?'selected':''}>{typeof Icon!=='string'&&<Icon size={16}/>} {label as string}</button>)}</div>
    <div className="panel-content"><GameContent s={panelState} tab={tab} ready={ready} basePath={basePath} act={panelAct} onPrestige={openPrestige}/></div><div className="save-status"><Cloud size={15}/><span>{sync}</span>{user?<button onClick={()=>void save()}>立即儲存</button>:pagesMode?<button onClick={exportSave}>匯出紀錄</button>:<a href="/signin-with-chatgpt?return_to=%2F" target="_top">登入保存 →</a>}</div>
   </section>
  </div><footer className="page-footer"><button onClick={()=>setModal('updates')}>版本 {APP_VERSION} · 更新紀錄</button><span>✦ 冒險永不止步</span><span>每關擊敗普通泰坦後迎戰頭目。</span><button onClick={()=>setModal('help')}>遊戲說明</button><a href="https://zehoward.github.io/titan-echo/" target="_blank" rel="noreferrer">公開網頁最新版 ↗</a></footer>
  {notice&&<div className="toast" role="status">✦ {notice}</div>}
  {pagesMode&&ready&&<CloudSave open={modal==='cloud'} basePath={basePath} onClose={()=>setModal('')}/>}
  {modal&&modal!=='cloud'&&<div className="modal-backdrop" onClick={()=>{if(modal!=='conflict')setModal('');}}><section className="modal" role="dialog" aria-modal="true" aria-label={modal==='updates'?'版本與更新紀錄':modal==='rank'?'遠征排行榜':'冒險選單'} onClick={e=>e.stopPropagation()}><button className="close" disabled={modal==='conflict'} onClick={()=>setModal('')} aria-label="關閉"><X/></button>{modal==='updates'?<ReleaseNotes basePath={basePath}/>:modal==='conflict'?<><h2>另一個分頁已更新存檔</h2><p>已暫停這個分頁，避免覆蓋你的進度。你可以先匯出目前畫面的紀錄，再重新載入最新存檔。</p><button className="outline-button" onClick={exportSave}>匯出目前紀錄</button><button className="primary-button" onClick={()=>window.location.reload()}>載入最新存檔</button></>:modal==='rank'?<><Trophy className="modal-icon"/><div className="eyebrow">傳奇殿堂</div><h2>{pagesMode?'本機冒險紀錄':'遠征排行榜'}</h2><p>{pagesMode?'僅限這個瀏覽器，不是全球排行榜。':'依最高關卡排序 · 每 10 秒更新'}</p>{rankError?<p role="alert">{rankError}</p>:rows.length?<div className="rank-list">{rows.map((r,i)=><div key={i} className={r.mine?'mine':''}><strong>{i<3?['🥇','🥈','🥉'][i]:i+1}</strong><span>{r.name}{r.mine?'（你）':''}<small>轉生 {r.prestiges} 次</small></span><b>{r.best}<small>最高關卡</small></b></div>)}</div>:<div className="empty"><Crown/><p>傳說，等待第一位冒險者。</p><small>登入並開始遊玩，你的紀錄就會出現在這裡。</small></div>}</>:modal==='prestige'?<><Sparkles className="modal-icon"/><h2>準備展開新的遠征？</h2><p>將重置關卡、金幣、劍士／英雄等級、進化與技能等級，獲得 <b>{relicGain(s)} 聖物</b>。神器、技能樹、鑽石與最高紀錄保留，舊收藏封存。</p><button className="primary-button" onClick={()=>{act({type:'prestige'});setModal('');toast('轉生完成！前往神器頁強化永久力量。');setTab('artifacts');}}>確認轉生</button></>:modal==='account'&&pagesMode&&!user?<><h2>瀏覽器儲存不可用</h2><p>請允許此網站使用本機儲存空間，再重新整理。這段試玩進度不會保存。</p><button className="primary-button" onClick={exportSave}>匯出目前紀錄</button></>:modal==='account'?<><CircleUserRound className="modal-icon"/><h2>{user?'冒險者檔案':'讓冒險留下紀錄'}</h2>{user?<><p>{pagesMode?'進度自動儲存在此瀏覽器；可於設定開啟 雲端存檔，使用恢復碼跨裝置載入。':'你的存檔跟隨登入帳號，跨裝置同步。'}</p><label>{pagesMode?'冒險者名稱':'排行榜顯示名稱'}<input value={name} maxLength={24} onChange={e=>setName(e.target.value)}/></label><button className="primary-button" disabled={!name.trim()} onClick={()=>void rename()}>儲存名稱</button>{!pagesMode&&<a className="text-link" href="/signout-with-chatgpt?return_to=%2F" target="_top">登出帳號</a>}</>:<><p>登入你的冒險帳號，擁有獨立雲端存檔與排行榜紀錄。訪客試玩進度不會保留或轉入帳號。</p><a className="primary-button" href="/signin-with-chatgpt?return_to=%2F" target="_top">登入並建立冒險</a></>}</>:modal==='settings'?<><Settings className="modal-icon"/><h2>遊戲設定</h2><button className="setting-row" onClick={()=>setModal('updates')}>版本與更新紀錄<strong>{APP_VERSION}</strong></button>{pagesMode&&<button className="setting-row" onClick={()=>void openCloud()}>雲端存檔<Cloud size={18}/></button>}{([['master','總音量'],['effects','戰鬥音效'],['music','背景音樂']] as const).map(([key,label])=><label key={key} className="setting-row volume-row"><span>{label}</span><input type="range" min="0" max="100" step="5" value={Math.round(volumes[key]*100)} aria-label={label} onChange={e=>{const next={...volumes,[key]:Number(e.target.value)/100};setVolumes(next);if(key!=='music')playCue('upgrade',next);}}/><strong>{Math.round(volumes[key]*100)}</strong></label>)}{DAMAGE_TEXT_OPTIONS.map(option=><label key={option.key} className="setting-row toggle-row"><span>{option.label}</span><input type="checkbox" checked={damageText[option.key]} aria-label={option.label} onChange={e=>setDamageText({...damageText,[option.key]:e.target.checked})}/></label>)}{pagesMode&&<button className="setting-row" onClick={()=>void exportBeforeMigration()}>匯出 點擊泰坦二代 修正前完整備份<Download size={18}/></button>}<button className="setting-row" onClick={exportSave}>匯出冒險紀錄（備份檔）<Download size={18}/></button><p>{pagesMode?'匯出檔供檢視與備份留存。雲端存檔需由管理員完成部署後啟用。':'匯出檔供備份與檢視。排行榜使用伺服器驗證的遊戲操作，無法匯入修改過的紀錄。'}</p><button className="setting-row" onClick={()=>setModal('account')}>{pagesMode?'本機存檔':'帳號與雲端存檔'}<ChevronRight size={18}/></button></>:<><Swords className="modal-icon"/><h2>冒險指南</h2><div className="guide"><p><b>版本基準</b>依巴哈攻略及 點擊泰坦二代 7.5 資料校正。神器效果、六技能與魔力已改寫；仍非完整原版重製。</p><p><b>戰鬥</b>點擊或空白鍵攻擊。每關先清普通泰坦，再挑戰 30 秒頭目，失敗後可農金幣並重試。</p><p><b>神器</b>第 60 關後蛻變，用聖物隨機取得 103 件神器。不同神器作用於不同流派、金源和技能。</p><p><b>技能</b>施法消耗魔力，逐級效果與費用依 7.5 資料。技能樹在右側頁籤。</p><p><b>存檔</b>進度自動保存。原版相容修正前的本機紀錄已備份；雲端連線繼續使用原設定。</p><p><b>尚待還原</b>寵物、公會、完整六流派、裝備掉落、鍛造、錦標賽、逐級成長與關卡曲線。<a href={`${basePath}rules.html`} target="_blank" rel="noreferrer">查看完整核對紀錄</a></p></div><button className="primary-button" onClick={()=>setModal('')}>開始冒險</button></>}</section></div>}
 </main>;
}
