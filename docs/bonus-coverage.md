# 加成覆蓋率對照表

每個加成三方對照：**專案有沒有來源會給**、**引擎有沒有讀**、**原生有沒有取值點**。
由 `node tools/bonus-coverage.mjs` 產生；原生那一欄來自 `tools/audit-bonus-readers.py`。

版本 8.2.0。共 796 個加成。

| 判定 | 意義 | 個數 |
|---|---|---|
| `live` | 專案有來源、引擎有讀：正常運作。 | 114 |
| `dead-native-uses-it` | 專案有來源、引擎沒讀，而且原生有取值點：**這些是可以接上的**。 | 115 |
| `dead-native-ignores-it` | 專案有來源、引擎沒讀，原生也掃不到取值點：接了大概也沒有依據。 | 68 |
| `read-without-source` | 引擎有讀，但專案沒有任何來源會給：恆為中性值，等來源出現才會生效。 | 13 |
| `not-in-project` | 專案沒有來源，引擎也沒讀。 | 486 |

## 優先：落在已實作系統的（51）

原生有取值點、我們沒讀，而且**不屬於尚未實作的流派**——這些是可以直接接上的。
依**原生讀取它的類別**分組，類別名就說明了它屬於哪個系統。

### StageLogic（5）

- `DualPetStageSkipMult` ← TT2_SETS
- `ManaMonsterSpawnChance` ← TT2_ARTIFACTS、TT2_SETS、TT2_TREE
- `PetQTEStageSkip` ← TT2_TREE
- `ShadowCloneBossSplash` ← TT2_SETS
- `StageSkipMonsterSpawnChance` ← TT2_ARTIFACTS、TT2_SETS

### GameSettingsPanel / PetController（2）

- `AutoActivatePetBossQTE` ← TT2_SETS
- `AutoActivatePetGoldQTE` ← TT2_SETS

### HelperModel（2）

- `HelperWeaponSetBoost` ← TT2_ARTIFACTS
- `InspiredHelperCount` ← TT2_TREE

### InactiveGameplayModel（2）

- `InactiveSneakCount` ← TT2_SETS
- `InactiveSneakCountMult` ← TT2_PETS、TT2_SETS

### PlayerController.<ShadowCloneAttackLoop>d__132（2）

- `CritBoostSkillShadowCloneDamage` ← TT2_SETS
- `ShadowCloneSkillSpecialRate` ← TT2_ACTIVE、TT2_SETS、TT2_TREE

### PrestigeModel（2）

- `AllActiveSkillAmountPerAdditiveRelicMultiplier` ← TT2_SETS
- `AdditiveRelicMultiplierEarned` ← TT2_SETS

### QTEController / StatsPanelScript（2）

- `CompanionQTECooldownMult` ← TT2_SETS
- `PetQTECooldownMult` ← TT2_SETS、TT2_TREE

### StageLogic / StatsPanelScript（2）

- `ManaMonsterAmount` ← TT2_TREE
- `ManaMonsterAmountMult` ← TT2_SETS

### TitanSoulsModel（2）

- `TitanSoulsChanceMult` ← TT2_SETS
- `TitanSoulsPerDayMult` ← TT2_SETS

### AchievementDailyListItem / RewardClass（1）

- `DailyTicketBoost` ← TT2_SETS

### ActivePerkInfo / PlayerController（1）

- `PerkDoomAmount` ← TT2_SETS

### ActivePerkModel（1）

- `ManaPotionSpellBoost` ← TT2_SETS

### ActiveSkillButton（1）

- `ManaRefundPercent` ← TT2_ARTIFACTS、TT2_SETS

### ActiveSkillListItemScript / ActiveSkillPanelScript / SpellSelectPanelScript / StatsPanelScript（1）

- `InspiredHelperDamage` ← TT2_SETS、TT2_TREE

### ActiveSkillModel（1）

- `AllMultiCastStacks` ← TT2_SETS

### ArtifactInfo（1）

- `ArtifactEnchantmentBoost` ← TT2_SETS

### ArtifactModel（1）

- `DamagePerOwnedEnchantment` ← TT2_SETS

### BasePetObject / ClanPlayerScript.<ClanPlayerLoop>d__19 / PlayerController.<ShadowCloneAttackLoop>d__132 / PlayerModel（1）

- `DeadlyChance` ← TT2_ACTIVE

### BonusModel（1）

- `JackpotGoldChance` ← TT2_ARTIFACTS、TT2_TREE

### BossTimerScript（1）

- `BossTimer` ← TT2_TREE

### ClanModel / StatsPanelScript（1）

- `ThunderVolleySkillAmount` ← TT2_SETS、TT2_TREE

### ClanPlayerScript / SkillTreeUIModel（1）

- `ActiveAllHelperDamage` ← TT2_TREE

### EquipmentModel（1）

- `EquipmentSecondaryDamageEffect` ← TT2_SETS

### HelperController（1）

- `HelperBoostCompanionAttackRate` ← TT2_SETS

### HelperController / HelperInfo / HelperModel（1）

- `HelperAttackRate` ← TT2_ACTIVE

### HelperController / SkillTreeUIModel（1）

- `HelperQTEDamage` ← TT2_TREE

### MonsterController.<WhiteAndFade>d__63 / StatsPanelScript（1）

- `MonsterActiveSpawnDuration` ← TT2_SETS

### MonsterModel（1）

- `StageSkipMonsterAmountMult` ← TT2_SETS

### PetController（1）

- `PetBossQTEDamage` ← TT2_TREE

### PetInfo（1）

- `ExoticPetDamageEffect` ← TT2_ARTIFACTS

### PetModel（1）

- `PetAttackQTEDamage` ← TT2_TREE

### PetModel / StatsPanelScript（1）

- `DualPetAmount` ← TT2_ARTIFACTS、TT2_TREE

### PlayerController（1）

- `ShadowCloneAllSkillDurationRate` ← TT2_TREE

### PlayerController / PlayerModel / SkillTreeUIModel（1）

- `ShadowCloneAllSkillBoost` ← TT2_TREE

### PlayerController / SkillTreeUIModel（1）

- `ActiveTapDamage` ← TT2_SETS、TT2_TREE

### PlayerController / StatsPanelScript（1）

- `ShadowCloneSkillSpecialDamage` ← TT2_TREE

### PlayerModel / SkillTreeBookItemScript（1）

- `ManaStealChance` ← TT2_TREE

### PlayerModel / StatsPanelScript（1）

- `ManaTapRegenAmount` ← TT2_TREE

### SpecialTitanModel（1）

- `DamagePerSpecialTitanActive` ← TT2_SETS

## 等流派實作再說的（64）

原生有取值點，但屬於本專案尚未實作的系統（見 `generatedFrom.unbuiltSystems`）。

- **StageLogic**：`AnyContractMonsterCount`、`ClanShipStageSkip`、`ClanShipStunDamage`、`ClanShipTitanSkip`、`GoldGunStageSkip`、`GoldGunTitanSkip`、`GoldenMissileStageSkip`、`RoyalContractBonusDamage`、`UltraDaggerStageSkip`、`UltraDaggerTargetComboStageSkip`、`UltraDaggerTitanSkip`
- **PlayerController**：`LightningStrikeDamage`、`LightningStrikeEfficiency`、`MagnumOpusDamage`、`StreamOfBladesSuperDamage`、`UltraDaggerTargetDamage`
- **ClanScrollModel**：`ClanScrollBoost`、`ClanScrollSetBoost`、`DamagePerClanScroll`
- **KratosTitanScript**：`KratosMonsterSpawnChance`、`KratosMonsterStacks`、`KratosSpellDurationEffect`
- **RaidPartDamagedEvent**：`SoloRaidAllDamage`、`AllRaidDamage`、`BurstDamage`
- **ForbiddenContract**：`ForbiddenContractManaCostBase`、`ForbiddenContractMaxDamage`
- **GoldGunController**：`GoldGunAttackRate`、`MagnumOpusDurationMult`
- **HaystTitanScript**：`AllProbabilityBoostDuringHayst`、`HaystMonsterSpawnChance`
- **PrestigeModel**：`SeasonalRelicAdditive`、`DamagePerLifetimePrestige`
- **RoyalContract**：`RoyalContractManaCostBase`、`RoyalContractMaxGold`
- **ActiveSkillButton / GameSettingsPanel**：`AutoActivateGoldenMissileSkill`
- **ActiveSkillModel**：`GoldenMissileSkillCooldown`
- **ClanLoyaltyController**：`LoyaltyLevel`
- **ClanModel**：`ThunderVolleySkillSpecialDamage`
- **ClanPlayerScript**：`ClanQTEAttackRate`
- **ClanShipScript**：`ClanShipBatteryCoefficient`
- **ClanShipScript / GameSettingsPanel / HelperController / PlayerController**：`AutoActivateWarlordQTE`
- **GameSettingsPanel / GoldGunModel**：`AutoActivateGoldGunQTE`
- **GameSettingsPanel / PlayerController**：`AutoActivateFrenzy`
- **GameSettingsPanel / TwilightFairyController**：`AutoActivateTwilightFairyQTE`
- **GoldGunModel**：`MagnumOpusRemoveGoldDrain`
- **KratosTitanScript / KratosUIScript**：`KratosMonsterBonusAmount`
- **MonsterController**：`ClanShipStunDuration`
- **MonsterModel**：`ForbiddenContractBonusGold`
- **PerkModel**：`DamagePerLifetimePerks`
- **PetModel / PlayerController / PlayerModel**：`FrenzyCount`
- **PlayerController / PlayerController.<ShadowCloneAttackLoop>d__132**：`TwilightFairyGloomBonusDamage`
- **PlayerController / StatsPanelScript**：`StreamOfBladesSkillAmount`
- **PlayerModel**：`DamagePerATParticipation`
- **QTEController / StageLogic / UltraDagger / UltraDaggerComboCountScript**：`UltraDaggerCount`
- **RaidSkillScript**：`RaidBaseDamage`
- **RaidTraitModel**：`PlayerRaidLevelCostReduction`
- **SeasonalArtifactModel**：`DamagePerOwnedMonument`
- **SoloRaidFloorListItem**：`SoloRaidRaidCardMult`
- **SoloRaidModel**：`DamagePerSoloRaidWorld`
- **StatsPanelScript / TwilightFairyController**：`TwilightFairySkillAmount`
- **TitanGachaModel**：`DamagePerNecroBearResearchLevel`
- **TwilightFairyController**：`TwilightFairySpawnChance`
- **UltraDagger**：`UltraDaggerPoisonBoost`

## 引擎有讀、但不是用名字查的

這些加成引擎確實有消費，只是沒有把名字寫出來，所以原始碼掃描看不到——逐項列在這裡才不會被誤判成沒作用。

- `AllArtifactDamageEffect` ← lib/tt2-rules.ts baseFrom：群組 Damage 的神器以索引 98 取用
- `AllArtifactGoldEffect` ← lib/tt2-rules.ts baseFrom：群組 Gold 的神器以索引 99 取用

## 原生也掃不到取值點的

專案有來源會給，但原生與我們都沒有取值點。接上去沒有依據，先不要動。

`AlchemistBonusBoost`、`AllManaSourceMult`、`LegacyPetDamageEffect`、`LegacyPetGoldEffect`、`AnyContractBonusBoost`、`AnyContractQTECooldown`、`AutoActivateContractsQTE`、`BeastBladeDamage`、`BoostedSwordAttackDamage`、`BurstDamageSkillManaMult`、`BurstDamageSkillStacks`、`BurstDamageSkillStacksBonus`、`CannonDamage`、`ClanQTECooldown`、`CritBoostSkillStacks`、`CritBoostSkillStacksBonus`、`DamagePerMythicSet`、`DamagePerLegendarySet`、`DamagePerUniqueSet`、`DualPetDuration`、`DualPetSkillStacks`、`DualPetSkillStacksBonus`、`EquipmentRarityChance`、`EquipmentUniqueChance`、`ExoticPetGoldEffect`、`FairyCooldown`、`FundamentalDamage`、`GoldPerLegendarySet`、`HandOfMidasSkillStacks`、`HandOfMidasSkillStacksBonus`、`HelperBoostSkillStacks`、`HelperBoostSkillStacksBonus`、`KnightBonusBoost`、`KronusComboBoost`、`LanceComboBoost`、`NohniComboBoost`、`PaladinBonusBoost`、`PetBonusBoost`、`PetGoldQTECooldown`、`PetQTEDamage`、`RogueBonusBoost`、`SajeComboBoost`、`ShadowCloneSkillStacks`、`ShadowCloneSkillStacksBonus`、`SkillTreeAlchemistAllDamage`、`SkillTreeRogueAllDamage`、`SkillTreeKnightAllDamage`、`SkillTreePetAllDamage`、`SkillTreeSorcererAllDamage`、`SkillTreeWarlordAllDamage`、`SophiaComboBoost`、`SorcererBonusBoost`、`StreamOfBladesDuration`、`StreamOfBladesSkillStacks`、`StreamOfBladesSkillStacksBonus`、`TapBoostSkillStacks`、`TapBoostSkillStacksBonus`、`ThunderVolleySkillDuration`、`ThunderVolleySkillStacks`、`ThunderVolleySkillStacksBonus`、`TwilightBoost`、`TwilightFairySkillDuration`、`TwilightFairySkillStacks`、`TwilightFairySkillStacksBonus`、`TitanSlayer`、`UltraDaggerCooldown`、`UnskilledGold`、`WarlordBonusBoost`

## 引擎有讀但專案沒有來源的

這些已經接好了，只是還沒有任何神器、天賦、寵物或套裝會給，所以恆為中性值。

`AllUpgradeCostFairy`、`BurstSkillStageSkipMult`、`CompanionAttackRate`、`CritBoostSkillDurationMult`、`Goldx10Chance`、`HelperBoostSkillDurationMult`、`ManaPoolCapPercent`、`ManaRegenMult`、`OnlyPrestigeRelic`、`ShadowCloneSkillDurationMult`、`SwordMasterDamage`、`SwordMasterUpgradeCost`、`TapBoostSkillDurationMult`

## 限制

- 「掃不到取值點」不等於「原生不使用」：以暫存器傳入編號的呼叫點列在 unattributed，目前有 57 個；另外加成值可能先被算進某個欄位、之後從該欄位讀，例如 RefreshCriticalValues 把暴擊倍率存進 PlayerModel 的欄位再由攻擊流程讀。
- 本表只涵蓋 GetBonus 與 HasBonus 兩個入口，不含 UI 顯示用的 GetBonusInfo 等後設方法。
- 要據此宣稱某個加成沒有作用，必須另外確認它沒有被快取到欄位、也不在 unattributed 的呼叫點裡。
- 低估有具體實例：EquipmentModel.EquipmentSetCountBonusHandler 依稀有度從表裡取 BonusType 再以暫存器傳給 GetBonus，所以 DamagePerLegendarySet 這一族會被歸成「原生也沒有取值點」，實際上就在那個方法裡被消費——見 reference/tt2/8.2.0/count-bonus-evidence.json。
