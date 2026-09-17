# 伺服器變數缺口盤點

原生共有 953 個 `[ServerVar]` 欄位，有**兩條各自獨立的線索**：

1. **安裝包的兩張變數表**帶了 37 個鍵，其中 28 個對得上原生欄位。
2. **程式裡的編譯期預設值**：`ServerVarsModel` 的類別建構式在任何伺服器回應之前先賦值，其中 769 個欄位解得出來（見 reference/tt2/8.2.0/servervar-defaults.json）。

兩者都沒有的欄位有 183 個——那才是真正無法從包內核實的部分。**要注意：預設值不是線上值**，伺服器可以整份覆蓋，例如 `maxStage` 的預設值是 1,000,000、被變數表覆寫成 98,000。

依 ROADMAP 項目分組（僅依欄位名稱路由，名稱不等於公式）：

| 項目 | 原生欄位數 | 變數表有值 | 程式有預設值 | 兩者皆無 | 變數表帶的欄位 |
|---|---|---|---|---|---|
| 未分類 | 603 | 16 | 464 | 138 | additiveRelicMultiplierMax、endGamePetImprovementLevelDelta、endGamePetImprovementLevelStart、fishingMinigamePrestigeRewardLimit、fishingMinigameTackleboxBaseSize、fishingMinigameTackleboxCollectTime、gemstonesCurrencyCost、gemstonesDiamondCost、gemstonesUnlockInHours、gemstonesUnlockStage、honourStageOffset、hoursToCollectEgg、hoursToCollectEndgameEgg、maxEndgamePetEggs、maxStage、minVersion |
| M04-M08 突襲與賽事 | 85 | 2 | 68 | 17 | raidCardCrystalLevelRank、raidCardCrystalUnlockLevel |
| B03-B09 流派 | 74 | 8 | 65 | 9 | clanNameChangeCost、petParadiseRewardXp、petQuestRerollCostPromotionMult、petQuestRerollPromotion、pet_paradise_max_shovels、pet_paradise_shovel_diamond_cost、pet_paradise_shovel_purchase_amount、pet_paradise_shovel_purchase_daily_limit |
| C05 泰坦與金幣 | 67 | 0 | 61 | 6 | （無） |
| E01-E05 蛻變與神器 | 30 | 1 | 29 | 1 | relicsStageMax |
| I01-I03 裝備 | 26 | 0 | 26 | 0 | （無） |
| C03-C04 英雄 | 22 | 0 | 19 | 3 | （無） |
| C07 魔力 | 18 | 0 | 13 | 5 | （無） |
| B01-B02 法術 | 11 | 1 | 10 | 1 | skillPointsPrestigeMax |
| C01 暴擊 | 10 | 0 | 8 | 2 | （無） |
| C02 劍術大師 | 4 | 0 | 4 | 0 | （無） |
| C06 濺射與跳關 | 3 | 0 | 2 | 1 | （無） |

由 `node tools/server-var-gaps.mjs` 產生；逐欄位狀態（含每個欄位的預設值）見 server-var-gaps.json。
