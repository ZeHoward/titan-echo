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
          expression='18 × 1.32^(關卡-1) × 頭目倍率 × (1 − MonsterHP 減免)',
          parts=[
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
                         '線上可覆蓋，故為 default。')]),
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
                            '引擎原本固定 10 隻，早期偏多、後期遠遠偏少。線上可覆蓋，故為 default 而非 native。')]),
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
              entry(part='主動技能倍率', status='table', ref='ActiveSkillInfo.json')]),
    entry(id='skillValues', module='lib/engine.ts', export='skillPower',
          expression='技能等級對應的倍率 × 對應加成 × 全主動技能加成',
          parts=[entry(part='各級倍率、持續、冷卻與魔力', status='table', ref='ActiveSkillInfo.json')]),
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
                            '2.13.0 起改用原生值並接上機率加成與暴擊傷害加成。線上可覆蓋，故為 default。')]),
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
              entry(part='累加倍率那一項未實作', status='table-differs', ref='relic-curve-evidence.json',
                    note='原生在上式中還乘一項 GetCurrentAdditiveRelicMultiplierBonus() + '
                         'stageRushToRelicMultiplier × GetRewardableAdditiveRelicMultiplierAmount()，'
                         '係數的編譯期預設值是 float 0.00017。它背後整套累加倍率系統本專案沒有實作，'
                         '也沒有安全的預設值可以代入（乘 0 會讓聖物歸零），所以沒有接。'),
              entry(part='進位方向', status='table-differs', ref='relic-curve-evidence.json',
                    note='原生以 GHDouble.Ceiling 無條件進位，引擎用 Math.floor 捨去。'
                         '在目前的近似曲線下改成進位只會讓每次蛻變多零或一顆，'
                         '但它與上面那條曲線是同一個回傳值的兩端，一起換才有意義。'),
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
              entry(part='至少一顆聖物的下限', status='invented',
                    note='引擎自訂：開放後即使在第一關蛻變也給一顆，安裝包未見對應下限。'),
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
              entry(part='隨機配發、票券與立即金幣未還原', status='table-differs', ref='perk-evidence.json',
                    note='原生的 perk 選擇在第 1200 關解鎖（perkSelectUnlockStage），另有票券制'
                         '（perkTicketCost = 10），本專案兩個 perk 固定可用、兌換次數來自登入獎勵。'
                         '黃金雨的立即金幣走 GetMakeItRainGold，以 makeItRainStageMult（1.0）與 '
                         'makeItRainMaxStageMult（0.85）配合目前與歷史最高關卡計算，尚未還原。'
                         'PerkInfo 共 19 列，本專案只實作其中兩列。')]),
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
        'BONUS_DEFAULTS', 'MANA_DEFAULTS', 'PRESTIGE_DEFAULTS',
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
