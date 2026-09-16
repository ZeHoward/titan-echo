# 伺服器變數缺口盤點

原生共有 953 個 `[ServerVar]` 欄位，安裝包的兩張變數表只帶了 37 個鍵；其中 28 個對得上原生欄位。**沒有值的欄位代表線上參數不在安裝包內，無法從包內核實。**

依 ROADMAP 項目分組（僅依欄位名稱路由，名稱不等於公式）：

| 項目 | 原生欄位數 | 安裝包有值 | 有值的欄位 |
|---|---|---|---|
| 未分類 | 603 | 16 | additiveRelicMultiplierMax、endGamePetImprovementLevelDelta、endGamePetImprovementLevelStart、fishingMinigamePrestigeRewardLimit、fishingMinigameTackleboxBaseSize、fishingMinigameTackleboxCollectTime、gemstonesCurrencyCost、gemstonesDiamondCost、gemstonesUnlockInHours、gemstonesUnlockStage、honourStageOffset、hoursToCollectEgg、hoursToCollectEndgameEgg、maxEndgamePetEggs、maxStage、minVersion |
| M04-M08 突襲與賽事 | 85 | 2 | raidCardCrystalLevelRank、raidCardCrystalUnlockLevel |
| B03-B09 流派 | 74 | 8 | clanNameChangeCost、petParadiseRewardXp、petQuestRerollCostPromotionMult、petQuestRerollPromotion、pet_paradise_max_shovels、pet_paradise_shovel_diamond_cost、pet_paradise_shovel_purchase_amount、pet_paradise_shovel_purchase_daily_limit |
| C05 泰坦與金幣 | 67 | 0 | （無） |
| E01-E05 蛻變與神器 | 30 | 1 | relicsStageMax |
| I01-I03 裝備 | 26 | 0 | （無） |
| C03-C04 英雄 | 22 | 0 | （無） |
| C07 魔力 | 18 | 0 | （無） |
| B01-B02 法術 | 11 | 1 | skillPointsPrestigeMax |
| C01 暴擊 | 10 | 0 | （無） |
| C02 劍術大師 | 4 | 0 | （無） |
| C06 濺射與跳關 | 3 | 0 | （無） |

由 `node tools/server-var-gaps.mjs` 產生；逐欄位狀態見 server-var-gaps.json。
