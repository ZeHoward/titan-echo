export const REGIONS=['翡翠森林','赤焰峽谷','紫晶遺跡','霜雪之巔','黃昏沙漠','珊瑚王城','櫻花神社','幽毒沼澤','浮空聖殿','星界裂隙'];
export const SPECIES=['史萊姆王','蘑菇巨人','鐵甲蟲','冰原狼','牛頭巨魔','古海巨龜','夜翼魔','寶箱怪','千年樹人','骸骨騎士','赤焰幼龍','暗黑泰坦'];
export const ALL_SPECIES=[...SPECIES,'金甲蠍王','劍齒白虎','冰霜雪怪','幽魂術師','赤鬃半人馬','鱷魚船長','蒸汽機兵','沙海獅身獸','深海巨蛇','死神鐮衛','雷霆巨鷹','熔岩石靈','巨鉗紅蟹','紫蛛女王','雪羽梟熊','南瓜稻草人','暗殿石像鬼','翡翠螳螂','銅角犀王','不死火鳳','八爪巫師','黃金木乃伊','狂暴野豬','影刃黑豹','噬人魔花','鈷甲穿山獸','火焰蠑螈','哥布林巫師','白銀獅鷲','暗影獨角獸','水晶巨像','蘑菇蝸牛','沙漠巨蟲','冰雪元素','熔火惡魔','遠古魔眼','黃金獅王','黑鴉女巫','珊瑚海將','翡翠古龍','紫煙神燈魔','赤鬼武士','黃金機械龍','冰骸戰馬','星海水母','熔岩巨龜','魔界帝王','天使石衛'];
export const MONSTERS=Array.from({length:60},(_,id)=>({id,name:ALL_SPECIES[id],sprite:id%12,sheet:Math.floor(id/12),variant:0,trait:id%6}));
export const EXTRA_HEROES=[['賽琳','晨曦聖騎','☀️'],['烏爾','荒原獵手','🪓'],['璃月','狐火巫女','🦊'],['伊芙','花語精靈','🌸'],['洛克','蒸汽機師','⚙️'],['米菈','潮汐歌者','🐚'],['澤恩','影刃刺客','🥷'],['奧朵','巨石山王','🪨'],['薇拉','毒霧術士','🧪'],['赫爾','冥界使者','💀'],['蘇拉','沙海女皇','👑'],['阿斯特','星象賢者','🔭'],['席格','極地戰神','❄️'],['多蘭','鍛魂巨匠','🔨'],['梅菲','夢境魔女','🦋'],['雷納','獅心統帥','🦁'],['卡歐','混沌術師','🌀'],['菲恩','遠古龍裔','🐲'],['艾菈','聖光天使','🪽'],['尤米','靈兔守護','🐇'],['皮可','虹光妖精','🧚'],['莫德','永夜魔王','😈'],['亞特拉斯','世界守望者','🌌']];
export type Effect='all'|'gold'|'tap'|'hero'|'crit'|'bossGold'|'duration'|'cooldown'|'bossTime'|'offline'|'relic'|'chest'|'fairy'|'revive'|'skill'|'weapon'|'gear'|'monsters';
export type Artifact={name:string;icon:string;desc:string;effect:Effect;value:number;max:number};
export const ARTIFACTS:Artifact[]=[
 {name:'遠古之刃',icon:'🗡️',desc:'所有傷害 +25%／級',effect:'all',value:.25,max:100},
 {name:'豐饒金杯',icon:'🏆',desc:'金幣獲得 +20%／級',effect:'gold',value:.2,max:100},
 {name:'星辰之心',icon:'💠',desc:'點擊傷害 +40%／級',effect:'tap',value:.4,max:100},
 {name:'戰王旌旗',icon:'🚩',desc:'英雄傷害 +30%／級',effect:'hero',value:.3,max:100},
 {name:'獵神之眼',icon:'👁️',desc:'暴擊倍率 +20%／級',effect:'crit',value:.2,max:50},
 {name:'屠王之冠',icon:'👑',desc:'頭目金幣 +25%／級',effect:'bossGold',value:.25,max:100},
 {name:'永恆沙漏',icon:'⌛',desc:'技能持續時間 +5%／級',effect:'duration',value:.05,max:20},
 {name:'時光齒輪',icon:'⚙️',desc:'技能冷卻回復速度 +5%／級',effect:'cooldown',value:.05,max:20},
 {name:'守護神盾',icon:'🛡️',desc:'頭目時限 +1 秒／級',effect:'bossTime',value:1,max:30},
 {name:'夢遊之燈',icon:'🏮',desc:'離線金幣 +10%／級',effect:'offline',value:.1,max:50},
 {name:'輪迴之書',icon:'📕',desc:'轉生聖物 +10%／級',effect:'relic',value:.1,max:50},
 {name:'貪婪寶匣',icon:'🧰',desc:'寶箱怪金幣 +50%／級',effect:'chest',value:.5,max:50},
 {name:'妖精花環',icon:'🌺',desc:'仙女金幣 +20%／級',effect:'fairy',value:.2,max:50},
 {name:'復甦羽毛',icon:'🪶',desc:'英雄復甦速度 +10%／級',effect:'revive',value:.1,max:25},
 {name:'雷霆面具',icon:'🎭',desc:'主動技能威力 +10%／級',effect:'skill',value:.1,max:50},
 {name:'神匠鐵砧',icon:'🔨',desc:'武器加成效果 +10%／級',effect:'weapon',value:.1,max:50},
 {name:'王者玉印',icon:'🪬',desc:'裝備加成效果 +10%／級',effect:'gear',value:.1,max:50},
 {name:'迅捷之靴',icon:'🥾',desc:'每級少 1 隻普通怪，最多少 5 隻',effect:'monsters',value:1,max:5},
 {name:'深淵魔典',icon:'📓',desc:'所有傷害 +35%／級',effect:'all',value:.35,max:100},
 {name:'龍焰寶珠',icon:'🔴',desc:'點擊傷害 +60%／級',effect:'tap',value:.6,max:100},
 {name:'眾星羅盤',icon:'🧭',desc:'英雄傷害 +45%／級',effect:'hero',value:.45,max:100},
 {name:'巨人錢袋',icon:'💰',desc:'金幣獲得 +35%／級',effect:'gold',value:.35,max:100},
 {name:'月神弓弦',icon:'🏹',desc:'暴擊倍率 +30%／級',effect:'crit',value:.3,max:50},
 {name:'帝國徽記',icon:'⚜️',desc:'頭目金幣 +40%／級',effect:'bossGold',value:.4,max:100},
 {name:'安眠水晶',icon:'🔮',desc:'離線金幣 +15%／級',effect:'offline',value:.15,max:50},
 {name:'創世之種',icon:'🌱',desc:'轉生聖物 +15%／級',effect:'relic',value:.15,max:50},
 {name:'萬象魔方',icon:'🧊',desc:'主動技能威力 +15%／級',effect:'skill',value:.15,max:50},
 {name:'虹彩羽翼',icon:'🦚',desc:'仙女金幣 +30%／級',effect:'fairy',value:.3,max:50},
 {name:'亡王鑰匙',icon:'🗝️',desc:'寶箱怪金幣 +75%／級',effect:'chest',value:.75,max:50},
 {name:'諸神黃昏',icon:'🌠',desc:'所有傷害 +100%／級',effect:'all',value:1,max:100},
];
export const SLOTS=[{name:'武器',icon:'🗡️',effect:'tap'},{name:'頭盔',icon:'🪖',effect:'hero'},{name:'盔甲',icon:'🥋',effect:'gold'},{name:'光環',icon:'💫',effect:'all'},{name:'披風',icon:'🧣',effect:'crit'}] as const;
export const RARITIES=['普通','稀有','史詩','傳說'];
export const DAILY_TASKS=[{name:'百次揮劍',metric:'taps',target:100,reward:15},{name:'巨獸剋星',metric:'kills',target:50,reward:20},{name:'打造強軍',metric:'upgrades',target:20,reward:15},{name:'魔力沸騰',metric:'skills',target:3,reward:20},{name:'追逐仙女',metric:'fairies',target:2,reward:10}] as const;
export const PERKS=[{name:'金幣雨',icon:'💰',price:30,desc:'立即獲得 100 隻普通巨獸的金幣'},{name:'時間扭曲',icon:'⏱️',price:40,desc:'立刻結束全部技能冷卻'},{name:'守護祝福',icon:'🛡️',price:25,desc:'10 分鐘內英雄不會負傷'},{name:'末日審判',icon:'☄️',price:50,desc:'立即擊敗當前一隻巨獸（試煉不可用）'},{name:'全員復甦',icon:'💚',price:20,desc:'立刻復活所有負傷英雄'}];
export const ACTION_TYPES=['resourcePerk','petEquip','egg','gearDiscard','discover','talent','resetTalents','build','tap','upgrade','hero','skill','artifact','prestige','boss','fairy','evolve','skillUp','equip','salvage','craft','daily','quest','achievement','perk','revive','trial','leaveTrial','trialReward','world','artifactSalvage'] as const;

