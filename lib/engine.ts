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
];
export const SKILLS = [
 {name:'影分身',icon:'👥',desc:'自動點擊 8 次／秒，持續 15 秒',level:5,cooldown:90,duration:15},
 {name:'致命一擊',icon:'🎯',desc:'每次點擊造成暴擊，持續 15 秒',level:10,cooldown:90,duration:15},
 {name:'戰爭怒吼',icon:'📯',desc:'英雄傷害 × 5，持續 20 秒',level:20,cooldown:120,duration:20},
 {name:'狂戰之怒',icon:'⚔️',desc:'點擊傷害 × 10，持續 15 秒',level:30,cooldown:120,duration:15},
 {name:'黃金之手',icon:'✋',desc:'立即獲得目前關卡 30 隻怪物的金幣',level:40,cooldown:180,duration:0},
 {name:'天堂之擊',icon:'☄️',desc:'造成點擊傷害 × 500 的一擊',level:50,cooldown:180,duration:0},
];
export const ARTIFACTS=[{name:'遠古之刃',icon:'🗡️',desc:'所有傷害 +25%／級'},{name:'豐饒金杯',icon:'🏆',desc:'金幣獲得 +20%／級'},{name:'星辰之心',icon:'💠',desc:'點擊傷害 +40%／級'}];
export type State={stage:number;best:number;kills:number;hp:number;gold:number;level:number;heroes:number[];relics:number;artifacts:number[];prestiges:number;taps:number;totalKills:number;cooldowns:number[];active:number[];bossEnd:number;farming:boolean;last:number;lastTap:number;lastFairy:number};
export type Action={type:'tap'|'upgrade'|'hero'|'skill'|'artifact'|'prestige'|'boss'|'fairy';index?:number;amount?:number;at:number};
export function health(s:State){return Math.min(1e100,18*Math.pow(1.32,s.stage-1)*(isBoss(s)?9:1));}
export function isBoss(s:State){return s.stage%5===0&&!s.farming;}
export function fresh(now=Date.now()):State {return {stage:1,best:1,kills:0,hp:18,gold:0,level:1,heroes:HEROES.map(()=>0),relics:0,artifacts:[0,0,0],prestiges:0,taps:0,totalKills:0,cooldowns:SKILLS.map(()=>0),active:SKILLS.map(()=>0),bossEnd:0,farming:false,last:now,lastTap:0,lastFairy:now};}
export function tapDamage(s:State){return (1+2*(s.level-1))*Math.pow(1.025,s.level-1)*(1+s.artifacts[0]*.25)*(1+s.artifacts[2]*.4)*(s.active[3]>s.last?10:1);}
export function dps(s:State){return HEROES.reduce((v,h,i)=>v+h.power*s.heroes[i]*Math.pow(1.035,s.heroes[i])*Math.pow(2,Math.floor(s.heroes[i]/25)),0)*(1+s.artifacts[0]*.25)*(s.active[2]>s.last?5:1);}
export function reward(s:State){return Math.min(1e100,5*Math.pow(1.27,s.stage-1)*(1+s.artifacts[1]*.2));}
export function cost(s:State,index=-1,amount=1){let n=index<0?s.level:s.heroes[index],base=index<0?8:HEROES[index].base,rate=index<0?1.12:1.13;return Math.ceil(base*Math.pow(rate,index<0?n-1:n)*(Math.pow(rate,amount)-1)/(rate-1));}
export function relicGain(s:State){return s.stage>=50?Math.max(1,Math.floor(s.stage/10)+Math.floor(s.heroes.reduce((a,b)=>a+b,0)/100)):0;}
function spawn(s:State){s.hp=health(s);s.bossEnd=isBoss(s)?s.last+30000:0;}
function damage(s:State,amount:number){if(!Number.isFinite(amount)||amount<=0)return; s.hp-=amount;if(s.hp<=0){s.gold=Math.min(1e100,s.gold+reward(s)*(isBoss(s)?10:1));s.totalKills++;s.kills++;if(!s.farming&&(isBoss(s)||s.kills>=10)){s.stage=Math.min(700,s.stage+1);s.best=Math.max(s.best,s.stage);s.kills=0;}spawn(s);}}
export function advance(s:State,to:number){to=Math.max(s.last,to);let gap=to-s.last;if(gap>30000){const seconds=Math.min(gap/1000,8*3600);s.gold=Math.min(1e100,s.gold+Math.min(dps({...s,last:to})/Math.max(1,health({...s,farming:true})),2)*reward(s)*seconds*.5);s.last=to;if(isBoss(s)){s.farming=true;s.kills=0;spawn(s);}return s;}
 while(s.last<to){let step=Math.min(100,to-s.last);s.last+=step;if(isBoss(s)&&s.bossEnd&&s.last>=s.bossEnd){s.farming=true;s.kills=0;spawn(s);}damage(s,(dps(s)+(s.active[0]>s.last?tapDamage(s)*8:0))*step/1000);}return s;}
export function apply(s:State,a:Action){advance(s,a.at);const i=a.index??0;
 if(a.type==='tap'&&s.last-s.lastTap>=45){s.lastTap=s.last;s.taps++;damage(s,tapDamage(s)*(s.taps%10===0||s.active[1]>s.last?5:1));}
 if(a.type==='upgrade'||a.type==='hero'){const id=a.type==='upgrade'?-1:i;if(id<-1||id>=HEROES.length||!Number.isInteger(id))return s;const count=[1,10,25].includes(a.amount??1)?a.amount??1:1;const price=cost(s,id,count);if(s.gold>=price&&(id<0?s.level:s.heroes[id])+count<=1000){s.gold-=price;if(id<0)s.level+=count;else s.heroes[id]+=count;}}
 if(a.type==='skill'&&Number.isInteger(i)&&i>=0&&i<SKILLS.length){const k=SKILLS[i];if(s.level>=k.level&&s.cooldowns[i]<=s.last){s.cooldowns[i]=s.last+k.cooldown*1000;s.active[i]=s.last+k.duration*1000;if(i===4)s.gold+=reward(s)*30;if(i===5)damage(s,tapDamage(s)*500);}}
 if(a.type==='artifact'&&Number.isInteger(i)&&i>=0&&i<3){const price=1+s.artifacts[i]*2;if(s.relics>=price){s.relics-=price;s.artifacts[i]++;}}
 if(a.type==='prestige'&&relicGain(s)>0){const reset=fresh(s.last);Object.assign(reset,{best:s.best,relics:s.relics+relicGain(s),artifacts:[...s.artifacts],prestiges:s.prestiges+1,taps:s.taps,totalKills:s.totalKills});return reset;}
 if(a.type==='boss'&&s.farming){s.farming=false;s.kills=0;spawn(s);}
 if(a.type==='fairy'&&s.last-s.lastFairy>=60000){s.lastFairy=s.last;s.gold+=reward(s)*20;}
 return s;
}
export function fmt(n:number){if(n<1000)return Math.floor(n).toLocaleString('en-US');const units=['','K','M','B','T','Qa','Qi','Sx','Sp','Oc','No'];const e=Math.floor(Math.log10(Math.max(1,n))/3);return e<units.length?(n/Math.pow(1000,e)).toFixed(1)+units[e]:n.toExponential(1);}

