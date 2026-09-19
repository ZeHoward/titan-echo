"""Write the formula source register: where each core number in the engine comes from.

This is a judgement document, not extracted data. It records, for every core formula, whether the
value is confirmed by disassembly, taken from a bundled table, a native static default, carried
over from the 7.5 baseline, chosen by this project, or supplied by a server that the package does
not carry. tools/formula-sources.mjs validates it against the code and renders the readable copy.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def entry(**fields):
    return fields


FORMULAS = [
    entry(id='monsterHealth', module='lib/engine.ts', export='health',
          expression='18 × 1.32^(關卡-1) × 頭目倍率 × 這一波的隻數 × (1 − MonsterHP 減免)',
          parts=[
              entry(part='多重生成的一波算成同一個血條', status='invented', ref='multi-monster-evidence.json',
                    note='原生把一波 N 隻各自滿血的泰坦放上場，本專案沒有場上多目標的概念，'
                         '所以把整波折成一個 N 倍血量的血條。金幣與擊殺數原生本來就是整波一次結算'
                         '（GetMonsterGoldDrop 收隻數、算 1 + (隻數 − 1) × MultiMonstersGold），'
                         '因此打完一波的時間、金幣與推進量都與原生一致，差別只在畫面上是一隻還是一群。'
                         '頭目不參與多重生成，隻數恆為 1。'),
              entry(part='頭目倍率序列 [2,3,4,5,8]', status='table-differs', ref='TitanScalingInfo.json',
                    note='安裝包的 ThemeMultiplierSequence 分四段：關卡 1–5 為 2,3,4,5,8、6–39 為 4,6,8,15,24、'
                         '40–59 為 8,12,16,30,48、60 起回到 2,3,4,5,8，四個來源變體（含 A／B／C）在這四列完全一致。'
                         '引擎對所有關卡只用第一段，因此 6–59 關的頭目血量偏低。**尚未套用**，原因有三：'
                         '一、選列不是關卡的純函數——MonsterModel.StageChangedPreSpawnHandler 會呼叫 '
                         'UpdateCurrentScalingInfo，後者用 GetScalingIndex 從目前索引往前掃，'
                         'GetCurrentScalingInfo 只是對這個有狀態的索引做邊界檢查後取 list[index]；'
                         '二、換段時還會先 RemoveCurrentScalingBonuses 再以 BonusModel.ModifyBonus 套用該列的 '
                         'bonusA／bonusB，倍率序列只是該列的一部分；三、themeMultiplierSequence 同時是 '
                         'ServerVarsModel 的 [ServerVar] 靜態欄位，線上可整份覆蓋。'),
              entry(part='基礎值 18 與每關成長率 1.32', status='table-differs', ref='monster-curve-evidence.json',
                    note='原生沒有「基礎值 × 成長率^關卡」這種寫法：MonsterModel.GetMonsterBaseHP 把關卡先加上 '
                         'ActiveHonourAmount × honourStageOffset（安裝包值 250），再呼叫共用的 GetMonsterBase，'
                         '其形狀已逐式還原為 '
                         'mult × base1^min(關卡, levelOff) × base2^(expo1 × max(關卡−levelOff,0)^expo2) '
                         '÷ base3^(expo3 × max(關卡−transcendenceLevelOff,0)^expo4)。'
                         '十個具名 [ServerVar] 的編譯期預設值也都解出來了：'
                         'mult 17.5、base1 1.38、base2／base3 10、expo1 0.03、expo2 1.098、expo3 1、expo4 1.098、'
                         'levelOff 100、transcendenceLevelOff 180000（高於關卡上限，故除數在可玩範圍恆為 1）。'
                         '**尚未採用**：照原生算，基礎血量在第 250 關之後就低於引擎現值，'
                         '第 2000 關差 10^107、第 98000 關差 10^2745，等於整條難度曲線換掉；'
                         '金幣曲線同樣要一起換，英雄傷害那邊也還多著一項 1.035。'
                         '取捨記在 ROADMAP 的「待決定的取捨」。另外 MonsterHPScaling 的 A／B 變體'
                         '彼此不同（B 在關卡 1–3 為 0.3／0.4／0.475），屬 A／B 指派結果。'),
              entry(part='MonsterHP 減免上限 0.9', status='invented',
                    note='引擎自訂的安全上限，避免血量歸零；安裝包未見對應上限。')]),
    entry(id='monsterGold', module='lib/engine.ts', export='goldReward',
          expression='5 × 1.27^(關卡-1) × 各項金幣加成',
          parts=[
              entry(part='基礎值 5 與成長率 1.27', status='table-differs', ref='monster-curve-evidence.json',
                    note='原生 MonsterModel.GetMonsterBaseGold 走的是與血量同一條 GetMonsterBase，參數為 '
                         'monsterGoldLevelOff、monsterTransendenceGoldLevelOff、monsterGoldMult、'
                         'monsterGoldBase1–3 與 monsterGoldExpo1–4 共十個具名 [ServerVar]；'
                         '兩張變數表都沒帶值，但編譯期預設值已解出：mult 17.5、base1 1.38、base2／base3 10、'
                         'expo1 0.04、expo2 1.036、expo3 1、expo4 1.098、levelOff 100、'
                         'transcendenceLevelOff 180000。目前的 5 與 1.27 是 7.5 基準的近似，'
                         '**尚未採用**原生曲線——它必須與血量曲線一起換，取捨記在「待決定的取捨」。'),
              entry(part='加成代號（GoldAll、JackpotGold、ChestAmount…）', status='table', ref='native-bonus-types.json',
                    note='代號對照原生 BonusType 列舉，數值來自神器與天賦資料表。'),
              entry(part='寶箱泰坦基礎機率 0.01', status='default', ref='bonus-defaults-evidence.json',
                    note='BonusModel.SetDefaultBonuses 把 ChestChance 的基礎值設為 chestersonChance（0.01）；'
                         '引擎原本是 0.02，2.13.0 起改用原生值並與暴擊同樣乘上 AllProbabilityBoost。'
                         '線上可覆蓋，故為 default。'),
              entry(part='劍術大師等級的金幣乘數', status='native', ref='derived-bonus-evidence.json',
                    note='原生 PlayerModel.RefreshGoldPerPlayerLevelBonus 把它算成 GoldAll 的乘數再寫回：'
                         '1 ＋ 劍術大師等級 × GoldPerSwordMasterLevel。'
                         '唯一來源是「鑽石」傳說套裝（每級 +0.1%），滿級 12500 時為 13.5 倍。')]),
    entry(id='monsterCount', module='lib/engine.ts', export='monsterCount',
          expression='round(8 + 關卡 × 148 ÷ (32000 + 關卡))',
          parts=[entry(part='算式與 base 8、inc 148、delta 32000', status='default',
                       ref='monster-count-evidence.json',
                       note='原生 StageLogic.GetRawMonsterCountPerStage 依序讀 monsterCountInc、'
                            'monsterCountStageDelta、monsterCountBase，算 '
                            'base + 關卡 × inc ÷ (delta + 關卡) 後交給 Math.Round（平手進偶數）。'
                            '三個欄位是 [ServerVar]，安裝包的兩張變數表都沒有帶值，'
                            '但類別建構式有編譯期預設值 8／148／32000（見 servervar-defaults.json）。'
                            '因此第 1 關 8 隻、第 500 關 10 隻、第 2000 關 17 隻、第 98000 關 120 隻；'
                            '引擎原本固定 10 隻，早期偏多、後期遠遠偏少。線上可覆蓋，故為 default 而非 native。'),
                       entry(part='隻數減免與下限', status='native', ref='monster-count-reduction-evidence.json',
                             note='原生 StageLogic.GetMonsterCountPerStage 在曲線值之上**減去** '
                                  'Bonus(MonsterCountPerStage)（轉 int 是截斷），最後 Math.Max(1, …)。'
                                  '名字讀起來像「每關幾隻」，運算卻是減法，統計面板也歸在「減免」欄——'
                                  '寫成加法會讓拿到套裝的人每關更長。唯一來源是「剋星」傳說套裝（5 隻）。'
                                  '同一個方法裡的契約減免與特殊泰坦堆疊倍率屬於未實作系統，不折算；'
                                  'splashSkip 是呼叫端傳入的參數，不屬於「這一關有幾隻」。'
                                  '**下限與截斷在現有資料下觀測不到**（來源是整數 5、最小隻數 8），'
                                  '仍照原生實作並用測試釘住前提。')]),
    entry(id='bossHealthMod', module='lib/engine.ts', export='health',
          expression='頭目血量在小怪基礎上再乘一組倍率',
          parts=[entry(part='bossHPModBase 與 bossHPModStageMult', status='table-differs',
                       ref='servervar-defaults.json',
                       note='原生除了 ThemeMultiplierSequence 另有這兩個 [ServerVar] 參與頭目血量。'
                            '兩張變數表沒帶值，但編譯期預設值已解出：bossHPModBase 1.13、'
                            'bossHPModStageMult 0.005。**本專案仍未實作**：它們如何進入頭目血量'
                            '（與 ThemeMultiplierSequence 的關係、是否隨關卡累加）尚未逐式還原，'
                            '而且頭目血量是建立在尚未採用原生曲線的小怪血量之上。')]),
    entry(id='heroDamage', module='lib/engine.ts', export='heroDps',
          expression='基礎傷害 × 等級 × 1.035^(等級-1) × 里程碑倍率 × 武器與流派加成',
          parts=[
              entry(part='英雄基礎傷害', status='table', ref='HelperInfo.json', note='DefaultDamageAmount 欄。'),
              entry(part='里程碑倍率', status='table', ref='HelperImprovementsInfo.json',
                    note='依等級取最後一列的累計倍率，資料表最高 6000 級；'
                         '對上原生 LevelCurve.GetTotalImprovementByLevel 取的那一格，'
                         'TT2_HERO_MILESTONES 就是該表 Ascension 0 的 PrecalculatedAmount 三欄。'),
              entry(part='每級成長率 1.035', status='table-differs', ref='hero-dps-evidence.json',
                    note='原生沒有這一項：HelperInfo.GetRawDPS 就是 '
                         'LevelCurve.GetTotalImprovementByLevel(昇階, 等級) × 等級 × GetBaseDamage(昇階) '
                         '三個因子相乘，完整的 GetDPS 在外面只再乘武器、全體英雄加成與強化倍率；'
                         '兩個方法的機器碼裡一個浮點常數都沒有載入，所以逐級成長率不可能藏在裡面——'
                         '里程碑累計倍率本身就是整條曲線（Ascension 0 共 145 段，6000 級累計 1.18×10^189）。'
                         '**尚未移除**：1.035 是 7.5 基準的產物，與同為 7.5 近似的怪物血量曲線'
                         '（18 × 1.32^關卡，十個具名 [ServerVar] 在包內都沒有值）配套；'
                         '單獨拿掉會讓英雄傷害在 1000 級時少 8.4×10^14 倍，等於在沒有原版難度基準的情況下'
                         '只改一邊，因此保留現值並記在這裡。')]),
    entry(id='heroCost', module='lib/engine.ts', export='cost',
          expression='基礎費用 × (1.08^(等級+購買數) − 1.08^等級) ÷ 0.08 × 費用減免',
          parts=[
              entry(part='英雄基礎費用', status='table', ref='HelperInfo.json',
                    note='PurchaseCost1 欄，最高一筆為 1.0000E+240。'),
              entry(part='成長率 1.08', status='default', ref='helper-cost-evidence.json',
                    note='原生 ServerVarsModel.helperUpgradeBase 是 static float，'
                         '類別建構式寫入的靜態預設值為 float 的 1.08（位元 0x3f8a3d71），'
                         '整個建構式只寫這個欄位一次。它確實是費用公比：HelperInfo 的建構式讀它之後'
                         '取對數存進 helperUpgradeBaseLog、把 base−1 存進 helperUpgradeBaseMinusOne，'
                         '正是等比級數的兩個導出量，GetPurchaseCost 再以 GHDouble.Pow 乘上基礎費用。'
                         '引擎原本的 1.075 是 7.5 基準，2.12.8 起改用 8.2 的預設值，'
                         '以 Math.fround 保留 float 精度，與劍術大師側的 costBase／costGrowth 同級。'
                         '相鄰的 helperUpgradeLevelTiers／Modulus／Offsets 三個 int[] 尚未解出內容。')]),
    entry(id='playerDamage', module='lib/tt2-player.ts', export='playerBaseDamage',
          expression='等級 × 里程碑累計倍率 × 基礎傷害預設值',
          parts=[
              entry(part='里程碑累計倍率', status='table', ref='PlayerImprovementsInfo.json',
                    note='TotalNew 欄，保留來源字串，最高 9.07E+363。'),
              entry(part='基礎傷害預設值 1', status='default',
                    note='ServerVarsModel 靜態預設值；線上覆蓋值未知。')]),
    entry(id='playerCost', module='lib/tt2-player.ts', export='playerUpgradeCost',
          expression='5 × 1.075^等級 × (1.075^購買數 − 1) ÷ 0.075',
          parts=[
              entry(part='基數 5 與成長率 1.075', status='default',
                    note='ServerVarsModel 靜態預設值 costBase 與 costGrowth（後者為 float 精度）；線上覆蓋值未知。')]),
    entry(id='artifactEffect', module='lib/tt2-rules.ts', export='artifactValue',
          expression='數值 × 等級^指數，依加成型別決定加算或乘算',
          parts=[
              entry(part='數值、指數與加成型別', status='table', ref='ArtifactInfo.json', note='103 件神器逐件對照。'),
              entry(part='1e240 夾擠', status='invented',
                    note='避免非有限值的安全網；在所有規則上限下最大倍率約 8.45×10^150，不構成封頂。')]),
    entry(id='artifactCost', module='lib/tt2-rules.ts', export='upgradeArtifactCost',
          expression='費用係數 × (等級+1)^費用指數，四捨五入且至少 1',
          parts=[entry(part='費用係數與指數', status='table', ref='ArtifactInfo.json')]),
    entry(id='petActiveLevel', module='lib/tt2-rules.ts', export='petBonus',
          expression='出戰寵物的有效等級 = 擁有等級 + floor(擁有等級 × ActivePetLevel)',
          parts=[entry(part='出戰寵物的額外等級', status='native', ref='pet-active-level-evidence.json',
                       note='原生 PetInfo.GetActiveLevelBonus 先用 PetModel.IsEquippedPet 判斷有沒有出戰，'
                            '再把該寵物自己的等級乘上 ActivePetLevel 並 Floor，回傳的是**額外等級**'
                            '（方法本身沒有加法，加總在呼叫端）。沒出戰的寵物維持擁有的等級。'
                            '來源是「武士」神話套裝（0.25）、「九尾」傳說套裝（0.1）與天賦「戰鬥技巧」。'
                            '取值走 baseFrom 而非 effect()，因為完整快取本身就是在算寵物加成時呼叫 '
                            'petBonus 的，從那裡再呼叫 effect() 會繞回自己；沒有寵物會給 ActivePetLevel，'
                            '所以只讀基礎層既足夠也不遞迴。')]),
    entry(id='heroPassive', module='lib/tt2-hero-passives.ts', export='heroPassiveTotals',
          expression='達到解鎖等級的英雄被動逐項相加或相乘，並套用戰術洞察增幅',
          parts=[
              entry(part='被動效果與解鎖等級', status='table', ref='HelperSkillInfo.json'),
              entry(part='四項尚未實作的被動', status='invented',
                    note='TapDamageFromHelpers、Goldx10Chance、MultiMonstersGold、PetGoldQTEAmount 的觸發時機'
                         '尚未還原，列在 PENDING_HERO_EFFECTS 而不生效。')]),
    entry(id='buildDamage', module='lib/engine.ts', export='buildDamage',
          expression='劍術大師裸傷^流派指數 × 英雄總傷^流派指數 × 流派加成',
          parts=[
              entry(part='流派折減係數', status='invented',
                    note='程式內已註明為暫用係數，公會飛船、匕首與金槍的完整戰鬥尚未還原。'),
              entry(part='技能點的傷害乘數', status='native', ref='skill-point-damage-evidence.json',
                    note='原生 PlayerModel.RefreshSkillPointBonuses 不是直接套用加成，而是算成兩個值再 '
                         'ModifyBonus 寫回 AllDamage：加法項 1 ＋ 累計技能點 × DamagePerSkillPoint，'
                         '次方項 DamagePerSkillPointMult ^ 累計技能點。點數取 skillPointsReceivedServer，'
                         '是**累計收到的**、不是未花費的，對應本專案的「持有中 ＋ 已投入天賦」。'
                         '本專案只接加法項：次方項在 8.2 沒有任何來源會給，而查一個不在加成表裡的加成'
                         '會拿到乘法中性值 1。加法項目前唯一拿得到的來源是「小丑女王」傳說套裝（每點 +10%）；'
                         '「復仇者」武器是 Unique 稀有度，還沒有取得途徑。'),
              entry(part='魔力上限的傷害乘數', status='native', ref='derived-bonus-evidence.json',
                    note='原生 PlayerModel.RefreshDamageBonusPerManaCap 把它算成 AllDamage 的乘數再寫回，'
                         '**沒有加 1**：clamp(currentManaCap, 0, maximumManaCapBonusAmount 5000) × DamagePerManaCap，'
                         '而且先用 GetBonusIdentity 比對，等於中性值就移除修飾不套用——'
                         '這個比對是必要的，該加成是乘法型、沒有來源時讀到 1 而不是 0。'
                         '唯一來源是「腐化」傳說套裝（每點魔力上限 ×0.05），六個技能全解鎖時為 10.5 倍。'
                         '**刻意偏離一處**：原生在魔力上限為 0 時會讓傷害歸零，本專案改為不套用，'
                         '因為本專案的存檔可能在劍術大師 100 級之前就湊齊那套套裝，而傷害歸零救不回來。'),
              entry(part='最高關卡的傷害乘數', status='native', ref='count-bonus-evidence.json',
                    note='原生 StatsTrackedBonusModel.UpdateDamagePerMaxStageBonus 以本季最高關卡對 '
                         'DamagePerMaxStage 取次方後寫進 AllDamage，只有一次 Pow。'
                         '來源是「游牧」神話套裝（1.00005），第 2000 關 ×1.11、關卡上限 98000 時 ×134。'),
              entry(part='集齊套裝數與英雄武器總等級的傷害乘數', status='native', ref='count-bonus-evidence.json',
                    note='兩條都寫回 AllDamage，但算術不同。'
                         'EquipmentModel.EquipmentSetCountBonusHandler 是**次方**：'
                         'DamagePerEquipmentSet ^ 集齊的套裝數（乘法型加成沒有來源時是 1，1 的任何次方仍是 1，'
                         '所以不需要中性值比對）。'
                         'HelperModel.RefreshDamagePerHelperWeaponBonus 是**乘法且沒有加 1**：'
                         '武器總等級 × DamagePerHelperWeapon，總等級為 0 或加成等於中性值時整個不套用。'
                         '**總等級低時原生就會讓傷害變低**（每級 0.1、總等級 5 時是 ×0.5）；'
                         '原生沒有夾下限，而總等級只會往上累積，所以照原生保留。'
                         '來源分別是「鐵匠」與「武器大師」兩套傳說套裝，都可製作。'
                         'DamagePerHelperWeaponMult 在本專案沒有來源，故不接。'),
              entry(part='主動技能倍率', status='table', ref='ActiveSkillInfo.json')]),
    entry(id='cloaking', module='lib/engine.ts', export='cloakedStageSkip',
          expression='每次擊殺：若 目前關卡 ≤ 最高關卡 + 1 且 隨機值 < CloakedSkipChance，跳關數 += CloakedSkipAmount',
          parts=[
              entry(part='觸發條件與順序', status='native', ref='cloaking-evidence.json',
                    note='原生 StageLogic.OnMonsterDeath 依序呼叫 Cloaking.get_IsCloaking、RollCloaking、'
                         'GetCloakingStagesSkipped。**順序就是規則**：先看能不能潛行才擲骰。'
                         'get_IsCloaking 是「天賦已解鎖」且「目前關卡 ≤ GetCloakingEndStage()」，'
                         '後者是本季最高關卡加上 CloakedStageDuration，'
                         '所以潛行只在重打已推過的關卡時有用，不會越過自己的紀錄。'),
              entry(part='持續關數 1', status='table', ref='SkillTreeInfo2.0.json',
                    note='天賦「潛行」的第四個加成欄（BonusTypeD＝CloakedStageDuration、BonusAmountD＝1）。'
                         '**本專案的天賦執行時資料只匯了前兩個加成欄**，所以這個值直接取自參考資料表。'
                         '同一個缺口影響 13 個天賦的第四個加成，已記在 ROADMAP 待補。')]),
    entry(id='skillValues', module='lib/engine.ts', export='skillPower',
          expression='技能等級對應的倍率 × 對應加成 × 全主動技能加成',
          parts=[entry(part='各級倍率、持續、冷卻與魔力', status='table', ref='ActiveSkillInfo.json'),
                 entry(part='等級上限', status='native', ref='skill-cap-evidence.json',
                       note='原生 ActiveSkillModel.GetActiveSkillMaxLevel 由該技能的 defaultSkillCap 起算，'
                            '加上 AllActiveSkillCap 與依職業分的三個 Cap 加成。'
                            '本專案只有 AllActiveSkillCap 有來源（「暗黑天使」神話套裝 +5），職業那幾個沒有來源。'
                            '**這不是裝飾性的上限**：技能表每個技能有 40 列、預設上限 30，'
                            '被擋住的那幾列是真內容——影分身 35 級的倍率是 30 級的 243 倍。'
                            '接上它同時動了購買檢查與載入夾擠，並把上限夾在資料表列數。'),
                 entry(part='持續時間的兩個加總', status='native', ref='skill-duration-evidence.json',
                       note='原生 SkillParsedInfo.GetDuration 先建兩個加總再相乘：秒數那組**從 0 起算**，'
                            '收該技能自己的 SkillDuration 與 AllActiveSkillDuration；'
                            '倍率那組**從 1 起算**，收該技能自己的 SkillDurationMult 與 AllActiveSkillDurationMult；'
                            '結果是 (基礎 + 秒數組) × 倍率組。兩個起點是關鍵——倍率組若從 0 起算，'
                            '沒有來源的人技能持續會直接歸零。本專案原本只做了秒數那組；'
                            '倍率組的唯一來源是「獵人」傳說套裝（0.1），六個技能各 ×1.1。')]),
    entry(id='critical', module='lib/engine.ts', export='critChance',
          expression='(0.01 + CritChance 加成) × AllProbabilityBoost，上限 1；暴擊倍率為 11.5 × CritDamage',
          parts=[entry(part='基礎機率 0.01、倍率 11.5 與上限 1', status='default',
                       ref='bonus-defaults-evidence.json',
                       note='兩張變數表確實沒帶值，但編譯期預設值有：BonusModel.SetDefaultBonuses 把 '
                            'CritChance 的基礎值設為 playerCritChance（0.01），'
                            'PlayerModel.RefreshCriticalValues 以 '
                            'min(Bonus(CritChance) × Bonus(AllProbabilityBoost), maxCritChance) 算機率、'
                            '以 playerCritMult（11.5）× Bonus(CritDamage) 算倍率，maxCritChance 為 1。'
                            '引擎原本是 0.02 與固定 10 倍，而且點擊那一行寫死 10、沒有用 critMultiplier；'
                            '2.13.0 起改用原生值並接上機率加成與暴擊傷害加成。線上可覆蓋，故為 default。'),
                 entry(part='暴擊增幅技能執行中的第三段', status='native', ref='critical-damage-evidence.json',
                       note='原生 RefreshCriticalValues 除了 playerCritMult × CritDamage，還有第三段：'
                            '在暴擊增幅技能（ActiveSkillID 3）執行中時，暴擊倍率再乘 CritBoostSkillCritDamage。'
                            '2.14.2 第一次解這個方法時只讀了前兩段，2.15.4 補上。'
                            '唯一來源是天賦「背刺」；沒點的人這一項是乘法中性值 1，技能開著也不受影響。'),
                 entry(part='CritDamage 只進暴擊倍率，一般傷害不吃', status='native',
                       ref='critical-damage-evidence.json',
                       note='BonusType.CritDamage（134）在整個映像只有一個 GetBonus 呼叫點，'
                            '就是 PlayerModel.RefreshCriticalValues；同一趟掃描的三個對照加成'
                            '（SwordMasterDamage、TapDamage、AllDamage）都掃得到既知讀取點，'
                            '所以不是掃描失效。引擎原本把它乘進 buildMultiplier，'
                            '等於每一種傷害都吃暴擊傷害加成、暴擊時還會再乘一次；'
                            '2.14.2 起移除那一份。')]),
    entry(id='mana', module='lib/engine.ts', export='manaMax',
          expression='魔力上限 200 + ManaPoolCap；每秒回復 (2 + ManaRegen) ÷ 60 × ManaRegenMult × 藥水倍率',
          parts=[
              entry(part='上限＝每個已解鎖主動技能 35', status='default', ref='servervar-defaults.json',
                    note='原生沒有固定上限：PlayerModel.RefreshManaCap 呼叫 '
                         'ActiveSkillModel.GetSkillManaCapAmount，後者從 manaCapInitial 起算、'
                         '每一個已解鎖的主動技能加上 manaCapPerSkill，再套用 ManaPoolCap 與 '
                         'ManaPoolCapPercent 兩個加成。編譯期預設值是 manaCapInitial 0、'
                         'manaCapPerSkill 35，六個技能全解鎖是 210。引擎原本固定 200，'
                         '2.13.1 起改用原生算式：劍術大師 100 級解鎖第一個技能前上限是 0（也還沒有技能可施放），'
                         '350 級之後是 210。線上可覆蓋，故為 default。'),
              entry(part='基礎回復 2（每分鐘）', status='default', ref='servervar-defaults.json',
                    note='原生 PlayerModel.RefreshManaRegen 讀 [ServerVar] manaRegenBaseInMinutes'
                         '（編譯期預設值 2），加上 Bonus(ManaRegen)、乘上 Bonus(ManaRegenMult)、'
                         '**除以 60**、再乘上 Bonus(AllManaGained)。除以 60 那一步證明 2 的單位是'
                         '「每分鐘回復點數」——與引擎既有的算式完全相同，'
                         '只補上原本漏掉的 AllManaGained 乘數。')]),
    entry(id='bossTimer', module='lib/engine.ts', export='bossDuration',
          expression='30 秒 + BossTimerDuration',
          parts=[entry(part='基礎 30 秒', status='default', ref='servervar-defaults.json',
                       note='兩張變數表沒帶值，但編譯期預設值是 bossPlayTimeBase = 30，'
                            '與引擎沿用的 30 秒相同——這一項不必改數值，只是來源由「待證據」'
                            '變成「原生靜態預設值」。線上可覆蓋。')]),
    entry(id='prestigeRelics', module='lib/engine.ts', export='relicGain',
          expression='max(1, floor(關卡^1.7 ÷ 100 × PrestigeRelic))，最高關卡到 60 後開放',
          parts=[
              entry(part='指數 1.7 與除數 100', status='table-differs', ref='relic-curve-evidence.json',
                    note='原生沒有「關卡^指數 ÷ 常數」這種寫法，而是三段相加，**這次完整讀完了**：'
                         '關卡先 Min(關卡, relicsStageMax)，然後 '
                         '(一) relicStageMult2 × (relicStageOffset + 關卡)、'
                         '(二) relicStageMult1 × relicStageBase ^ (關卡 ^ relicStageExpo)、'
                         '(三) relicStageBase2 ^ (關卡 ^ Min(relicStageExpoMax3, relicStageExpo2 × '
                         '(1 + relicStageMult3 × 關卡 ^ relicStageExpo3)))，三段相加後 Max(0, ·)。'
                         '第三段那個包在 Math.Pow 裡的 Math.Min 就是先前沒讀完的部分。'
                         '**十個係數全部有編譯期預設值**（先前記為八個）：mult1 3、mult2 1.5、mult3 5e-07、'
                         'base 1.21、base2 1.002、expo 0.48、expo2 1.005、expo3 1.1、expoMax3 1.0155、'
                         'offset −56，關卡上限 relicsStageMax 180000。'
                         '**仍不採用**：第 2000 關以內兩者同數量級（1.6–3.4 倍），但第 10000 關起第三段的指數'
                         '頂到 1.0155，1.002^(關卡^1.0155) 開始主導，到關卡上限差 10^95 量級，'
                         '整條換掉等於重做蛻變經濟，且與怪物曲線那條配套。逐關對照與理由見 '
                         'ROADMAP 待決定的取捨第 9 條。'),
              entry(part='外層乘數的結合順序', status='native', ref='relic-curve-evidence.json',
                    note='跟著 GHDouble 運算子的 out 指標在堆疊上的去向讀，順序定下來了：'
                         'Ceiling(曲線值 × Bonus(PrestigeRelic) × (1 + Bonus(PrestigeRelicAdditive)) '
                         '× 累加倍率 × Bonus(OnlyPrestigeRelic))，其中那個 1 是 mov w0,#1 的立即數。'
                         '**引擎已照做兩個**：(1 + PrestigeRelicAdditive) 與 × OnlyPrestigeRelic。'
                         '兩者在乾淨存檔都是無作用值（加法型預設 0、乘法型預設 1），'
                         '所以只有湊齊神話套裝的人會變多——包內有 17 個套裝各給 PrestigeRelicAdditive 2.4408，'
                         '湊一套就是 3.44 倍。OnlyPrestigeRelic 目前在引擎資料裡沒有任何來源，'
                         '接上是為了位置正確，將來有來源就會生效。'),
              entry(part='累加倍率那一項', status='native', ref='relic-curve-evidence.json',
                    note='原生在上式中還乘一項 GetCurrentAdditiveRelicMultiplierBonus() + '
                         'stageRushToRelicMultiplier × GetRewardableAdditiveRelicMultiplierAmount()。'
                         '兩半都很短：前者是 1 + stageRushToRelicMultiplier（float 0.00017）× '
                         'PrestigeModel.AdditiveRelicMultiplier（已擁有的數量），'
                         '後者是 Max(0, GetNextAdditiveRelicMultiplier() − 已擁有)，'
                         '整項化簡成 1 + 0.00017 × Max(已擁有, 下一個門檻)。'
                         '**本專案沒有累加倍率系統，這一項因此恆為 1**——所以引擎省略它與原生等價，'
                         '不是「未照做」。將來實作該系統時要加回來；它還依賴 '
                         'PlayerModel.GetSeasonalMaxStageReached，季節系統本專案也沒有。'),
              entry(part='進位方向', status='native', ref='relic-curve-evidence.json',
                    note='原生以 GHDouble.Ceiling 無條件進位，引擎原本用 Math.floor 捨去，已改為 Math.ceil。'
                         '在目前的近似曲線下每次蛻變固定多一顆（第 60 關 10→11、第 1000 關 1258→1259）。'),
              entry(part='開放門檻第 60 關', status='default', ref='prestige-unlock-evidence.json',
                    note='不是 7.5 留下的猜測：[ServerVar] minimumPrestigeStage 的編譯期預設值就是 60，'
                         '而且它正是 PrestigeModel.GetPrestigeStage 結尾那個 System.Math.Max 的第二個引數，'
                         '也就是「這次蛻變要打到第幾關」的下限，CanPrestige 只是拿關卡和它比 >=。'
                         '先前記為「安裝包未見對應欄位」是沒找到名字——改以指令編碼掃描'
                         '（ldr Wt,[Xn,#0xbec] 除兩個暫存器欄位外完全固定）才找出全部三個讀取點。'
                         '引擎把這個數字寫在 PRESTIGE_DEFAULTS.minimumStage，'
                         'relicGain、discover 與 prestige 三處共用。線上可覆蓋，故為 default。'),
              entry(part='門檻隨歷史最高關卡上升的那一層', status='table-differs',
                    ref='prestige-unlock-evidence.json',
                    note='原生的門檻不是固定 60：GetPrestigeStage = Math.Max(floor('
                         'prestigeMsPercentRequirement × (基準 − 進階起點) + 進階起點), minimumPrestigeStage)，'
                         '係數的編譯期預設值是 float 0.5，基準取自 maxPrestigeStageCount，'
                         '也就是要推到歷史最高的一半才能再蛻變。引擎沒有這一層——歷史最高到過 60 就一直能蛻變。'
                         '第一次蛻變前兩者等價。未採用，已列入 ROADMAP 待決定的取捨第 8 條。'),
              entry(part='至少一顆聖物的下限', status='invented', ref='relic-curve-evidence.json',
                    note='引擎自訂的 max(1, ·)，安裝包未見對應下限。改用無條件進位之後它幾乎不再生效——'
                         '任何正數進位後都至少是 1——保留是為了擋住乘數把值壓到 0 的情形。'),
              entry(part='額外的聖物乘數（累加、季節、新手）', status='table-differs',
                    ref='relic-curve-evidence.json',
                    note='原生另有 additiveRelicMultiplier、seasonalRelicMultiplier 與新手加成三條乘數，'
                         '本專案都沒有實作。**先前記為「31 個含 relic 的欄位裡只有兩個有值」，那是變數表的狀況**——'
                         '按編譯期預設值算，31 個裡有 28 個有值，例如 additiveRelicMultiplierMax 50000'
                         '（先前誤記為 150000）、seasonalRelicMultiplierBase 1.0053、'
                         'seasonalRelicStageExpMult 9.8e-05、newPlayerRelicMultMp 5、'
                         'newPlayerRelicMultBonusDurationMins 10080（七天）。'
                         '也就是說這三條乘數其實查得到，只是還沒有人去還原它們的算式。')]),
    entry(id='evolveCost', module='lib/engine.ts', export='evolveCost',
          expression='英雄基礎費用 × 1e4^已昇階次數 × 1e6',
          parts=[
              entry(part='1e4 與 1e6 係數', status='invented',
                    note='引擎自訂的等比近似，與原生結構不同：原生每位英雄在 HelperInfo 有 AscendCostExpo1–6 '
                         '六個逐階係數（例如 H18 為 255、2216、4748.5、7281、9813.5、12346），不是同一個倍率連乘。'
                         '**資料在包內、尚未接入**。'),
              entry(part='逐階係數的縮放', status='server', ref='native-server-var-fields.json',
                    note='接入前還缺一塊：原生另有 [ServerVar] ascendCostExpoScaling（與傷害側的 '
                         'ascendDamageExpoScaling 對稱）以及 maximumHeroAscension、ascensionMinGoldExp，'
                         '安裝包都沒有值，所以就算把六個係數接上也無法宣稱與線上一致。')]),
    entry(id='skillPoints', module='lib/engine.ts', export='apply',
          expression='可用技能點 = floor(最高關卡 ÷ 50) − 1，只在最高關卡推進時增加',
          parts=[entry(part='每 50 關一點與起算偏移', status='table-differs', ref='servervar-defaults.json',
                       note='原生把這兩個數字放在具名 [ServerVar]：skillPointsStageDelta（每幾關一點）與 '
                            'skillPointsStageMin（起算關卡），另有 skillPointsPrestigeDelta／Min 走蛻變那條線。'
                            '變數表只帶 skillPointsPrestigeMax（180000），'
                            '但**編譯期預設值都有**：skillPointsStageDelta 500、skillPointsStageMin 51、'
                            'skillPointsPrestigeDelta 50、skillPointsPrestigeMin 50。'
                            '引擎現在是「每 50 關一點、偏移 −1」，與原生的「每 500 關一點、第 51 關起算」'
                            '差了十倍——照原生改，第 2000 關的技能點會從 39 點掉到個位數，'
                            '天賦樹幾乎等於歸零，因此**尚未採用**，取捨記在「待決定的取捨」。'
                            '原生另有一條走蛻變次數的發放線，本專案沒有實作。')]),
    entry(id='petBonus', module='lib/tt2-rules.ts', export='petBonus',
          expression='單隻寵物的加成 = (bonusBase + bonusInc × 等級) × 改良乘數 ^ 段數，'
                     '未出戰的只取 GetPassivePercentage 那一部分',
          parts=[
              entry(part='括號內與改良乘數的位置', status='native', ref='pet-growth-evidence.json',
                    note='原生 PetInfo.GetActiveBonus 先呼叫 GetImprovementBonus，再算 '
                         '(bonusBase + bonusInc × 等級) × improvementBonus × Bonus(bonusType)，'
                         '三個因子的位置與引擎相同。引擎乘的第三項是 <family>Pet<group>Effect 與 '
                         'EquipmentPetEffect，是否等同原生的 Bonus(bonusType) 尚未逐項對照。'),
              entry(part='被動加成繞著 identity 混合', status='native', ref='pet-growth-evidence.json',
                    note='原生 GetPassiveBonus = identity + (主動值 − identity) × 比例，'
                         'identity 取自 BonusModel.GetBonusIdentity；與引擎的 '
                         'additive ? full × fraction : 1 + (full − 1) × fraction 相同'
                         '——加法型的 identity 是 0，乘法型是 1。'),
              entry(part='改良段的間隔與上限', status='table-differs', ref='pet-growth-evidence.json',
                    note='原生是 Min(Floor((等級 − petImprovementLevelStart) ÷ petImprovementLevelDelta), '
                         'maxImprovementLevels)，兩個 [ServerVar] 的編譯期預設值是 100 與 20；'
                         '引擎用的是 max(0, floor((min(等級, maxImprovementLevels) − 100) ÷ 50))。'
                         '三處不同：每段的等級間隔 20 對 50、maxImprovementLevels 原生夾的是段數而引擎夾的是等級、'
                         '原生沒有把段數夾到 0 以上（等級低於 100 時乘數小於 1）。'
                         '暫不套用：以 improvementBonus = 1.5 的 21 隻為例，等級 1 時原生只有引擎的 13%、'
                         '100 級相同、200 級 3.4 倍、1000 級 5.7 萬倍、1600 級 8.4×10^7 倍，'
                         '早期變弱後期暴增，等於整條寵物曲線重來，已列入 ROADMAP 的待決定取捨。'
                         'PetType.Endgame 另走 endGamePetImprovementLevelStart／Delta（皆為 6），'
                         'PetInfo 的 30 隻只有 Legacy 與 Exotic，用不到。')]),
    entry(id='petCombat', module='lib/tt2-pet-combat.ts', export='petDamageFactor',
          expression='寵物傷害係數依等級分段，出戰與未出戰分開計算',
          parts=[
              entry(part='等級分段的兩個門檻 40 與 80', status='default', ref='servervar-defaults.json',
                    note='引擎把寵物等級切成 0–40、40–80、80 以上三段各乘不同增量；'
                         '原生的兩個門檻就是 [ServerVar] petDamageIncLevel1 與 petDamageIncLevel2，'
                         '編譯期預設值是 40 與 80，**與引擎既有的分段完全相同**，不必改數值。'),
              entry(part='每段的增量', status='table', ref='PetInfo.json',
                    note='引擎的 TT2_PETS 30 隻與 8.2 的 PetInfo 逐格核對：DamageBase 與三段 '
                         'DamageInc1to40／41to80／80on，連同 BonusBase、BonusInc、ImprovementBonus、'
                         'MaxImprovementLevels 與 UnlockStage 全部相同，沒有一格是 7.5 留下的。'),
              entry(part='未出戰寵物只取部分效果的比例', status='default', ref='pet-growth-evidence.json',
                    note='原生 PetInfo.GetPassivePercentage 是 Min(1, gap × increment × (等級 ÷ gap))，'
                         '除法是整數除法；[ServerVar] petPassiveLevelGap 的預設值是 5、'
                         'petPassiveLevelIncrement 是 float 0.01，相乘後每 5 級加 0.05，'
                         '與引擎的 min(1, floor(等級÷5) × 0.05) 相同。被動傷害就是主動傷害乘這個比例。'),
              entry(part='每 20 次有效點擊發動一次', status='default', ref='servervar-defaults.json',
                    note='原生 [ServerVar] petTapAmount 的編譯期預設值就是 20，與引擎沿用的數字相同；'
                         'PetTapCountToAttack 加成可減少次數。線上可覆蓋。')]),
    entry(id='eggs', module='lib/tt2-collection.ts', export='advanceEggs',
          expression='每 4 小時補一顆寵物蛋，上限兩顆',
          parts=[
              entry(part='四小時的補充間隔', status='table', ref='ServerVarOverride.json',
                    note='原生欄位是 [ServerVar] hoursToCollectEgg，而**安裝包的 ServerVarOverride 帶了值 4**，'
                         '與本專案沿用的四小時一致；這是少數包內能核對上的欄位之一。'
                         '該表屬 bundled-server-variable，線上是否被覆蓋未知。'),
              entry(part='上限兩顆', status='server', ref='native-server-var-fields.json',
                    note='對應的具名欄位是 maxPetEggs（另有 vipStatusMaxPetEggsAdditive 為 VIP 加成），'
                         '兩者在安裝包內都沒有值；目前的 2 是 7.5 基準沿用，不是原版上限。')]),
    entry(id='cloneAttackRate', module='lib/engine.ts', export='cloneAttackRate',
          expression='影分身每秒攻擊次數 = max(1, (1＋ShadowCloneSkillAttackRate) × CompanionAttackRate)',
          parts=[
              entry(part='速率算式與每秒四次的基礎值', status='native', ref='damage-text-evidence.json',
                    note='原生 ActiveSkillModel.GetCloneAttackRate 以 GHDouble(1) 為底，取 '
                         'Bonus(ShadowCloneSkillAttackRate) 與 Bonus(CompanionAttackRate) 相乘後與 1 取 Max；'
                         'PlayerController.ShadowCloneAttackLoop 以 WaitForSeconds(1 ÷ 該速率) 間隔攻擊。'
                         '**基礎值不是 1**：BonusModel.SetDefaultBonuses 把 ShadowCloneSkillAttackRate 的'
                         '基礎值設為 baseShadowCloneAniPerSec，也就是 4，所以無加成時是每秒四次。'
                         '2.12.7 誤以為是每秒一次，2.13.0 更正。'),
              entry(part='加法型加成代入 基礎值＋增量', status='default', ref='bonus-defaults-evidence.json',
                    note='加法型加成的基礎值就是 SetDefaultBonuses 設的那一個：'
                         'ShadowCloneSkillAttackRate 為 4，天賦提供 0.1–0.95 的增量，兩者相加。'),
              entry(part='離散到 100ms 模擬步長，單次傷害為每秒總量 ÷ 速率', status='invented',
                    note='引擎以 100ms 為一步推進，攻擊只在步邊界結算，因此單次間隔最多晚 100ms；'
                         '計時器累加間隔而非改設為當下時間，長期平均頻率與速率一致。'
                         '另外 buildDamage 是本專案的「每秒總量」近似，所以一次攻擊取其 ÷ 速率——'
                         '節奏照原生，總量不因節奏改變，但單次數值不是原生的單次傷害。'),
              entry(part='特殊攻擊未實作', status='server',
                    note='ShadowCloneSkillSpecialRate 與 SpecialChance 另有節奏與機率，'
                         '本專案未實作，也未核實其倍率來源。')]),
    entry(id='loginStreak', module='lib/engine.ts', export='consecutiveLoginDamage',
          expression='所有傷害 ×= DamagePerConsecutiveLoginDay ^ (連續登入天數夾在 0–14)，漏領一天指數直接歸零',
          parts=[
              entry(part='天數是指數，不是乘數', status='native', ref='login-streak-evidence.json',
                    note='DailyRewardModel.UpdateBonusPerConsecutiveLoginDay 是這個加成唯一的取值點：'
                         '指數先被設成 0，只有在 GetCollected() ≤ COLLECTED_TODAY 時才換成 '
                         'LoginStreakCapped，然後 AllDamage ×= Pow(該加成, 指數)。'
                         'GHDouble.Pow 的第一個參數是底數，所以天數在指數上。'),
              entry(part='中斷就整項失效，不是遞減', status='native', ref='login-streak-evidence.json',
                    note='GetCollected 比對上次領取的日期與今天：同一天是 COLLECTED_TODAY(1)，'
                         '上次＋1 天＝今天是 CAN_COLLECT_TODAY(0)，上次＋1 天＜今天是 '
                         'MISSED_COLLECT_RESET(2)，其餘是 ERROR(3)。只有前兩者讓加成生效，'
                         '所以**漏掉一天就變成 Pow(加成, 0) = 1**。'),
              entry(part='上限 14 天', status='native', ref='login-streak-evidence.json',
                    note='LoginStreak 是 currentDayNumber − 1，LoginStreakCapped 再夾到 '
                         '[0, NUMBER_OF_DAYS]，而 NUMBER_OF_DAYS 是 DailyRewardModel 的常數 14——'
                         '和十四天獎勵表用的是同一個常數。加成自己的說明也寫著 max 14。'),
              entry(part='日界與原生一致，都是 UTC', status='native', ref='login-streak-evidence.json',
                    note='原生的日期比較走 GHTime.currentTimeUTC 的 .Date；本專案的 dayAt 是 '
                         'floor(epoch 毫秒 ÷ 86400000)，epoch 本身就以 UTC 為基準，'
                         '所以兩者切在同一條線上，不需要額外換算。'),
              entry(part='不分 MISSED 與 ERROR', status='invented',
                    note='原生的 ERROR(3) 要上次領取的日期在未來才會出現（改過系統時間或存檔被動過），'
                         '它與 MISSED(2) 一樣讓加成失效，所以本專案只判斷「上次領取是不是今天或昨天」，'
                         '不分這兩種。'),
              entry(part='連續天數怎麼前進與重置', status='invented',
                    note='原生的 currentDayNumber 在哪裡前進與重置不在那個方法裡，沒有一併解出來。'
                         '本專案在領取獎勵時判斷：上次領取就在昨天就加一，否則從 1 重新算起。'
                         '這與 GetCollected 的三個狀態一致，但不是從原生讀出來的。')]),
    entry(id='fairies', module='lib/engine.ts', export='rollExtraFairies',
          expression='領一次妖精必得一隻，之後最多七隻額外的：每一隻各擲一次 Random < FairySpawnChance × AllProbabilityBoost，中了就多一隻並把機率乘 0.5，沒中就結束；最高關卡要先到第 10 關才有妖精',
          parts=[
              entry(part='迴圈的形狀與兩個上限', status='native', ref='fairy-evidence.json',
                    note='FairyController.MultiFairySpawn 先無條件 SpawnFairy 一隻'
                         '（呼叫點在第一次擲骰之前，這一點另外釘住），'
                         '再以 Bonus(FairySpawnChance) × Bonus(AllProbabilityBoost) 為機率跑迴圈：'
                         '每一輪 op_LessThan(Random.value, 機率)，沒中就 break，'
                         '中了就 Invoke(SpawnFairy, n ÷ 2) 並把機率乘上 multiFairySpawnPenalty，'
                         '迴圈上限是 maxExtraMultiFairySpawns。'
                         '**機率沒有被夾在 1**：天賦「妖精魅力」滿級是 2.75，前兩輪必中。'),
              entry(part='上限 7、懲罰 0.5、起始關卡 10', status='default', ref='fairy-evidence.json',
                    note='三個都是 [ServerVar] 的編譯期預設值：maxExtraMultiFairySpawns = 7、'
                         'multiFairySpawnPenalty = 0.5、fairyStartStage = 10，線上可覆蓋。'
                         'FairySpawnChance 在 SetDefaultBonuses 裡**沒有條目**，'
                         '所以它的基礎值就是 0——沒有來源的玩家永遠只有一隻妖精。'),
              entry(part='關卡門檻', status='native', ref='fairy-evidence.json',
                    note='FairyController.OnQTEReady 對妖精那一型（QTEType 6）先比對 '
                         'GetMaxStageReached() 與 fairyStartStage，過了才呼叫 MultiFairySpawn。'
                         '看的是**最高關卡**，不是目前所在的關卡，所以蛻變之後不會又鎖回去。'),
              entry(part='什麼時候出現由 QTE 排程決定', status='native', ref='qte-evidence.json',
                    note='妖精是 QTEType 6，冷卻、ready 與過期都由 QTEController 排。'
                         '本專案原本自訂的 60 秒冷卻已經換成資料表的 120 秒起算、'
                         '扣掉 FairyCooldown、再套上 ±10% 的隨機變異；'
                         '沒點的話 150 秒（expireTime）後飛走並重排冷卻。'
                         '公式本身登記在 qteCooldown。'),
              entry(part='額外妖精一次結算，不排隊飛進來', status='invented',
                    note='原生把額外的妖精排在 n ÷ 2 秒後依序出場，各自是場上的一個實體。'
                         '本專案沒有場上實體，所以一次領取把所有中的妖精一起結算成金幣。'
                         '總金額相同，差別只在畫面上看不到牠們陸續飛進來。')]),
    entry(id='stageScaleGold', module='lib/engine.ts', export='stageScaleGold',
          expression='max(stageScaleMinAmount, stageScaleSlope × 關卡^stageScaleExpo)，'
                     '妖精金幣再把它取 fairyGoldStageScaleExpo 次方乘進去',
          parts=[
              entry(part='曲線的形狀', status='native', ref='stage-scale-gold-evidence.json',
                    note='PlayerModel.GetStageScaleGoldAmount 只有一行：Pow(關卡, stageScaleExpo) '
                         '乘 stageScaleSlope，再與 stageScaleMinAmount 取 GHDouble.Max。'
                         '**它不是一條獨立的金幣曲線**，是疊在既有掉落上的第二個關卡項——'
                         '三個呼叫者裡有兩個是消費端，各自把它取自己的指數次方再乘進金額：'
                         '妖精用 fairyGoldStageScaleExpo 乘在 GetChestersonGold 上，'
                         '寵物的米達斯之心用 petGoldStageScaleExpo 乘在 GetAverageBossGoldDrop 上。'),
              entry(part='三個係數與妖精的指數', status='default', ref='stage-scale-gold-evidence.json',
                    note='四個都是 [ServerVar] 的編譯期預設值：stageScaleMinAmount = 2、'
                         'stageScaleSlope = 0.001、stageScaleExpo = 1.24、'
                         'fairyGoldStageScaleExpo = 1.6，線上可覆蓋。'
                         '乘積要到第 459 關左右才追過下限，所以在那之前整段只是個常數倍 2^1.6。'),
              entry(part='米達斯之心那一端沒有接', status='table-differs',
                    ref='stage-scale-gold-evidence.json',
                    note='同一條縮放在 PetModel.GetPetHomGold 也用得到，但它的底是 '
                         'MonsterModel.GetAverageBossGoldDrop——'
                         'GetMonsterGoldDrop(關卡, MonsterClass.Boss, 1 隻, 變異) 再乘上 '
                         'GetAverage10xGold(Goldx10Chance)、GetAverage10xGold(BossGoldx10Chance) '
                         '與 GetAverageJackpotGold()。那三個期望值本專案都還沒還原，'
                         '所以 petGoldStageScaleExpo（1.8）先沒有登記進引擎。'),
              entry(part='妖精金幣鏈剩下的三項還是缺的', status='table-differs',
                    ref='stage-scale-gold-evidence.json',
                    note='GetFairyGoldAmount 在關卡縮放之後還有兩個十倍金幣的期望值、'
                         '累積金幣的期望值、點石成金開著時的 Pow(HandOfMidasSkillAmount, '
                         'fairyMidasBonusExpo)，以及 Random.Range(0.2, 1.8) 的變異（期望值 1）。'
                         '這一輪只接關卡縮放那一項，其餘照舊沒有。')]),
    entry(id='qteCooldown', module='lib/engine.ts', export='qteCooldownSeconds',
          expression='(資料表的 cooldownTime − Bonus(該型的 CooldownBonusType)) × (1 + randomness × Random(−1, 1))，'
                     '再依 QTE 類型乘上各自的倍率加成，最後夾在 MIN_COOLDOWN_SECONDS(1) 秒以上',
          parts=[
              entry(part='公式的形狀與下限', status='native', ref='qte-evidence.json',
                    note='QTEController.GetCooldownDuration 先用 QTEType 查 QTEInfo，'
                         '查不到就回 0，**而且不套用下限**——夾擠在分支之後，'
                         '查不到的那條路直接跳過它。查得到就以 '
                         '(cooldownTime − Bonus(CooldownBonusType)) × (1 + randomness × Range(−1, 1)) '
                         '為基礎值。冷卻加成走的是 **fsub 不是 fmul**——它從秒數裡扣掉，'
                         '與加成資料表把 FairyCooldown 標成 additive／subtract／seconds 一致。'
                         '下限 MIN_COOLDOWN_SECONDS 是靜態建構式裡的 1.0f，不是資料表的值。'),
              entry(part='九型的秒數、隨機幅度、冷卻加成與天賦', status='table', ref='QTEInfo.json',
                    note='QTEInfo 表的九列供給 CooldownTime、ExpireTime、ActiveTime、Randomness、'
                         'CooldownBonusType 與 TalentID。'
                         '表裡還有一欄 MinCooldown（PetAttack 5.852、UltraDagger −2.926 等），'
                         '但 QTEInfo 類別沒有對應欄位、ProcessAllQTEs 也沒有讀它，'
                         '**那一欄在包內是死的**，客戶端的下限只有上面那個編譯期常數。'),
              entry(part='依類型多乘的倍率', status='native', ref='qte-evidence.json',
                    note='switch 的每一支都是從二進位抽象執行出來的，不是手抄：'
                         '寵物攻擊與閃現乘 PetQTECooldownMult × CompanionQTECooldownMult，'
                         '米達斯之心再多乘一個 PetGoldQTECooldownMult，'
                         '飛船與英雄只乘 CompanionQTECooldownMult，'
                         '妖精與兩種契約完全不乘。'
                         'PetGoldQTECooldownMult 不在本專案匯入的加成資料表裡，'
                         '沒有任何來源給它，所以米達斯之心那個乘數實際上恆為 1。'),
              entry(part='解鎖條件', status='native', ref='qte-evidence.json',
                    note='QTEModel.IsQTEUnlocked 在 TalentId 為 0 時直接回 true，'
                         '否則問 SkillTreeModel.IsTalentUnlocked。'
                         '資料表裡妖精的 TalentID 是空的，所以妖精對所有人都是解鎖的；'
                         '其餘八型各自綁一個天賦。'
                         'ScheduleCooldown 只對已解鎖的類型排程。'),
              entry(part='ready 與過期的狀態機', status='native', ref='qte-evidence.json',
                    note='HandleQTECooldownFinished 先 CancelCooldown、再用 expireTime '
                         'ScheduleExpire，然後才送出 OnQTEReady；'
                         '沒人點的話過期計時器到期就重排冷卻，點了就走 HandleQTEFinished 重排。'
                         '本專案沒有 coroutine，改用 qteReadyAt／qteExpireAt 兩個時間戳，'
                         'ready 的狀態就是 qteExpireAt 大於 0。'),
              entry(part='離線期間不推進', status='invented',
                    note='原生的計時器是 Unity coroutine，App 切到背景時不走。'
                         '本專案的離線推進把兩個時間戳整個往後平移 gap，'
                         '等於「離線那段時間不算」，而不是補發錯過的每一次 ready。'
                         '已經 ready 的妖精離線回來還在，不會在背景飛走。'),
              entry(part='隨機來源', status='invented',
                    note='原生用 UnityEngine.Random.Range(−1, 1)，'
                         '本專案改用自己的確定性亂數 tt2Random。'
                         '期望值同樣是 1，但同一個存檔在原生與本專案不會擲出相同的序列。'),
              entry(part='匕首那一支沒有照做', status='table-differs', ref='qte-evidence.json',
                    note='QTEType 7 原生還有條件分支：幻影刃在跑時先扣 '
                         'StreamOfBladesCooldownReduction，接著乘 UltraDaggerCooldownMult，'
                         '幻影刃沒在跑且待命匕首數達到 UltraDaggerCount 時再乘 '
                         'daggerCooldownAutoThrowMult(1.1)。'
                         '本專案沒有匕首流派，而且 UltraDaggerCount 是**數量不是倍率**，'
                         '照抄成一串乘法會把數量乘進冷卻裡，所以刻意留空。'
                         '飛船與兩種契約同理：分支已經解出來並記在證據檔，但沒有消費端。'),
              entry(part='只有妖精接上消費端', status='invented',
                    note='原生的 QTEController 對每個已解鎖的類型都排程，'
                         '本專案目前只排妖精那一型——寵物的三種與英雄那一種'
                         '各自需要自己的傷害、金幣與跳關規則，留給後續的段落。')]),
    entry(id='petBurst', module='lib/engine.ts', export='petBurstDamage',
          expression='雷霆爆發：連打 max(1, 30 − PetTapCountToAttack) 下，放一次「平常那一擊 × PetAttackQTEDamage」的大攻擊；那一擊吃跳關但不吃跳泰坦',
          parts=[
              entry(part='大攻擊的傷害', status='native', ref='pet-qte-evidence.json',
                    note='PetModel.GetQTEBigAttack 就是 GetNormalAttack(true) × Bonus(PetAttackQTEDamage)，'
                         '整個方法只有這一次乘法，沒有別的因子。'),
              entry(part='要連打幾下', status='default', ref='pet-qte-evidence.json',
                    note='PetController.BonusUpdatedHandler 在 PetTapCountToAttack 變動時重算 '
                         'max(1, mashQTENumTaps − 該加成)；mashQTENumTaps 是 [ServerVar] 的編譯期預設值 30，'
                         '線上可覆蓋。**那個 30 與本專案平常寵物蓄力的 20 是兩個不同的數字**，不要互相套用。'),
              entry(part='不跳泰坦', status='native', ref='pet-qte-evidence.json',
                    note='DamageType.PetBurst（11）在 StageLogic.GetTitanSkip 的分派裡**沒有自己的那一支**，'
                         '落在 default，而結果槽在方法開頭就被 GetBonus 之前的 GHDouble.Zero 填過，'
                         '所以回 0——連基礎的 TitanSkip 都不加。'
                         '這一條是把分派區塊抽象執行出來的，並以 DamageType.Pet（確實有那一支）當對照組。'),
              entry(part='跳關', status='native', ref='skip-evidence.json',
                    note='GetStageSkip 對 PetBurst 有一支：(StageSkip + PetQTEStageSkip)。'
                         '那個方法走跳表，無法逐步走，配對來自統計面板的 (BonusType, DamageType) 字面量表，'
                         '與 skip-evidence.json 同一份事實。'),
              entry(part='連打併進戰鬥區的點擊', status='invented',
                    note='原生的連打是寵物身上獨立的按鈕，本專案沒有場上的寵物實體，'
                         '所以同一下點擊既打泰坦也算進連打。次數與傷害都與原生一致，'
                         '差別只在按的是哪一個按鈕。'),
              entry(part='ready 的條件簡化', status='invented',
                    note='原生 PetController.OnQTEReady 對這一型還看寵物目前的 PetState，'
                         '以及這隻怪是不是在 petMashQTEStartOfBattleSeconds（1 秒）內剛生成。'
                         '本專案沒有 PetState 與場上實體，只要求「有出戰中的傷害寵物」。'),
              entry(part='閃現（PetBoss）沒有做', status='table-differs', ref='pet-qte-evidence.json',
                    note='**做了也不會生效。**PetController.ApplyChargedBonus 第一件事就是拿 '
                         'Bonus(PetBossQTEDuration) 與 0 比大小，不大於 0 就整個返回，'
                         '連 PetBossQTEDamage 都不會被套用。那個加成是加法型的秒數（中性值 0），'
                         '而本專案匯入的加成資料表裡沒有任何天賦、神器、套裝或寵物給它——'
                         '天賦「閃現」給的是 PetBossQTEDamage 與 PetQTECooldownMult，不是 duration。'
                         '哪天有來源了，tests/pet-qte.test.mjs 會轉紅。'),
              entry(part='米達斯之心（PetGold）沒有做', status='table-differs', ref='pet-qte-evidence.json',
                    note='**缺前置，不是做不了。**PetModel.GetPetHomGold 以 '
                         'MonsterModel.GetAverageBossGoldDrop 起算，再乘 '
                         'Pow(GetStageScaleGoldAmount, petGoldStageScaleExpo)、Bonus(PetGoldQTEAmount) '
                         '與 petHomGoldMult，點石成金開著時還要再乘 '
                         'Pow(HandOfMidasSkillAmount, petMidasBonusExpo)。'
                         'GetStageScaleGoldAmount 已經在 2.24.0 還原（見 stageScaleGold），'
                         '**現在缺的只剩 GetAverageBossGoldDrop 那一半**：頭目掉落本身要再乘 '
                         'GetAverage10xGold(Goldx10Chance)、GetAverage10xGold(BossGoldx10Chance) '
                         '與 GetAverageJackpotGold() 三個期望值，三個都還沒還原。'
                         'petMidasBonusExpo 連編譯期預設值都沒有。'),
              entry(part='PetQTEDamage 沒有接', status='native', ref='pet-qte-evidence.json',
                    note='那個加成（370）在整個映像沒有取值點，套裝給了它也沒有用。'
                         'PetAttackQTESplashCount 則是既沒有來源也沒有取值點，'
                         '2.14.0 的濺射調查已經確認過。')]),
    entry(id='helperOrb', module='lib/engine.ts', export='helperOrbDamage',
          expression='星界覺醒：每點一次，光球撞一次，傷害是 英雄每秒傷害 × HelperQTEDamage × (1 + 0.1 × 威力^2)；能彈幾次由 HelperQTECount 決定',
          parts=[
              entry(part='撞擊的傷害', status='native', ref='helper-qte-evidence.json',
                    note='HelperController.HelperQTEDamageMonster＝'
                         'GetAllHelperDPS × Bonus(HelperQTEDamage) × '
                         '(helperQTEDamageOffset + helperQTEDamageMult × 威力^helperQTEDamageExpo)，'
                         '以 DamageType.HelperQTE（8）送進 QueueMonsterAttack。'
                         '整個方法只有一次 fmul 與一次 fadd，形狀是逐指令比對釘住的。'),
              entry(part='三個係數', status='default', ref='helper-qte-evidence.json',
                    note='helperQTEDamageOffset = 1、helperQTEDamageMult = 0.1、'
                         'helperQTEDamageExpo = 2，三個都是 [ServerVar] 的編譯期預設值，線上可覆蓋。'),
              entry(part='一次點擊加一次威力', status='native', ref='helper-qte-evidence.json',
                    note='HelperQTETapped 用一道 NEON 加法把 HelperQTEPower 與 '
                         'HelperQTEBounceCount 同時各加 1，再呼叫 QTEController.RefreshExpire '
                         '重設過期計時——所以只要一直點，這一輪就一直延續。'),
              entry(part='彈幾次由 HelperQTECount 決定', status='table-differs',
                    ref='helper-qte-evidence.json',
                    note='HelperQTEAnim 以 isLastOrbShot = (HelperQTEBounceCount >= '
                         '(int)Bonus(HelperQTECount)) 判斷是不是最後一發。'
                         '**本專案沒有任何來源給 HelperQTECount**（加法型，中性值 0），'
                         '所以第一發就是最後一發，整套彈跳退化成一次撞擊。'
                         '引擎照原生以「威力 > 上限」判斷而不是寫死一次，'
                         '哪天那個加成有了來源就會自然彈更多次。'),
              entry(part='持續期間的英雄傷害加成沒有做', status='table-differs',
                    ref='helper-qte-evidence.json',
                    note='**做了也不會生效。**HelperQTEModifyDamage 把 AllHelperDamage 乘上 '
                         'Pow(Bonus(HelperQTEDamage), Min(HelperQTEPower, Bonus(HelperQTECount)))。'
                         '同一個沒有來源的 HelperQTECount 讓 Min 恆為 0、Pow 恆為 1，'
                         '所以那個乘數永遠是中性值。天賦「星界覺醒」給的是 HelperQTEDamage。'),
              entry(part='威力與彈跳數合併成一個欄位', status='invented',
                    note='原生是兩個欄位：點擊時同時加一，但 ReduceHelperQTEPower（動畫逾時用）'
                         '只減威力。本專案沒有那個逾時觸發，兩者恆等，所以只存一個 qteHelperPower。'),
              entry(part='光球併進戰鬥區的點擊', status='invented',
                    note='原生的光球是場上實體，在兩側英雄之間飛，撞到怪才結算。'
                         '本專案沒有實體，所以點一下就立即結算一次撞擊。'
                         '另外「兩側各要有一個已解鎖英雄」那個開場條件沒有實作——'
                         '本專案的英雄沒有左右之分，而學得到這個天賦的存檔一定早就解鎖大量英雄。')]),
    entry(id='chesterson', module='lib/engine.ts', export='chestersonStackLength',
          expression='寶箱泰坦用同一套佇列但效果完全不同：打死一隻（要蛻變過）開啟 floor((ChestersonGoldStageAmount + 5) × SpecialTitanStackDurationMult) 關的效果，那幾關的每一隻普通泰坦都是寶箱泰坦，金幣倍率 treasureGold(15) × ChestAmount',
          parts=[
              entry(part='效果是換掉泰坦的類別，不是再擲一次骰', status='native',
                    ref='special-titan-evidence.json',
                    note='MonsterModel.NewMonster 在 IsMonsterEffectActive(MonsterClass.Chesterson) '
                         '為真時，直接把新生成泰坦的類別 csel 成 Chesterson（列舉值 3）；'
                         'Boss 與 StageSkipBoss 走各自的分支，保留原本的類別。'
                         '所以效果作用中的那幾關，每一隻普通泰坦都是寶箱泰坦。'),
              entry(part='一疊的關數與「只有一疊」', status='native', ref='special-titan-evidence.json',
                    note='ChestersonTitanScript.get_StageEffectLength 取 '
                         'Bonus(ChestersonGoldStageAmount) 加上 [ServerVar] chestersonGoldDuration，'
                         '再乘 Bonus(SpecialTitanStackDurationMult)，最後 floor。'
                         'get_MaxStackCount 是常數 1（整個方法就是 mov w0,#1; ret），'
                         '所以不像炸彈泰坦那樣會疊起來——本專案因此用一個「剩幾關」的數字，'
                         '不用佇列。'),
              entry(part='要蛻變過才會出現', status='native', ref='special-titan-evidence.json',
                    note='ChestersonTitanScript.CanSpawnTitan 先看 NumOfStacks 有沒有到上限，'
                         '再尾呼叫 PrestigeModel.HasPrestigedBefore()。'
                         '所以第一輪（還沒蛻變過）不會有寶箱泰坦——這一點以前沒有做。'),
              entry(part='寶箱金幣倍率 15，不是 10', status='default', ref='special-titan-evidence.json',
                    note='BonusModel.GetChestersonMultiplier 是 [ServerVar] treasureGold 乘上 '
                         'Bonus(ChestAmount)，而 treasureGold 的編譯期預設值是 **15**。'
                         '引擎以前寫死 10，這一版改成 15。'
                         '**妖精金幣走的是同一條**（2.19.0 查證）：GetFairyGoldAmount 以 '
                         'MonsterModel.GetChestersonGold 起算，而那就是 GetMonsterGoldDrop 帶 '
                         'MonsterClass.Chesterson、一隻，所以兩者共用同一個倍率。'),
              entry(part='關數 5 的基礎值', status='default', ref='special-titan-evidence.json',
                    note='[ServerVar] chestersonGoldDuration 的編譯期預設值是 5，線上可覆蓋。'
                         'ChestersonGoldStageAmount 是加法型，中性值 0，所以未投資時一疊就是 5 關；'
                         '天賦「Chesterson Incense」每級加一關，滿級（40）加 30 關。'),
              entry(part='被效果轉成寶箱的那些不會續期', status='invented',
                    note='原生是在生成時換類別，被換的那一隻走的仍然是 Chesterson 的擊殺路徑，'
                         '而 CanSpawnTitan 在效果作用中為假，所以不會再推一疊。'
                         '本專案把「擲骰打到的」與「被效果轉成的」分成兩個旗標，'
                         '只有前者會設定剩餘關數——結果相同，但寫法是本專案自己的。')]),
    entry(id='specialTitans', module='lib/engine.ts', export='megaBombChance',
          expression='特殊泰坦是一疊有期限的效果：生成機率 = 自己那一項 × SpecialTitanSpawnChance × AllProbabilityBoost，打死一隻推一疊 floor(10 × SpecialTitanStackDurationMult) 關，每疊讓該關隻數再乘 0.9，滿層（MegaBombMaxStacks）就不再生成',
          parts=[
              entry(part='佇列狀態機：推入、老化、層數上限擋在生成端', status='native',
                    ref='special-titan-evidence.json',
                    note='SpecialTitanScript 帶一個 Queue<int>，元素是「這一疊還剩幾關」。'
                         'PushEndEffectToQueue 推入 StageEffectLength；UpdateEffectEnd 每清一關把'
                         '每個元素減一、小於 1 的不放回；NumOfStacks 就是佇列長度。'
                         '**上限擋在生成端**：RollSpawnMonster 擲骰後還要 CanSpawnTitan()，'
                         '而炸彈泰坦的 CanSpawnTitan 是 NumOfStacks < MaxStackCount。'
                         '擊殺那一側比對的是 StageEffectLength 而不是上限（三次虛擬呼叫都走同一個 '
                         'vtable 槽），那只是同一關打死多隻時的防護。'),
              entry(part='兩個生成機率是同一個模板', status='native', ref='special-titan-evidence.json',
                    note='ChestersonTitanScript 與 MegaBombTitanScript 的 GetSpawnChance 指令序列相同，'
                         '只差第一個因子：寶箱是 Bonus(ChestChance)，炸彈是 Bonus(MegaBombSpawnChance)，'
                         '後面都乘 Bonus(SpecialTitanSpawnChance) 與 Bonus(AllProbabilityBoost)。'
                         '**引擎原本的寶箱機率少了中間那一項**，2.17.0 補上，屬於既有機制的修正。'
                         'Hayst 與 Kratos 用同一個模板但各多一個加法項，綁在未實作的流派上，沒有接。'),
              entry(part='機率 0.001、上限 1、一疊 10 關、每疊 0.9 四個基礎值', status='default',
                    ref='bonus-defaults-evidence.json',
                    note='MegaBombSpawnChance 與 MegaBombMaxStacks 是加法型，基礎值由 '
                         'BonusModel.SetDefaultBonuses 從 [ServerVar] megaBombMonsterSpawnChance（0.001）'
                         '與 megaBombBaseStacks（1）設入；一疊的關數與每疊的比例直接讀 '
                         'megaBombMonsterMaxStageEffectAmount（10）與 megaBombMonsterTitanRemovalPercent'
                         '（0.9），兩者不是加成所以不在那張表裡。SpecialTitanSpawnChance 與 '
                         'SpecialTitanStackDurationMult 是乘法型，中性值 1 就是它們的起點，不另外相加。'
                         '四個都是編譯期預設值，線上可覆蓋。'),
              entry(part='擲骰改在擊殺時，不是生成時', status='invented',
                    note='原生在生成一隻泰坦時就決定它是哪一種，本專案沿用既有的寶箱做法，'
                         '在擊殺當下擲骰決定剛打死的是不是特殊泰坦。兩者在統計上等價——每隻泰坦'
                         '各擲一次同樣的骰——差別只在畫面上看不到牠走過來。'
                         '一隻泰坦只能是一種，所以寶箱與炸彈在本專案是互斥的。'),
              entry(part='Hayst 與 Kratos 兩種特殊泰坦未實作', status='server',
                    note='兩者的 GetSpawnChance 用同一個模板，但各多一個加法項，'
                         '而且綁在本專案未實作的流派上（HaystMonsterSpawnChance 與 '
                         'KratosMonsterSpawnChance 都列在「等流派實作再說」那一組）。')]),
    entry(id='multiMonsters', module='lib/engine.ts', export='multiMonsterChance',
          expression='每次生成擲一次骰，命中機率 min(1, (0.01 ＋ MultiMonsters) × AllProbabilityBoost)，'
                     '命中則這一波是 trunc(Random[2, 4 ＋ MultiMonstersMaxCount ＋ 1)) 隻，'
                     '整波金幣乘 1 ＋ (隻數 − 1) × MultiMonstersGold',
          parts=[
              entry(part='擲骰、隻數與整波金幣的三段形狀', status='native', ref='multi-monster-evidence.json',
                    note='MonsterController.SpawnMonster(int, MonsterClass) 取 Random.value 與 '
                         'Bonus(MultiMonsters) × Bonus(AllProbabilityBoost) 相比，命中後以 '
                         '(int)Random.Range(minMultiMonsterSpawns, Bonus(MultiMonstersMaxCount) + 1) 取隻數；'
                         'MonsterModel.GetMonsterGoldDrop(關卡, 類別, 隻數, 變異) 對隻數大於 1 的一波乘上 '
                         '1 + (隻數 − 1) × Bonus(MultiMonstersGold)。三段的指令序列逐一比對過，'
                         '另以 BonusModel.GetAverageMultiMonsterSpawn 交叉核對。'),
              entry(part='機率 0.01、上限 4、下限 2 三個基礎值', status='default',
                    ref='bonus-defaults-evidence.json',
                    note='MultiMonsters 與 MultiMonstersMaxCount 是加法型，基礎值由 '
                         'BonusModel.SetDefaultBonuses 從 [ServerVar] multiMonsterBaseChance（0.01）與 '
                         'maxMultiMonsterSpawns（4）設入；下限直接讀 minMultiMonsterSpawns（2），'
                         '它不是加成所以不在那張表裡。MultiMonstersGold 的基礎值也是 1.0，但它是乘法型，'
                         '1.0 就是中性值，引擎不另外相加以免重複計入。三者都是編譯期預設值，線上可覆蓋。'),
              entry(part='物件池上限未實作', status='invented',
                    note='原生取到隻數後還會夾到場上怪物物件池的大小，那是 Unity 的資源上限而非遊戲規則；'
                         '本專案沒有場上多目標，無對應概念，因此不夾。'),
              entry(part='擲骰用本專案的 LCG，不是 Unity 的 Random', status='invented',
                    note='原生走 UnityEngine.Random，本專案一律走可重現的 tt2Random，'
                         '所以序列不同、長期分布相同。隻數取整同樣是截斷，與原生的 (int) 轉換一致。')]),
    entry(id='perks', module='lib/tt2-perks.ts', export='perkValue',
          expression='增益每層 12 小時獨立計時；魔力藥水提高回復倍率，'
                     '黃金雨依層數縮短自動購買間隔，再乘上 1 − min(AutoBuyHeroesMultDuringMakeItRain, 0.95)',
          parts=[
              entry(part='四段數值、12 小時與費用 100', status='table', ref='perk-evidence.json',
                    note='8.2 的 PerkInfo 與本專案沿用的 7.5 值完全相同：ManaPotion 給 AllManaGained '
                         '1.5／1.75／2／2.25，MakeItRain 給 AutoBuyHeroes 45／15／5／3，兩者都是 43200 秒、'
                         '基礎費用 100；鑽石價另有同值的 [ServerVar] 預設值 perkDiamondCost = 100。'),
              entry(part='層數上限 3、解鎖後 4', status='native', ref='perk-evidence.json',
                    note='PerkModel.CurrentMaxPerkStackAllowed 是常數 3，Bonus(PerkMaxLevel) 大於 0 時加一；'
                         'MAX_PERK_STACK = 4 同時是 ActivePerkInfo.timers 的固定格數，'
                         '所以引擎的 min(4, 3 + PerkMaxLevel) 與原生等價。GetBonusAmountA 以 stackCount−1 '
                         '當索引並夾在第 0 格與最後一格之間，也與引擎相同。'),
              entry(part='每層獨立計時，滿層換掉剩餘最短的一層', status='native', ref='perk-evidence.json',
                    note='RunPerkTimer 對每一層各自扣時間，歸零的格由 ShiftTimersAndCountStack 壓掉。'
                         '滿層時 ActivatePerk 不是拒絕，而是先 RemoveOldestStack 清掉剩餘時間最短的那格'
                         '再加新的一層——層數不變，等於用一次使用機會換回完整十二小時。'
                         '引擎原本在滿層時直接擋掉，已改為照原生。'),
              entry(part='黃金雨間隔的乘數', status='default', ref='perk-evidence.json',
                    note='GetBonusAmountA 只對 PerkID.MakeItRain 多乘一段 '
                         '1 − min(Bonus(AutoBuyHeroesMultDuringMakeItRain), autoBuyHeroesMaxBonus)，'
                         '上限欄位的編譯期預設值是 float 0.95，所以間隔最低只到原值的 5%。'
                         '包內給這個加成的是 GoldRain 傳說套裝（0.3），湊齊後間隔剩七成；魔力藥水不受影響。'
                         '上限是 [ServerVar]，線上可覆蓋，故為 default。'),
              entry(part='隨機配發與票券未還原', status='table-differs', ref='perk-evidence.json',
                    note='原生的 perk 選擇在第 1200 關解鎖（perkSelectUnlockStage），另有票券制'
                         '（perkTicketCost = 10），本專案兩個 perk 固定可用、兌換次數來自登入獎勵。'
                         'PerkInfo 共 19 列，本專案只實作其中兩列。'),
              entry(part='黃金雨的立即金幣未還原', status='table-differs', ref='perk-gold-evidence.json',
                    note='形狀讀出來了，**但不是關卡的函數**：GetMakeItRainGold 先挑一個關卡'
                         '（把「歷史最高 − 目前」的差額乘 makeItRainMaxStageMult 0.85 再加回目前，'
                         '與 makeItRainStageMult 1.0 × 目前關卡兩者取其一），再交給 GetPerkGold；'
                         'GetPerkGold 是 (GetLargestGoldSourceAmount(關卡) × Bonus(PerkGold)) '
                         '^ perkGoldReduction（0.9965）——也就是「玩家在那個關卡最大的單一金幣來源」'
                         '再開一個略小於 1 的次方。**接不上的原因很具體**：'
                         'GetLargestGoldSourceAmount 有 387 條指令，對寶箱泰坦、頭目、妖精、'
                         '寵物點金手四個來源取最大值，還要 GetMaxHandOfMidasBonus 與一次 QTE 檢查，'
                         '而這四條本專案沒有一條是照原生算的。先還原它們才談得上立即金幣。')]),
    entry(id='dailyLogin', module='lib/engine.ts', export='apply',
          expression='14 天登入獎勵依 Count 欄發放',
          parts=[entry(part='每日內容與數量', status='native', ref='daily-rewards-parser-evidence.json',
                       note='原生 DailyRewardModel.ParseInfoDocs 只讀 Day、RewardType、Count 與兩種活動貨幣，'
                            '完全不讀 Reward 字串欄。')]),
    entry(id='achievements', module='lib/engine.ts', export='achievementTier',
          expression='22 項成就各五階門檻，達成後發放鑽石',
          parts=[
              entry(part='門檻與獎勵欄位', status='native', ref='achievement-parser-evidence.json',
                    note='原生 AchievementModel.Initialize 讀 Type、Requirement、Reward；Requirement 是 GHDouble '
                         '清單，Reward 存進名為 diamondReward 的欄位。'),
              entry(part='兩項的進度來源', status='invented',
                    note='ParticipatedTournament 與 Manny 所需系統未實作，標為不可領取。')]),
    entry(id='dailyTasks', module='lib/engine.ts', export='dailyTaskProgress',
          expression='10 項每日成就，達成後發放鑽石與活動幣',
          parts=[
              entry(part='門檻、啟用旗標與獎勵字串', status='native', ref='achievement-parser-evidence.json'),
              entry(part='五項的進度來源與三種貨幣', status='invented',
                    note='廣告、單人突襲、鑽石妖精、增益妖精與每日裝備未實作；突襲券、鍊金與寶石貨幣尚不存在，'
                         '介面標明未開放而不自行折算。')]),
    entry(id='tutorial', module='lib/engine.ts', export='tutorialMet',
          expression='51 步教學，每步在進度達到門檻時完成並發放金幣',
          parts=[
              entry(part='目標判定與進度來源', status='native', ref='tutorial-evidence.json',
                    note='原生 TutorialEventModel.IsObjectiveMet 為 GetCurrentProgress() ≥ ObjectiveAmount；'
                         'TapCount 讀模型自己的 CurrentTapCount（換步歸零），SwordMasterLevel、ReachStage 與 '
                         'UnlockHelperCount 皆為絕對值。'),
              entry(part='步驟、門檻、金幣與文字', status='table', ref='TutorialEventInfo.json',
                    note='採基礎變體：B 變體與其完全相同，A 變體只調高點擊次數（27 列不同），'
                         '執行期採用哪一份由伺服器指派。'),
              entry(part='金幣獎勵的換算', status='invented',
                    note='資料表的 GoldReward 是隻數而非絕對金幣，本專案照登入獎勵的作法乘上當前關卡的'
                         '普通泰坦金幣；原生如何換算尚未查證。')]),
    entry(id='themes', module='lib/tt2-themes.ts', export='themeIndex',
          expression='每 5 關換一個場景，14 個場景循環',
          parts=[entry(part='場景順序與每段關卡數', status='table', ref='BackgroundInfo.json')]),
    entry(id='limits', module='lib/tt2-limits.ts', export='STAGE_CAP',
          expression='關卡 98000、英雄等級 6000、劍術大師等級 12500',
          parts=[
              entry(part='關卡上限', status='table', ref='ServerVarsInfo.json', note='maxStage 的 iOS 欄。'),
              entry(part='英雄等級上限', status='table', ref='HelperImprovementsInfo.json', note='最大 Level。'),
              entry(part='劍術大師等級上限', status='table', ref='PlayerImprovementsInfo.json', note='最大 Level。')]),
    entry(id='bigNumbers', module='lib/big-number.ts', export='normalise',
          expression='尾數與指數分開保存，與原生 GHDouble 同構',
          parts=[entry(part='表示法', status='native', ref='native-number-type.json',
                       note='原生 GHDouble 以 significand 與 exponent 兩個 double 保存，沒有對應的封頂常數。')]),
    entry(id='titanSkip', module='lib/engine.ts', export='titanSkip',
          expression='(TitanSkip + 該來源的 TitanSkip) × TitanSkipMult，取整數',
          parts=[entry(part='算式與逐來源分流', status='native',
                       ref='skip-evidence.json',
                       note='原生 StageLogic.GetTitanSkip(DamageType) 依傷害來源分支，'
                            '把該來源專屬的加成加到共用的 BonusType.TitanSkip 上，'
                            '再乘唯一的全域 BonusType.TitanSkipMult，最後以 GHDouble.op_Explicit 取整數。'
                            '只從 StageLogic.OnMonsterDeath 進入，所以是擊殺時觸發而非每次命中；'
                            '被跳過的泰坦仍走 GetNonBossSplashGoldDrop 給金幣。'
                            '原生六個來源中本專案有天堂聖擊、寵物與影分身三個，'
                            '公會飛船、匕首與金槍的加成不折算到別的來源上。')]),
    entry(id='stageSkip', module='lib/engine.ts', export='stageSkip',
          expression='(StageSkip + 該來源的 StageSkip) × 該來源的 Mult（沒有就不乘），取整數',
          parts=[entry(part='算式與逐來源分流', status='native',
                       ref='skip-evidence.json',
                       note='原生 StageLogic.GetStageSkip(DamageType) 與跳泰坦同形，'
                            '差別在倍率是逐來源的：天堂聖擊有 BurstSkillStageSkipMult、'
                            '影分身有 ShadowCloneStageSkipMult，寵物那條原生就沒有倍率。'
                            '跳過的每一關走 GetBossSplashGoldDrop 給頭目金幣。'
                            '原生七個來源中本專案有三個；寵物爆發（PetQTEStageSkip）對應的'
                            'PetBurst 傷害來源尚未實作，因此不計入寵物那一條。')]),
    entry(id='tapFromHelpers', module='lib/engine.ts', export='tapFromHelpers',
          expression='max(0, TapDamage 加成 × 英雄 DPS^0.5 × TapDamageFromHelpers × TapDamageFromHelpersMult)',
          parts=[entry(part='兩項相加的結構與三次乘法', status='native',
                       ref='tap-from-helpers-evidence.json',
                       note='原生 PlayerModel.GetTapDamage(等級, 轉換對象) 就是 '
                            'GetSwordMasterDamage(等級) ＋ GetTapFromHelpers(轉換對象)，只有一個加法；'
                            '後者是 Max(0, 該轉換的係數 × GetAllHelperDPS(轉換對象) '
                            '× TapDamageFromHelpers × TapDamageFromHelpersMult)。'
                            '劍術大師那一支把 GetBonus(TapDamage) 直接寫進 Pow 的輸出槽並跳過 Pow，'
                            '所以它的係數就是那個加成本身。'),
                 entry(part='指數 0.5', status='default',
                       ref='tap-from-helpers-evidence.json',
                       note='指數在 HelperModel.GetAllHelperDPS 裡套到英雄 DPS 上，逐轉換對象各有欄位：'
                            '劍術大師是 helperToTapDPSPower（位移 0x700，編譯期預設值 0.5），'
                            '影分身是 helperToCloneTapDPSPower（0x708，0.6）。'
                            '這兩個是 [ServerVar]，安裝包的變數表沒有帶值，線上可覆蓋，故為 default。'
                            '少了這個指數，轉換出來的點擊傷害會高出好幾個數量級。')]),
]

NOT_FORMULAS = {
    'plumbing': ['fresh', 'hydrate', 'advance', 'apply', 'note', 'fmt', 'freshTT2', 'tt2Random', 'toAmount'],
    'accessor': [
        'heroLevel', 'isBoss', 'monsterIndex', 'weaponSets', 'reward', 'tapDamage', 'dps', 'petAttackDamage',
        'swordMasterBaseDamage', 'stateEffect', 'effect', 'baseEffect', 'artifactAllDamage', 'effectText',
        'spentPoints', 'achievementProgress', 'achievementClaimed', 'achievementReward', 'dailyTaskAvailable',
        'dailyTaskClaimed', 'dailyTaskDone', 'playerMilestone', 'nextPlayerMilestone', 'perkLevel', 'perkLimit',
        'activeCombatPet', 'petRequiredTaps', 'activatePerk', 'manaSeconds', 'chargePet', 'themeStageRange',
        'canDiscover', 'canBuyTalent', 'discoveryPool', 'drawArtifact', 'collectGear', 'dropGear', 'craftSet',
        'awardPet', 'heroPowerBoost', 'heroSkillValue', 'equipmentEffect', 'equipmentValue',
        'artifactCost', 'skillCost', 'skillDuration', 'skillCooldown', 'skillMana', 'critMultiplier',
        'manaCapDamage', 'helperWeaponDamage', 'maxStageDamage', 'skillCap', 'cloakedStageSkip', 'stateResolver', 'effectResolver',
        'multiMonsterMaxCount', 'multiMonsterGold',
        'chestChance', 'megaBombMaxStacks', 'megaBombStackLength', 'chestersonActive',
        'fairiesUnlocked', 'loginStreakIntact', 'loginStreakDays',
        'qteReady', 'advanceQTE', 'qteUnlocked', 'freshQTESlots', 'petBurstTaps', 'helperOrbBounces',
        'monsterCount', 'unlockedSkills', 'skillStep', 'discoveryCost', 'craftPrice', 'buildMultiplier', 'manaRegen', 'achievementTier',
        'advanceEggs', 'playerUpgradeCost', 'playerBaseDamage', 'themeIndex', 'goldReward', 'health', 'heroDps',
        'cost', 'critChance', 'manaMax', 'bossDuration', 'relicGain', 'evolveCost', 'buildDamage', 'skillPower',
        'petDamageFactor', 'artifactValue', 'upgradeArtifactCost', 'heroPassiveTotals', 'perkValue',
        'rainIntervalScale',
        'dailyTaskProgress', 'normalise', 'tutorialStep', 'tutorialProgress', 'tutorialText'],
    'catalog': [
        'HEROES', 'SKILLS', 'SKILL_DATA', 'SKILL_ORDER', 'TT2_RULESET', 'bonusDefinitions',
        'EFFECT_LABELS', 'effectLabel', 'BUILD_COEFFICIENTS', 'PLAYER_DEFAULTS', 'RESOURCE_PERKS',
        'EGG_INTERVAL', 'PENDING_HERO_EFFECTS', 'heroSkills', 'THEME_STAGES', 'TT2_THEMES', 'HELPER_DEFAULTS',
        'BONUS_DEFAULTS', 'MANA_DEFAULTS', 'PRESTIGE_DEFAULTS', 'MULTI_MONSTER_MIN', 'MEGA_BOMB', 'CHESTERSON', 'FAIRY', 'STAGE_SCALE_GOLD', 'LOGIN_STREAK_DAYS',
        'TT2_QTE', 'QTE_TYPE', 'QTE_MIN_COOLDOWN', 'QTE_COOLDOWN_MULTIPLIERS',
        'HERO_LEVEL_CAP', 'PLAYER_LEVEL_CAP', 'UNMEASURED_ACHIEVEMENTS', 'UNMEASURED_DAILY_TASKS',
        'DAILY_TASK_PAID', 'cap'],
    'arithmetic': [
        'fromNumber', 'toNumber', 'add', 'negate', 'subtract', 'multiply', 'divide', 'power',
        'compare', 'toStorage', 'fromStorage', 'isBig', 'big', 'max', 'min', 'sum', 'pow', 'scale',
        'atLeastZero', 'ceil', 'ratio', 'fromText', 'ZERO', 'ONE'],
    'calendar': ['dayAt', 'weekAt'],
    'retired': ['bonus', 'gearBonus', 'passive'],
}

STATUSES = {
    'native': '由反組譯證據確認',
    'table': '取自安裝包資料表',
    'default': '原生靜態預設值，線上可覆蓋',
    'baseline-75': '沿用 7.5 基準，尚未對 8.2 核實',
    'table-differs': '安裝包有值但引擎目前未照做',
    'invented': '本專案自訂，安裝包未提供',
    'server': '原生為伺服器變數，安裝包未帶值',
}


def main():
    # Every formula's own export is also listed under accessor so the coverage check stays simple:
    # the register is about the formula, the coverage list is about the exported name.
    document = dict(
        version='8.2.0',
        role='每個核心公式的來源登記表：資料表、原生方法、原生預設值，或明確標記為 7.5 基準沿用、專案自訂或伺服器供給。',
        statuses=STATUSES, formulas=FORMULAS, notFormulas=NOT_FORMULAS,
        limits=['狀態是對「來源」的判定，不是對「數值正確」的保證',
                '標記 table 或 native 只代表與安裝包一致，線上伺服器仍可能覆蓋'])
    target = ROOT/'docs/formula-sources.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    counts = {}
    for formula in FORMULAS:
        for part in formula['parts']:
            counts[part['status']] = counts.get(part['status'], 0) + 1
    parts = sum(len(formula['parts']) for formula in FORMULAS)
    print(f'Wrote {len(FORMULAS)} formulas, {parts} parts: '
          + ', '.join(f'{key} {value}' for key, value in sorted(counts.items())))


if __name__ == '__main__':
    main()
