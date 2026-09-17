# 核心公式來源登記表

每個核心公式的來源登記表：資料表、原生方法、原生預設值，或明確標記為 7.5 基準沿用、專案自訂或伺服器供給。

版本 8.2.0。共 30 條公式、56 項來源條目。

| 狀態 | 意義 | 條目數 |
|---|---|---|
| `native` | 由反組譯證據確認 | 6 |
| `table` | 取自安裝包資料表 | 16 |
| `default` | 原生靜態預設值，線上可覆蓋 | 7 |
| `baseline-75` | 沿用 7.5 基準，尚未對 8.2 核實 | 4 |
| `table-differs` | 安裝包有值但引擎目前未照做 | 5 |
| `invented` | 本專案自訂，安裝包未提供 | 10 |
| `server` | 原生為伺服器變數，安裝包未帶值 | 8 |

## 逐條登記

### monsterHealth · `lib/engine.ts` 的 `health`

18 × 1.32^(關卡-1) × 頭目倍率 × (1 − MonsterHP 減免)

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 頭目倍率序列 [2,3,4,5,8] | `table-differs` | `reference/tt2/8.2.0/TitanScalingInfo.json`；安裝包的 ThemeMultiplierSequence 分四段：關卡 1–5 為 2,3,4,5,8、6–39 為 4,6,8,15,24、40–59 為 8,12,16,30,48、60 起回到 2,3,4,5,8，四個來源變體（含 A／B／C）在這四列完全一致。引擎對所有關卡只用第一段，因此 6–59 關的頭目血量偏低。**尚未套用**，原因有三：一、選列不是關卡的純函數——MonsterModel.StageChangedPreSpawnHandler 會呼叫 UpdateCurrentScalingInfo，後者用 GetScalingIndex 從目前索引往前掃，GetCurrentScalingInfo 只是對這個有狀態的索引做邊界檢查後取 list[index]；二、換段時還會先 RemoveCurrentScalingBonuses 再以 BonusModel.ModifyBonus 套用該列的 bonusA／bonusB，倍率序列只是該列的一部分；三、themeMultiplierSequence 同時是 ServerVarsModel 的 [ServerVar] 靜態欄位，線上可整份覆蓋。 |
| 基礎值 18 與每關成長率 1.32 | `table-differs` | `reference/tt2/8.2.0/monster-curve-evidence.json`；原生沒有「基礎值 × 成長率^關卡」這種寫法：MonsterModel.GetMonsterBaseHP 把關卡先加上 ActiveHonourAmount × honourStageOffset（安裝包值 250），再呼叫共用的 GetMonsterBase，其形狀已逐式還原為 mult × base1^min(關卡, levelOff) × base2^(expo1 × max(關卡−levelOff,0)^expo2) ÷ base3^(expo3 × max(關卡−transcendenceLevelOff,0)^expo4)。十個具名 [ServerVar] 的編譯期預設值也都解出來了：mult 17.5、base1 1.38、base2／base3 10、expo1 0.03、expo2 1.098、expo3 1、expo4 1.098、levelOff 100、transcendenceLevelOff 180000（高於關卡上限，故除數在可玩範圍恆為 1）。**尚未採用**：照原生算，基礎血量在第 250 關之後就低於引擎現值，第 2000 關差 10^107、第 98000 關差 10^2745，等於整條難度曲線換掉；金幣曲線同樣要一起換，英雄傷害那邊也還多著一項 1.035。取捨記在 ROADMAP 的「待決定的取捨」。另外 MonsterHPScaling 的 A／B 變體彼此不同（B 在關卡 1–3 為 0.3／0.4／0.475），屬 A／B 指派結果。 |
| MonsterHP 減免上限 0.9 | `invented` | 引擎自訂的安全上限，避免血量歸零；安裝包未見對應上限。 |

### monsterGold · `lib/engine.ts` 的 `goldReward`

5 × 1.27^(關卡-1) × 各項金幣加成

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 基礎值 5 與成長率 1.27 | `table-differs` | `reference/tt2/8.2.0/monster-curve-evidence.json`；原生 MonsterModel.GetMonsterBaseGold 走的是與血量同一條 GetMonsterBase，參數為 monsterGoldLevelOff、monsterTransendenceGoldLevelOff、monsterGoldMult、monsterGoldBase1–3 與 monsterGoldExpo1–4 共十個具名 [ServerVar]；兩張變數表都沒帶值，但編譯期預設值已解出：mult 17.5、base1 1.38、base2／base3 10、expo1 0.04、expo2 1.036、expo3 1、expo4 1.098、levelOff 100、transcendenceLevelOff 180000。目前的 5 與 1.27 是 7.5 基準的近似，**尚未採用**原生曲線——它必須與血量曲線一起換，取捨記在「待決定的取捨」。 |
| 加成代號（GoldAll、JackpotGold、ChestAmount…） | `table` | `reference/tt2/8.2.0/native-bonus-types.json`；代號對照原生 BonusType 列舉，數值來自神器與天賦資料表。 |
| 寶箱泰坦基礎機率 0.01 | `default` | `reference/tt2/8.2.0/bonus-defaults-evidence.json`；BonusModel.SetDefaultBonuses 把 ChestChance 的基礎值設為 chestersonChance（0.01）；引擎原本是 0.02，2.13.0 起改用原生值並與暴擊同樣乘上 AllProbabilityBoost。線上可覆蓋，故為 default。 |

### monsterCount · `lib/engine.ts` 的 `monsterCount`

round(8 + 關卡 × 148 ÷ (32000 + 關卡))

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 算式與 base 8、inc 148、delta 32000 | `default` | `reference/tt2/8.2.0/monster-count-evidence.json`；原生 StageLogic.GetRawMonsterCountPerStage 依序讀 monsterCountInc、monsterCountStageDelta、monsterCountBase，算 base + 關卡 × inc ÷ (delta + 關卡) 後交給 Math.Round（平手進偶數）。三個欄位是 [ServerVar]，安裝包的兩張變數表都沒有帶值，但類別建構式有編譯期預設值 8／148／32000（見 servervar-defaults.json）。因此第 1 關 8 隻、第 500 關 10 隻、第 2000 關 17 隻、第 98000 關 120 隻；引擎原本固定 10 隻，早期偏多、後期遠遠偏少。線上可覆蓋，故為 default 而非 native。 |

### bossHealthMod · `lib/engine.ts` 的 `health`

頭目血量在小怪基礎上再乘一組倍率

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| bossHPModBase 與 bossHPModStageMult | `table-differs` | `reference/tt2/8.2.0/servervar-defaults.json`；原生除了 ThemeMultiplierSequence 另有這兩個 [ServerVar] 參與頭目血量。兩張變數表沒帶值，但編譯期預設值已解出：bossHPModBase 1.13、bossHPModStageMult 0.005。**本專案仍未實作**：它們如何進入頭目血量（與 ThemeMultiplierSequence 的關係、是否隨關卡累加）尚未逐式還原，而且頭目血量是建立在尚未採用原生曲線的小怪血量之上。 |

### heroDamage · `lib/engine.ts` 的 `heroDps`

基礎傷害 × 等級 × 1.035^(等級-1) × 里程碑倍率 × 武器與流派加成

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 英雄基礎傷害 | `table` | `reference/tt2/8.2.0/HelperInfo.json`；DefaultDamageAmount 欄。 |
| 里程碑倍率 | `table` | `reference/tt2/8.2.0/HelperImprovementsInfo.json`；依等級取最後一列的累計倍率，資料表最高 6000 級；對上原生 LevelCurve.GetTotalImprovementByLevel 取的那一格，TT2_HERO_MILESTONES 就是該表 Ascension 0 的 PrecalculatedAmount 三欄。 |
| 每級成長率 1.035 | `table-differs` | `reference/tt2/8.2.0/hero-dps-evidence.json`；原生沒有這一項：HelperInfo.GetRawDPS 就是 LevelCurve.GetTotalImprovementByLevel(昇階, 等級) × 等級 × GetBaseDamage(昇階) 三個因子相乘，完整的 GetDPS 在外面只再乘武器、全體英雄加成與強化倍率；兩個方法的機器碼裡一個浮點常數都沒有載入，所以逐級成長率不可能藏在裡面——里程碑累計倍率本身就是整條曲線（Ascension 0 共 145 段，6000 級累計 1.18×10^189）。**尚未移除**：1.035 是 7.5 基準的產物，與同為 7.5 近似的怪物血量曲線（18 × 1.32^關卡，十個具名 [ServerVar] 在包內都沒有值）配套；單獨拿掉會讓英雄傷害在 1000 級時少 8.4×10^14 倍，等於在沒有原版難度基準的情況下只改一邊，因此保留現值並記在這裡。 |

### heroCost · `lib/engine.ts` 的 `cost`

基礎費用 × (1.08^(等級+購買數) − 1.08^等級) ÷ 0.08 × 費用減免

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 英雄基礎費用 | `table` | `reference/tt2/8.2.0/HelperInfo.json`；PurchaseCost1 欄，最高一筆為 1.0000E+240。 |
| 成長率 1.08 | `default` | `reference/tt2/8.2.0/helper-cost-evidence.json`；原生 ServerVarsModel.helperUpgradeBase 是 static float，類別建構式寫入的靜態預設值為 float 的 1.08（位元 0x3f8a3d71），整個建構式只寫這個欄位一次。它確實是費用公比：HelperInfo 的建構式讀它之後取對數存進 helperUpgradeBaseLog、把 base−1 存進 helperUpgradeBaseMinusOne，正是等比級數的兩個導出量，GetPurchaseCost 再以 GHDouble.Pow 乘上基礎費用。引擎原本的 1.075 是 7.5 基準，2.12.8 起改用 8.2 的預設值，以 Math.fround 保留 float 精度，與劍術大師側的 costBase／costGrowth 同級。相鄰的 helperUpgradeLevelTiers／Modulus／Offsets 三個 int[] 尚未解出內容。 |

### playerDamage · `lib/tt2-player.ts` 的 `playerBaseDamage`

等級 × 里程碑累計倍率 × 基礎傷害預設值

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 里程碑累計倍率 | `table` | `reference/tt2/8.2.0/PlayerImprovementsInfo.json`；TotalNew 欄，保留來源字串，最高 9.07E+363。 |
| 基礎傷害預設值 1 | `default` | ServerVarsModel 靜態預設值；線上覆蓋值未知。 |

### playerCost · `lib/tt2-player.ts` 的 `playerUpgradeCost`

5 × 1.075^等級 × (1.075^購買數 − 1) ÷ 0.075

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 基數 5 與成長率 1.075 | `default` | ServerVarsModel 靜態預設值 costBase 與 costGrowth（後者為 float 精度）；線上覆蓋值未知。 |

### artifactEffect · `lib/tt2-rules.ts` 的 `artifactValue`

數值 × 等級^指數，依加成型別決定加算或乘算

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 數值、指數與加成型別 | `table` | `reference/tt2/8.2.0/ArtifactInfo.json`；103 件神器逐件對照。 |
| 1e240 夾擠 | `invented` | 避免非有限值的安全網；在所有規則上限下最大倍率約 8.45×10^150，不構成封頂。 |

### artifactCost · `lib/tt2-rules.ts` 的 `upgradeArtifactCost`

費用係數 × (等級+1)^費用指數，四捨五入且至少 1

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 費用係數與指數 | `table` | `reference/tt2/8.2.0/ArtifactInfo.json` |

### heroPassive · `lib/tt2-hero-passives.ts` 的 `heroPassiveTotals`

達到解鎖等級的英雄被動逐項相加或相乘，並套用戰術洞察增幅

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 被動效果與解鎖等級 | `table` | `reference/tt2/8.2.0/HelperSkillInfo.json` |
| 四項尚未實作的被動 | `invented` | TapDamageFromHelpers、Goldx10Chance、MultiMonstersGold、PetGoldQTEAmount 的觸發時機尚未還原，列在 PENDING_HERO_EFFECTS 而不生效。 |

### buildDamage · `lib/engine.ts` 的 `buildDamage`

劍術大師裸傷^流派指數 × 英雄總傷^流派指數 × 流派加成

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 流派折減係數 | `invented` | 程式內已註明為暫用係數，公會飛船、匕首與金槍的完整戰鬥尚未還原。 |
| 主動技能倍率 | `table` | `reference/tt2/8.2.0/ActiveSkillInfo.json` |

### skillValues · `lib/engine.ts` 的 `skillPower`

技能等級對應的倍率 × 對應加成 × 全主動技能加成

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 各級倍率、持續、冷卻與魔力 | `table` | `reference/tt2/8.2.0/ActiveSkillInfo.json` |

### critical · `lib/engine.ts` 的 `critChance`

(0.01 + CritChance 加成) × AllProbabilityBoost，上限 1；暴擊倍率為 11.5 × CritDamage

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 基礎機率 0.01、倍率 11.5 與上限 1 | `default` | `reference/tt2/8.2.0/bonus-defaults-evidence.json`；兩張變數表確實沒帶值，但編譯期預設值有：BonusModel.SetDefaultBonuses 把 CritChance 的基礎值設為 playerCritChance（0.01），PlayerModel.RefreshCriticalValues 以 min(Bonus(CritChance) × Bonus(AllProbabilityBoost), maxCritChance) 算機率、以 playerCritMult（11.5）× Bonus(CritDamage) 算倍率，maxCritChance 為 1。引擎原本是 0.02 與固定 10 倍，而且點擊那一行寫死 10、沒有用 critMultiplier；2.13.0 起改用原生值並接上機率加成與暴擊傷害加成。線上可覆蓋，故為 default。 |

### mana · `lib/engine.ts` 的 `manaMax`

魔力上限 200 + ManaPoolCap；每秒回復 (2 + ManaRegen) ÷ 60 × ManaRegenMult × 藥水倍率

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 基礎上限 200 與基礎回復 2 | `server` | 對應原生欄位是 [ServerVar]，安裝包未帶值；沿用 7.5 基準。 |

### bossTimer · `lib/engine.ts` 的 `bossDuration`

30 秒 + BossTimerDuration

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 基礎 30 秒 | `server` | 原生為 [ServerVar]，安裝包未帶值。 |

### prestigeRelics · `lib/engine.ts` 的 `relicGain`

max(1, floor(關卡^1.7 ÷ 100 × PrestigeRelic))，最高關卡到 60 後開放

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 指數 1.7 與除數 100 | `server` | `reference/tt2/8.2.0/native-server-var-fields.json`；原生沒有「關卡^指數 ÷ 常數」這種寫法：PrestigeModel.GetBonusRelicsFromStageCount （RVA 0x23ff6cc）把係數從模型欄位載入（如 ldr d9,[x8,#0x170]、ldr d10,[x8,#0x1b0]、ldr w9,[x8,#0x214]），不是程式裡的常數。對應的具名 [ServerVar] 欄位有十個——relicStageBase、relicStageBase2、relicStageExpo、relicStageExpo2、relicStageExpo3、relicStageExpoMax3、relicStageMult1–3 與 relicStageOffset——**安裝包一個值都沒帶**。目前的 1.7 與 100 是 7.5 基準的近似，不是原版係數。 |
| 開放門檻第 60 關 | `baseline-75` | 沿用 7.5 基準；安裝包未見對應的蛻變開放關卡欄位。 |
| 至少一顆聖物的下限 | `invented` | 引擎自訂：開放後即使在第一關蛻變也給一顆，安裝包未見對應下限。 |
| 額外的聖物乘數（累加、季節、新手） | `server` | `reference/tt2/8.2.0/native-server-var-fields.json`；原生另有 additiveRelicMultiplier、seasonalRelicMultiplier 與新手加成三條乘數，共 31 個含 relic 的 [ServerVar] 欄位，包內只有 additiveRelicMultiplierMax（150000）與 relicsStageMax（180000）兩個有值；本專案尚未實作這三條乘數。 |

### evolveCost · `lib/engine.ts` 的 `evolveCost`

英雄基礎費用 × 1e4^已昇階次數 × 1e6

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 1e4 與 1e6 係數 | `invented` | 引擎自訂的等比近似，與原生結構不同：原生每位英雄在 HelperInfo 有 AscendCostExpo1–6 六個逐階係數（例如 H18 為 255、2216、4748.5、7281、9813.5、12346），不是同一個倍率連乘。**資料在包內、尚未接入**。 |
| 逐階係數的縮放 | `server` | `reference/tt2/8.2.0/native-server-var-fields.json`；接入前還缺一塊：原生另有 [ServerVar] ascendCostExpoScaling（與傷害側的 ascendDamageExpoScaling 對稱）以及 maximumHeroAscension、ascensionMinGoldExp，安裝包都沒有值，所以就算把六個係數接上也無法宣稱與線上一致。 |

### skillPoints · `lib/engine.ts` 的 `apply`

可用技能點 = floor(最高關卡 ÷ 50) − 1，只在最高關卡推進時增加

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 每 50 關一點與起算偏移 | `server` | `reference/tt2/8.2.0/native-server-var-fields.json`；原生把這兩個數字放在具名 [ServerVar]：skillPointsStageDelta（每幾關一點）與 skillPointsStageMin（起算關卡），另有 skillPointsPrestigeDelta／Min 走蛻變那條線；五個欄位中只有 skillPointsPrestigeMax 在包內有值（180000），決定發放節奏的那幾個都沒有。目前的 50 與 −1 是 7.5 基準的近似。 |

### petCombat · `lib/tt2-pet-combat.ts` 的 `petDamageFactor`

寵物傷害係數依等級分段，出戰與未出戰分開計算

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 分段係數 | `baseline-75` | `reference/tt2/8.2.0/PetInfo.json`；以 7.5 的 PetInfo 為準，8.2 對應欄位尚未逐格核對。 |
| 每 20 次有效點擊發動一次 | `baseline-75` | 沿用 7.5 基準；PetTapCountToAttack 加成可減少次數，但基準 20 未對 8.2 核實。 |

### eggs · `lib/tt2-collection.ts` 的 `advanceEggs`

每 4 小時補一顆寵物蛋，上限兩顆

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 四小時的補充間隔 | `table` | `reference/tt2/8.2.0/ServerVarOverride.json`；原生欄位是 [ServerVar] hoursToCollectEgg，而**安裝包的 ServerVarOverride 帶了值 4**，與本專案沿用的四小時一致；這是少數包內能核對上的欄位之一。該表屬 bundled-server-variable，線上是否被覆蓋未知。 |
| 上限兩顆 | `server` | `reference/tt2/8.2.0/native-server-var-fields.json`；對應的具名欄位是 maxPetEggs（另有 vipStatusMaxPetEggsAdditive 為 VIP 加成），兩者在安裝包內都沒有值；目前的 2 是 7.5 基準沿用，不是原版上限。 |

### cloneAttackRate · `lib/engine.ts` 的 `cloneAttackRate`

影分身每秒攻擊次數 = max(1, (1＋ShadowCloneSkillAttackRate) × CompanionAttackRate)

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 速率算式與每秒四次的基礎值 | `native` | `reference/tt2/8.2.0/damage-text-evidence.json`；原生 ActiveSkillModel.GetCloneAttackRate 以 GHDouble(1) 為底，取 Bonus(ShadowCloneSkillAttackRate) 與 Bonus(CompanionAttackRate) 相乘後與 1 取 Max；PlayerController.ShadowCloneAttackLoop 以 WaitForSeconds(1 ÷ 該速率) 間隔攻擊。**基礎值不是 1**：BonusModel.SetDefaultBonuses 把 ShadowCloneSkillAttackRate 的基礎值設為 baseShadowCloneAniPerSec，也就是 4，所以無加成時是每秒四次。2.12.7 誤以為是每秒一次，2.13.0 更正。 |
| 加法型加成代入 基礎值＋增量 | `default` | `reference/tt2/8.2.0/bonus-defaults-evidence.json`；加法型加成的基礎值就是 SetDefaultBonuses 設的那一個：ShadowCloneSkillAttackRate 為 4，天賦提供 0.1–0.95 的增量，兩者相加。 |
| 離散到 100ms 模擬步長，單次傷害為每秒總量 ÷ 速率 | `invented` | 引擎以 100ms 為一步推進，攻擊只在步邊界結算，因此單次間隔最多晚 100ms；計時器累加間隔而非改設為當下時間，長期平均頻率與速率一致。另外 buildDamage 是本專案的「每秒總量」近似，所以一次攻擊取其 ÷ 速率——節奏照原生，總量不因節奏改變，但單次數值不是原生的單次傷害。 |
| 特殊攻擊未實作 | `server` | ShadowCloneSkillSpecialRate 與 SpecialChance 另有節奏與機率，本專案未實作，也未核實其倍率來源。 |

### perks · `lib/tt2-perks.ts` 的 `perkValue`

增益每層 12 小時獨立計時；魔力藥水提高回復倍率，黃金雨依層數縮短自動購買間隔

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 層數倍率與間隔 | `baseline-75` | 取自 7.5 的 PerkInfo；原版的隨機配發與立即金幣尚未還原。 |

### dailyLogin · `lib/engine.ts` 的 `apply`

14 天登入獎勵依 Count 欄發放

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 每日內容與數量 | `native` | `reference/tt2/8.2.0/daily-rewards-parser-evidence.json`；原生 DailyRewardModel.ParseInfoDocs 只讀 Day、RewardType、Count 與兩種活動貨幣，完全不讀 Reward 字串欄。 |

### achievements · `lib/engine.ts` 的 `achievementTier`

22 項成就各五階門檻，達成後發放鑽石

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 門檻與獎勵欄位 | `native` | `reference/tt2/8.2.0/achievement-parser-evidence.json`；原生 AchievementModel.Initialize 讀 Type、Requirement、Reward；Requirement 是 GHDouble 清單，Reward 存進名為 diamondReward 的欄位。 |
| 兩項的進度來源 | `invented` | ParticipatedTournament 與 Manny 所需系統未實作，標為不可領取。 |

### dailyTasks · `lib/engine.ts` 的 `dailyTaskProgress`

10 項每日成就，達成後發放鑽石與活動幣

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 門檻、啟用旗標與獎勵字串 | `native` | `reference/tt2/8.2.0/achievement-parser-evidence.json` |
| 五項的進度來源與三種貨幣 | `invented` | 廣告、單人突襲、鑽石妖精、增益妖精與每日裝備未實作；突襲券、鍊金與寶石貨幣尚不存在，介面標明未開放而不自行折算。 |

### tutorial · `lib/engine.ts` 的 `tutorialMet`

51 步教學，每步在進度達到門檻時完成並發放金幣

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 目標判定與進度來源 | `native` | `reference/tt2/8.2.0/tutorial-evidence.json`；原生 TutorialEventModel.IsObjectiveMet 為 GetCurrentProgress() ≥ ObjectiveAmount；TapCount 讀模型自己的 CurrentTapCount（換步歸零），SwordMasterLevel、ReachStage 與 UnlockHelperCount 皆為絕對值。 |
| 步驟、門檻、金幣與文字 | `table` | `reference/tt2/8.2.0/TutorialEventInfo.json`；採基礎變體：B 變體與其完全相同，A 變體只調高點擊次數（27 列不同），執行期採用哪一份由伺服器指派。 |
| 金幣獎勵的換算 | `invented` | 資料表的 GoldReward 是隻數而非絕對金幣，本專案照登入獎勵的作法乘上當前關卡的普通泰坦金幣；原生如何換算尚未查證。 |

### themes · `lib/tt2-themes.ts` 的 `themeIndex`

每 5 關換一個場景，14 個場景循環

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 場景順序與每段關卡數 | `table` | `reference/tt2/8.2.0/BackgroundInfo.json` |

### limits · `lib/tt2-limits.ts` 的 `STAGE_CAP`

關卡 98000、英雄等級 6000、劍術大師等級 12500

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 關卡上限 | `table` | `reference/tt2/8.2.0/ServerVarsInfo.json`；maxStage 的 iOS 欄。 |
| 英雄等級上限 | `table` | `reference/tt2/8.2.0/HelperImprovementsInfo.json`；最大 Level。 |
| 劍術大師等級上限 | `table` | `reference/tt2/8.2.0/PlayerImprovementsInfo.json`；最大 Level。 |

### bigNumbers · `lib/big-number.ts` 的 `normalise`

尾數與指數分開保存，與原生 GHDouble 同構

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 表示法 | `native` | `reference/tt2/8.2.0/native-number-type.json`；原生 GHDouble 以 significand 與 exponent 兩個 double 保存，沒有對應的封頂常數。 |

## 界線

- 狀態是對「來源」的判定，不是對「數值正確」的保證
- 標記 table 或 native 只代表與安裝包一致，線上伺服器仍可能覆蓋
