import { EXTRA_HEROES, ARTIFACTS, MONSTERS, DAILY_TASKS, ACHIEVEMENTS, PERKS, ACTION_TYPES, type Effect } from './content.ts';
export { ARTIFACTS, MONSTERS, DAILY_TASKS, ACHIEVEMENTS, PERKS, ACTION_TYPES } from './content.ts';
export const HEROES = [
 {name:'萊恩',title:'森林遊俠',icon:'🏹',base:30,power:3},
 {name:'露娜',title:'月光法師',icon:'🔮',base:180,power:18},
 {name:'布洛克',title:'鐵壁守衛',icon:'🛡️',base:1100,power:110},
 {name:'凱拉',title:'赤焰劍士',icon:'🔥',base:6500,power:650},
 {name:'艾爾文',title:'風暴行者',icon:'⚡',base:38000,power:3900},
 {name:'芙蕾雅',title:'星辰祭司',icon:'🌟',base:230000,power:23000},
 {name:'奧瑞恩',title:'巨龍騎士',icon:'🐉',base:1400000,power:140000},
 {name:'妮克絲',title:'暗夜女王',icon:'🌙',base:8500000,power:850000},
 {name:'索爾',title:'雷霆之王',icon:'🔱',base:50000000,power:5200000},
 {name:'伊格尼斯',title:'不滅鳳凰',icon:'🦅',base:300000000,power:31000000},
 ...EXTRA_HEROES.map(([name,title,icon],i)=>({name,title,icon,base:1.8e9*6**i,power:1.86e8*6**i})),
];
export const SKILLS = [
 {name:'影分身',icon:'👥',desc:'自動點擊 8 次／秒，持續 15 秒',level:5,cooldown:90,duration:15},
 {name:'致命一擊',icon:'🎯',desc:'每次點擊造成暴擊，持續 15 秒',level:10,cooldown:90,duration:15},
 {name:'戰爭怒吼',icon:'📯',desc:'英雄傷害 × 5，持續 20 秒',level:20,cooldown:120,duration:20},
 {name:'狂戰之怒',icon:'⚔️',desc:'點擊傷害 × 10，持續 15 秒',level:30,cooldown:120,duration:15},
 {name:'黃金之手',icon:'✋',desc:'立即獲得目前關卡 30 隻怪物的金幣',level:40,cooldown:180,duration:0},
 {name:'天堂之擊',icon:'☄️',desc:'造成點擊傷害 × 500 的一擊',level:50,cooldown:180,duration:0},
];
export type Gear={id:number;slot:number;rarity:number;power:number;level:number};
export type Trial={kind:'dungeon'|'challenge';tier:number;wave:number;base:number;endAt:number;period:number};
export type State={version:2;stage:number;best:number;kills:number;hp:number;gold:number;level:number;heroes:number[];relics:number;artifacts:number[];prestiges:number;taps:number;totalKills:number;cooldowns:number[];active:number[];bossEnd:number;farming:boolean;last:number;lastTap:number;lastFairy:number;diamonds:number;weapons:number[];evolutions:number[];wounded:number[];skillLevels:number[];gear:Gear[];equipped:number[];dust:number;lootCounter:number;bossKills:number;bossWounded:boolean;protection:number;seen:number[];achievements:number[];daily:{day:number;claimed:number[];taps:number;kills:number;upgrades:number;skills:number;fairies:number;login:boolean;dungeons:number[]};loginDay:number;streak:number;trial:Trial|null;weekly:{week:number;best:number;claimed:number[]};world:number;worldBest:number[];artifactSpent:number[];log:string[]};
export type Action={type:typeof ACTION_TYPES[number];index?:number;amount?:number;at:number};
const CAP=1e240;
const limit=(n:number)=>Math.min(CAP,Math.max(0,Number.isFinite(n)?n:CAP));
export const dayAt=(time:number)=>Math.floor(time/86400000);
export const weekAt=(time:number)=>Math.floor((dayAt(time)+3)/7);
function newDaily(day:number):State['daily']{return {day,claimed:[],taps:0,kills:0,upgrades:0,skills:0,fairies:0,login:false,dungeons:[]};}
export function fresh(now=Date.now()):State {return {version:2,stage:1,best:1,kills:0,hp:18,gold:0,level:1,heroes:HEROES.map(()=>0),relics:0,artifacts:ARTIFACTS.map(()=>0),prestiges:0,taps:0,totalKills:0,cooldowns:SKILLS.map(()=>0),active:SKILLS.map(()=>0),bossEnd:0,farming:false,last:now,lastTap:0,lastFairy:now,diamonds:50,weapons:HEROES.map(()=>0),evolutions:HEROES.map(()=>0),wounded:HEROES.map(()=>0),skillLevels:SKILLS.map(()=>1),gear:[],equipped:[-1,-1,-1,-1,-1],dust:0,lootCounter:0,bossKills:0,bossWounded:false,protection:0,seen:[0],achievements:[],daily:newDaily(dayAt(now)),loginDay:-1,streak:0,trial:null,weekly:{week:weekAt(now),best:0,claimed:[]},world:0,worldBest:[1,1],artifactSpent:ARTIFACTS.map(()=>0),log:[]};}
export function hydrate(s:State):State{if(s.version===2&&s.heroes.length===33&&s.artifacts.length===30)return s;const base=fresh(s.last||Date.now());const original={...s};Object.assign(s,base,original,{version:2});for(const key of ['heroes','weapons','evolutions','wounded','artifacts','artifactSpent','skillLevels'] as const){const length=key==='artifacts'||key==='artifactSpent'?30:key==='skillLevels'?6:33;const old=original[key]||[];s[key]=Array.from({length},(_,i)=>Number.isFinite(old[i])?old[i]:key==='skillLevels'?1:0);}if(!original.artifactSpent)s.artifactSpent=s.artifacts.map((n,i)=>i<3?n*n:0);s.worldBest[0]=s.best;return s;}
export function note(s:State,message:string){s.log=[message,...s.log].slice(0,15);}
export function bonus(s:State,effect:Effect){return ARTIFACTS.reduce((sum,a,i)=>sum+(a.effect===effect?(s.artifacts[i]||0)*a.value:0),0);}
export function gearBonus(s:State,slot:number){const g=s.gear.find(g=>g.id===s.equipped[slot]);return g?g.power*(1+bonus(s,'gear')):0;}
export function passive(s:State,kind:number){return s.heroes.reduce((sum,level,i)=>sum+(i%3===kind?Math.floor(level/50)*.02:0),0);}
export function skillPower(s:State,i:number){return (1+(s.skillLevels[i]-1)*.25)*(1+bonus(s,'skill'));}
export function skillDuration(s:State,i:number){return SKILLS[i].duration*(1+bonus(s,'duration')+(s.skillLevels[i]-1)*.05);}
export function skillCooldown(s:State,i:number){return SKILLS[i].cooldown/(1+bonus(s,'cooldown'));}
export function critMultiplier(s:State){return 5*(1+bonus(s,'crit')+gearBonus(s,4))*(s.active[1]>s.last?skillPower(s,1):1);}
export function tapDamage(s:State){return limit((1+2*(s.level-1))*Math.pow(1.025,s.level-1)*(1+bonus(s,'all')+gearBonus(s,3))*(1+bonus(s,'tap')+gearBonus(s,0)+passive(s,0))*(s.active[3]>s.last?10*skillPower(s,3):1)*(1+s.world*.5));}
export function weaponSets(s:State){return Math.min(...s.weapons);}
export function heroDps(s:State,i:number){return s.wounded[i]>s.last?0:limit(HEROES[i].power*s.heroes[i]*1.035**s.heroes[i]*2**Math.floor(s.heroes[i]/25)*1e4**s.evolutions[i]*(1+s.weapons[i]*.5*(1+bonus(s,'weapon')))*(1+weaponSets(s)*9));}
export function dps(s:State){return limit(HEROES.reduce((v,_,i)=>v+heroDps(s,i),0)*(1+bonus(s,'all')+gearBonus(s,3))*(1+bonus(s,'hero')+gearBonus(s,1)+passive(s,1))*(s.active[2]>s.last?5*skillPower(s,2):1)*(1+s.world*.5));}
export function monsterIndex(s:State){return s.trial?(s.trial.wave*7+s.trial.tier*12)%60:((s.stage-1)*6+s.kills)%60;}
export function monsterCount(s:State){return Math.max(5,10-bonus(s,'monsters'));}
export function bossDuration(s:State){return 30+bonus(s,'bossTime');}
export function health(s:State){if(s.trial)return limit(18*1.32**(s.trial.base-1)*(s.trial.kind==='dungeon'?1+s.trial.wave*.22:1.48**s.trial.wave)*(s.trial.tier+1));return limit(18*1.32**(s.stage-1)*(isBoss(s)?9:1)*(s.world?25:1));}
export function isBoss(s:State){return !s.trial&&s.stage%5===0&&!s.farming;}
export function reward(s:State){return limit(5*1.27**(s.stage-1)*(1+bonus(s,'gold')+gearBonus(s,2)+passive(s,2))*(s.world?10:1));}
export function cost(s:State,index=-1,amount=1){const n=index<0?s.level:s.heroes[index],base=index<0?8:HEROES[index].base*1e4**s.evolutions[index],rate=index<0?1.12:1.13;return Math.ceil(limit(base*rate**(index<0?n-1:n)*(rate**amount-1)/(rate-1)));}
export function relicGain(s:State){return s.stage>=50?Math.max(1,Math.floor((Math.floor(s.stage/10)+Math.floor(s.heroes.reduce((a,b)=>a+b,0)/100))*(1+bonus(s,'relic'))*(1+s.world))):0;}
export function artifactCost(s:State,i:number){return Math.ceil(1+(i<3?0:i**1.15)+s.artifacts[i]*2);}
export function evolveCost(s:State,i:number){return limit(HEROES[i].base*1e4**s.evolutions[i]*1e6);}
export function skillCost(s:State,i:number){return Math.ceil(100*10**i*3**(s.skillLevels[i]-1));}
export function achievementProgress(s:State,i:number){const a=ACHIEVEMENTS[i];if(!a)return 0;if(a.metric==='hired')return s.heroes.filter((n,j)=>n>0||s.evolutions[j]>0).length;if(a.metric==='artifacts')return s.artifacts.filter(n=>n>0).length;return s[a.metric as 'taps'|'totalKills'|'best'|'prestiges'];}
function spawn(s:State){s.hp=health(s);s.bossEnd=isBoss(s)?s.last+bossDuration(s)*1000:0;s.bossWounded=false;const id=monsterIndex(s);if(!s.seen.includes(id))s.seen.push(id);}
function loot(s:State,quality=0){s.lootCounter++;const n=s.lootCounter;const roll=(n*37+s.best*11)%100;const rarity=Math.min(3,quality+(roll>95?3:roll>78?2:roll>40?1:0));const gear={id:n,slot:(n-1)%5,rarity,power:(.04+Math.floor(s.best/5)*.006)*(1+rarity*1.5),level:s.best};if(s.gear.length>=100){s.dust+=5*(rarity+1);note(s,'背包已滿，掉落裝備自動分解為星塵。');return;}s.gear.push(gear);if(s.equipped[gear.slot]===-1)s.equipped[gear.slot]=n;note(s,`獲得${['普通','稀有','史詩','傳說'][rarity]}裝備，已放入背包。`);}
function weapon(s:State){const i=(s.lootCounter*13+s.bossKills*7+s.daily.day)%33;s.weapons[i]++;note(s,`${HEROES[i].name}獲得武器強化 +1。`);}
function finishTrial(s:State,win:boolean){const trial=s.trial;if(!trial)return;if(trial.kind==='challenge'){s.weekly.best=Math.max(s.weekly.best,trial.wave);note(s,`本週試煉結束：擊敗 ${trial.wave} 隻巨獸。`);}else if(win&&trial.period===s.daily.day&&!s.daily.dungeons.includes(trial.tier)){s.daily.dungeons.push(trial.tier);s.diamonds+=20*(trial.tier+1);loot(s,trial.tier);weapon(s);note(s,`地下城通關，獲得 ${20*(trial.tier+1)} 鑽石、武器與裝備！`);}else note(s,'挑戰結束，可強化隊伍後再次出發。');s.trial=null;spawn(s);}
function damage(s:State,amount:number){if(!Number.isFinite(amount)||amount<=0)return;s.hp-=amount;if(s.hp>0)return;s.totalKills++;s.daily.kills++;if(s.trial){s.trial.wave++;if(s.trial.kind==='dungeon'&&s.trial.wave>=10)finishTrial(s,true);else spawn(s);return;}
 const boss=isBoss(s),chest=s.stage>=10&&monsterIndex(s)===7;const payout=reward(s)*(boss?10*(1+bonus(s,'bossGold')):chest?10*(1+bonus(s,'chest')):1);s.gold=limit(s.gold+payout);if(boss){s.bossKills++;if(s.bossKills%3===0)loot(s);if(s.bossKills%10===0){s.diamonds+=5;note(s,'擊敗十位頭目，獲得 5 鑽石。');}}
 s.kills++;if(!s.farming&&(boss||s.kills>=monsterCount(s))){s.stage=Math.min(1800,s.stage+1);s.best=Math.max(s.best,s.stage);s.worldBest[s.world]=Math.max(s.worldBest[s.world],s.stage);s.kills=0;}spawn(s);}
export function advance(s:State,to:number){hydrate(s);if(!Number.isFinite(to))return s;to=Math.max(s.last,to);const day=dayAt(to),week=weekAt(to);if(day>s.daily.day)s.daily=newDaily(day);if(week>s.weekly.week){if(s.trial?.kind==='challenge')finishTrial(s,false);s.weekly={week,best:0,claimed:[]};}const gap=to-s.last;
 if(gap>30000){if(s.trial){s.last=to;finishTrial(s,false);return s;}const seconds=Math.min(gap/1000,8*3600);s.gold=limit(s.gold+Math.min(dps({...s,last:to})/Math.max(1,health({...s,farming:true})),2)*reward(s)*seconds*.5*(1+bonus(s,'offline')));s.last=to;if(isBoss(s)){s.farming=true;s.kills=0;spawn(s);}return s;}
 while(s.last<to){const step=Math.min(100,to-s.last);s.last+=step;if(s.trial&&s.last>=s.trial.endAt){finishTrial(s,false);continue;}if(isBoss(s)&&s.bossEnd&&s.last>=s.bossEnd){s.farming=true;s.kills=0;spawn(s);note(s,'頭目逃走了，已切換金幣農場。');}
 if(isBoss(s)&&s.stage>=20&&!s.bossWounded&&s.protection<=s.last&&s.bossEnd-s.last<=15000){s.bossWounded=true;const i=s.heroes.findLastIndex((n,j)=>n>0&&s.wounded[j]<=s.last);if(i>=0){s.wounded[i]=s.last+60000/(1+bonus(s,'revive'));note(s,`${HEROES[i].name}負傷暫停攻擊，稍後自動復甦。`);}}
 damage(s,(dps(s)+(s.active[0]>s.last?tapDamage(s)*8*skillPower(s,0):0))*step/1000);}return s;}
export function apply(s:State,a:Action){advance(s,a.at);const i=a.index??0;
 if(a.type==='tap'&&s.last-s.lastTap>=45){s.lastTap=s.last;s.taps++;s.daily.taps++;damage(s,tapDamage(s)*(s.taps%10===0||s.active[1]>s.last?critMultiplier(s):1));}
 if(a.type==='upgrade'||a.type==='hero'){const id=a.type==='upgrade'?-1:i;if(id<-1||id>=HEROES.length||!Number.isInteger(id))return s;let count=a.amount??1;if(count===0){count=0;while(count<1000&&s.gold>=cost(s,id,count+1)&&(id<0?s.level:s.heroes[id])+count<2000)count++;}if(![1,10,25,100,1000,0].includes(a.amount??1)||count===0)return s;const price=cost(s,id,count);if(s.gold>=price&&(id<0?s.level:s.heroes[id])+count<=2000){s.gold-=price;s.daily.upgrades+=count;if(id<0)s.level+=count;else s.heroes[id]+=count;}}
 if(a.type==='skill'&&Number.isInteger(i)&&i>=0&&i<6){const k=SKILLS[i];if(s.level>=k.level&&s.cooldowns[i]<=s.last){s.cooldowns[i]=s.last+skillCooldown(s,i)*1000;s.active[i]=s.last+skillDuration(s,i)*1000;s.daily.skills++;if(i===4)s.gold=limit(s.gold+reward(s)*30*skillPower(s,i));if(i===5)damage(s,tapDamage(s)*500*skillPower(s,i));}}
 if(a.type==='artifact'&&Number.isInteger(i)&&i>=0&&i<30){const price=artifactCost(s,i);if(s.relics>=price&&s.artifacts[i]<ARTIFACTS[i].max){s.relics-=price;s.artifactSpent[i]+=price;s.artifacts[i]++;}}
 if(a.type==='prestige'&&relicGain(s)>0&&!s.trial){const gain=relicGain(s),reset=fresh(s.last);for(const key of ['best','artifacts','prestiges','taps','totalKills','diamonds','weapons','gear','equipped','dust','lootCounter','bossKills','seen','achievements','daily','loginDay','streak','weekly','world','worldBest','artifactSpent','log'] as const)Object.assign(reset,{[key]:structuredClone(s[key])});reset.prestiges++;reset.relics=s.relics+gain;reset.hp=health(reset);note(reset,`完成轉生，獲得 ${gain} 聖物。`);return reset;}
 if(a.type==='boss'&&s.farming&&!s.trial){s.farming=false;s.kills=0;spawn(s);}
 if(a.type==='fairy'&&s.last-s.lastFairy>=60000){s.lastFairy=s.last;s.daily.fairies++;s.gold=limit(s.gold+reward(s)*20*(1+bonus(s,'fairy')));if(s.daily.fairies%3===0){s.diamonds+=3;note(s,'仙女額外送來 3 鑽石。');}}
 if(a.type==='evolve'&&Number.isInteger(i)&&i>=0&&i<33&&s.heroes[i]>=100&&s.evolutions[i]<10&&s.gold>=evolveCost(s,i)){s.gold-=evolveCost(s,i);s.evolutions[i]++;s.heroes[i]=1;note(s,`${HEROES[i].name}完成進化，基礎傷害 ×10,000！`);}
 if(a.type==='skillUp'&&Number.isInteger(i)&&i>=0&&i<6&&s.level>=SKILLS[i].level&&s.skillLevels[i]<10&&s.gold>=skillCost(s,i)){s.gold-=skillCost(s,i);s.skillLevels[i]++;}
 if(a.type==='equip'){const g=s.gear.find(g=>g.id===i);if(g)s.equipped[g.slot]=g.id;}
 if(a.type==='salvage'){const g=s.gear.find(g=>g.id===i);if(g&&!s.equipped.includes(g.id)){s.dust+=5*(g.rarity+1);s.gear=s.gear.filter(g=>g.id!==i);}}
 if(a.type==='craft'&&s.dust>=50&&s.gear.length<100){s.dust-=50;loot(s,2);}
 if(a.type==='daily'&&!s.daily.login){s.streak=s.loginDay===s.daily.day-1?s.streak+1:1;s.loginDay=s.daily.day;s.daily.login=true;const amount=10+Math.min(7,s.streak)*5;s.diamonds+=amount;if(s.streak%7===0){loot(s,2);weapon(s);}note(s,`簽到第 ${s.streak} 天，獲得 ${amount} 鑽石。`);}
 if(a.type==='quest'){const task=DAILY_TASKS[i];if(task&&s.daily[task.metric]>=task.target&&!s.daily.claimed.includes(i)){s.daily.claimed.push(i);s.diamonds+=task.reward;note(s,`完成「${task.name}」，獲得 ${task.reward} 鑽石。`);}}
 if(a.type==='achievement'){const achievement=ACHIEVEMENTS[i];if(achievement&&!s.achievements.includes(i)&&achievementProgress(s,i)>=achievement.target){s.achievements.push(i);s.diamonds+=achievement.reward;note(s,`成就解鎖：${achievement.name}`);}}
 if(a.type==='perk'){const perk=PERKS[i];if(perk&&s.diamonds>=perk.price&&!(i===3&&s.trial)){s.diamonds-=perk.price;if(i===0)s.gold=limit(s.gold+reward(s)*100);if(i===1)s.cooldowns=SKILLS.map(()=>0);if(i===2)s.protection=s.last+600000;if(i===3)damage(s,s.hp);if(i===4)s.wounded=HEROES.map(()=>0);note(s,`使用道具：${perk.name}`);}}
 if(a.type==='revive'&&Number.isInteger(i)&&i>=0&&i<33&&s.wounded[i]>s.last&&s.diamonds>=5){s.diamonds-=5;s.wounded[i]=0;}
 if(a.type==='trial'&&Number.isInteger(i)&&i>=0&&i<=3&&!s.trial&&s.best>=5){if(i<3&&s.daily.dungeons.includes(i))return s;if(i===3&&s.prestiges<1)return s;s.trial={kind:i===3?'challenge':'dungeon',tier:i===3?0:i,wave:0,base:Math.max(1,Math.floor(Math.min(s.best,s.stage)*(i===3?.75:.5))),endAt:s.last+(i===3?120000:60000),period:i===3?s.weekly.week:s.daily.day};spawn(s);}
 if(a.type==='leaveTrial'&&s.trial)finishTrial(s,false);
 if(a.type==='trialReward'&&Number.isInteger(i)&&i>=0&&i<3&&s.weekly.best>=[5,10,20][i]&&!s.weekly.claimed.includes(i)){s.weekly.claimed.push(i);s.diamonds+=[30,60,100][i];loot(s,i);weapon(s);note(s,'已領取本週試煉里程碑獎勵。');}
 if(a.type==='world'&&Number.isInteger(i)&&i>=0&&i<2&&i!==s.world&&s.best>=300&&s.prestiges>=5&&!s.trial){s.world=i;s.stage=1;s.kills=0;s.farming=false;spawn(s);note(s,`進入${i?'法師世界':'劍士世界'}，永久收集品與隊伍力量保留。`);}
 if(a.type==='artifactSalvage'&&Number.isInteger(i)&&i>=0&&i<30&&s.artifacts[i]>0&&s.diamonds>=20){s.diamonds-=20;s.relics+=Math.floor(s.artifactSpent[i]*.5);s.artifacts[i]=0;s.artifactSpent[i]=0;note(s,'神器已重鑄，返還已投入聖物的 50%。');}
 return s;
}
export function fmt(n:number){if(n<1000)return Math.floor(n).toLocaleString('en-US');const units=['','K','M','B','T','Qa','Qi','Sx','Sp','Oc','No'];const e=Math.floor(Math.log10(Math.max(1,n))/3);return e<units.length?(n/Math.pow(1000,e)).toFixed(1)+units[e]:n.toExponential(1);}
