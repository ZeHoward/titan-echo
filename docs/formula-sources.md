# 核心公式來源登記表

每個核心公式的來源登記表：資料表、原生方法、原生預設值，或明確標記為 7.5 基準沿用、專案自訂或伺服器供給。

版本 8.2.0。共 26 條公式、44 項來源條目。

| 狀態 | 意義 | 條目數 |
|---|---|---|
| `native` | 由反組譯證據確認 | 4 |
| `table` | 取自安裝包資料表 | 14 |
| `default` | 原生靜態預設值，線上可覆蓋 | 2 |
| `baseline-75` | 沿用 7.5 基準，尚未對 8.2 核實 | 11 |
| `table-differs` | 安裝包有值但引擎目前未照做 | 1 |
| `invented` | 本專案自訂，安裝包未提供 | 8 |
| `server` | 原生為伺服器變數，安裝包未帶值 | 4 |

## 逐條登記

### monsterHealth · `lib/engine.ts` 的 `health`

18 × 1.32^(關卡-1) × 頭目倍率 × (1 − MonsterHP 減免)

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 頭目倍率序列 [2,3,4,5,8] | `table-differs` | `reference/tt2/8.2.0/TitanScalingInfo.json`；安裝包的 ThemeMultiplierSequence 分四段：關卡 1–5 為 2,3,4,5,8、6–39 為 4,6,8,15,24、40–59 為 8,12,16,30,48、60 起回到 2,3,4,5,8，四個來源變體（含 A／B／C）在這四列完全一致。引擎對所有關卡只用第一段，因此 6–59 關的頭目血量偏低。尚未套用的原因：選列由 MonsterModel 存的索引決定（GetCurrentScalingInfo 只做邊界檢查後取 list[index]），該索引如何更新尚未查證，且 themeMultiplierSequence 同時是 ServerVarsModel 的 [ServerVar] 靜態欄位，線上可整份覆蓋。 |
| 基礎值 18 與每關成長率 1.32 | `baseline-75` | 沿用 7.5 基準。安裝包的 MonsterHPScaling 只給倍率修正而非基礎曲線，且 A／B 變體不同（B 在關卡 1–3 為 0.3／0.4／0.475），屬 A／B 指派結果，無法從安裝包單獨確定。 |
| MonsterHP 減免上限 0.9 | `invented` | 引擎自訂的安全上限，避免血量歸零；安裝包未見對應上限。 |

### monsterGold · `lib/engine.ts` 的 `goldReward`

5 × 1.27^(關卡-1) × 各項金幣加成

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 基礎值 5 與成長率 1.27 | `baseline-75` | 沿用 7.5 基準，安裝包未找到對應的逐關金幣曲線表。 |
| 加成代號（GoldAll、JackpotGold、ChestAmount…） | `table` | `reference/tt2/8.2.0/native-bonus-types.json`；代號對照原生 BonusType 列舉，數值來自神器與天賦資料表。 |
| 寶箱泰坦基礎機率 0.02 | `server` | 原生對應欄位是 [ServerVar]，安裝包未帶值。 |

### heroDamage · `lib/engine.ts` 的 `heroDps`

基礎傷害 × 等級 × 1.035^(等級-1) × 里程碑倍率 × 武器與流派加成

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 英雄基礎傷害 | `table` | `reference/tt2/8.2.0/HelperInfo.json`；DefaultDamageAmount 欄。 |
| 里程碑倍率 | `table` | `reference/tt2/8.2.0/HelperImprovementsInfo.json`；依等級取最後一列的累計倍率，資料表最高 6000 級。 |
| 每級成長率 1.035 | `baseline-75` | 沿用 7.5 基準，安裝包未見對應欄位。 |

### heroCost · `lib/engine.ts` 的 `cost`

基礎費用 × (1.075^(等級+購買數) − 1.075^等級) ÷ 0.075 × 費用減免

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 英雄基礎費用 | `table` | `reference/tt2/8.2.0/HelperInfo.json`；PurchaseCost1 欄，最高一筆為 1.0000E+240。 |
| 成長率 1.075 | `baseline-75` | 沿用 7.5 基準；劍術大師側的同名成長率另有原生預設值可對照。 |

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

0.02 + CritChance 加成，上限 1；暴擊倍率為 10 × CritDamage

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 基礎機率 0.02 與倍率 10 | `server` | 原生的暴擊參數是 [ServerVar] 欄位，安裝包沒有帶值；只有 helperCanCrit=false 有原生預設值。目前數值沿用 7.5 基準，屬待證據。 |

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
| 指數 1.7 與除數 100 | `baseline-75` | 沿用 7.5 基準；安裝包的 relicsStageMax 為 180000，與本式無直接對應。 |
| 開放門檻第 60 關 | `baseline-75` | 沿用 7.5 基準；安裝包未見對應的蛻變開放關卡欄位。 |
| 至少一顆聖物的下限 | `invented` | 引擎自訂：開放後即使在第一關蛻變也給一顆，安裝包未見對應下限。 |

### evolveCost · `lib/engine.ts` 的 `evolveCost`

英雄基礎費用 × 1e4^已昇階次數 × 1e6

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 1e4 與 1e6 係數 | `invented` | 昇階費用尚未由安裝包還原；HelperInfo 的 AscendCostExpo1–6 欄位尚未接入。 |

### skillPoints · `lib/engine.ts` 的 `apply`

可用技能點 = floor(最高關卡 ÷ 50) − 1，只在最高關卡推進時增加

| 來源條目 | 狀態 | 依據 |
|---|---|---|
| 每 50 關一點與起算偏移 | `baseline-75` | 沿用 7.5 基準；安裝包未見對應的技能點發放欄位。 |

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
| 間隔與上限 | `baseline-75` | 沿用 7.5 基準；安裝包未見對應的寵物蛋補充間隔欄位。 |

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
