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
              entry(part='基礎值 18 與每關成長率 1.32', status='server', ref='monster-curve-evidence.json',
                    note='原生沒有「基礎值 × 成長率^關卡」這種寫法：MonsterModel.GetMonsterBaseHP 把關卡先加上 '
                         'ActiveHonourAmount × honourStageOffset（安裝包值 250），再呼叫共用的 GetMonsterBase，'
                         '參數是 monsterHPLevelOff、monsterTransendenceHPLevelOff、monsterHPMult、'
                         'monsterHPBase1–3 與 monsterHPExpo1–4 共十個具名 [ServerVar]，**安裝包一個值都沒帶**。'
                         '目前的 18 與 1.32 是 7.5 基準的近似，不是原版係數。另外 MonsterHPScaling 的 A／B 變體'
                         '彼此不同（B 在關卡 1–3 為 0.3／0.4／0.475），屬 A／B 指派結果。'),
              entry(part='MonsterHP 減免上限 0.9', status='invented',
                    note='引擎自訂的安全上限，避免血量歸零；安裝包未見對應上限。')]),
    entry(id='monsterGold', module='lib/engine.ts', export='goldReward',
          expression='5 × 1.27^(關卡-1) × 各項金幣加成',
          parts=[
              entry(part='基礎值 5 與成長率 1.27', status='server', ref='monster-curve-evidence.json',
                    note='原生 MonsterModel.GetMonsterBaseGold 走的是與血量同一條 GetMonsterBase，參數為 '
                         'monsterGoldLevelOff、monsterTransendenceGoldLevelOff、monsterGoldMult、'
                         'monsterGoldBase1–3 與 monsterGoldExpo1–4 共十個具名 [ServerVar]，安裝包同樣未帶值。'
                         '目前的 5 與 1.27 是 7.5 基準的近似。'),
              entry(part='加成代號（GoldAll、JackpotGold、ChestAmount…）', status='table', ref='native-bonus-types.json',
                    note='代號對照原生 BonusType 列舉，數值來自神器與天賦資料表。'),
              entry(part='寶箱泰坦基礎機率 0.02', status='server',
                    note='原生對應欄位是 [ServerVar]，安裝包未帶值。')]),
    entry(id='monsterCount', module='lib/engine.ts', export='monsterCount',
          expression='每關固定 10 隻小怪',
          parts=[entry(part='固定值 10', status='server', ref='monster-curve-evidence.json',
                       note='原生以 monsterCountBase、monsterCountInc、monsterCountStageDelta 三個 [ServerVar] '
                            '決定隻數且隨關卡變動，安裝包未帶值；本專案先以固定 10 代替。')]),
    entry(id='bossHealthMod', module='lib/engine.ts', export='health',
          expression='頭目血量在小怪基礎上再乘一組倍率',
          parts=[entry(part='bossHPModBase 與 bossHPModStageMult', status='server',
                       ref='monster-curve-evidence.json',
                       note='原生除了 ThemeMultiplierSequence 另有這兩個 [ServerVar] 參與頭目血量，'
                            '安裝包未帶值，本專案未實作。')]),
    entry(id='heroDamage', module='lib/engine.ts', export='heroDps',
          expression='基礎傷害 × 等級 × 1.035^(等級-1) × 里程碑倍率 × 武器與流派加成',
          parts=[
              entry(part='英雄基礎傷害', status='table', ref='HelperInfo.json', note='DefaultDamageAmount 欄。'),
              entry(part='里程碑倍率', status='table', ref='HelperImprovementsInfo.json',
                    note='依等級取最後一列的累計倍率，資料表最高 6000 級。'),
              entry(part='每級成長率 1.035', status='baseline-75', note='沿用 7.5 基準，安裝包未見對應欄位。')]),
    entry(id='heroCost', module='lib/engine.ts', export='cost',
          expression='基礎費用 × (1.075^(等級+購買數) − 1.075^等級) ÷ 0.075 × 費用減免',
          parts=[
              entry(part='英雄基礎費用', status='table', ref='HelperInfo.json',
                    note='PurchaseCost1 欄，最高一筆為 1.0000E+240。'),
              entry(part='成長率 1.075', status='baseline-75',
                    note='沿用 7.5 基準；劍術大師側的同名成長率另有原生預設值可對照。')]),
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
          expression='0.02 + CritChance 加成，上限 1；暴擊倍率為 10 × CritDamage',
          parts=[entry(part='基礎機率 0.02 與倍率 10', status='server',
                       note='原生的暴擊參數是 [ServerVar] 欄位，安裝包沒有帶值；只有 helperCanCrit=false 有原生'
                            '預設值。目前數值沿用 7.5 基準，屬待證據。')]),
    entry(id='mana', module='lib/engine.ts', export='manaMax',
          expression='魔力上限 200 + ManaPoolCap；每秒回復 (2 + ManaRegen) ÷ 60 × ManaRegenMult × 藥水倍率',
          parts=[entry(part='基礎上限 200 與基礎回復 2', status='server',
                       note='對應原生欄位是 [ServerVar]，安裝包未帶值；沿用 7.5 基準。')]),
    entry(id='bossTimer', module='lib/engine.ts', export='bossDuration',
          expression='30 秒 + BossTimerDuration',
          parts=[entry(part='基礎 30 秒', status='server', note='原生為 [ServerVar]，安裝包未帶值。')]),
    entry(id='prestigeRelics', module='lib/engine.ts', export='relicGain',
          expression='max(1, floor(關卡^1.7 ÷ 100 × PrestigeRelic))，最高關卡到 60 後開放',
          parts=[
              entry(part='指數 1.7 與除數 100', status='baseline-75',
                    note='沿用 7.5 基準；安裝包的 relicsStageMax 為 180000，與本式無直接對應。'),
              entry(part='開放門檻第 60 關', status='baseline-75',
                    note='沿用 7.5 基準；安裝包未見對應的蛻變開放關卡欄位。'),
              entry(part='至少一顆聖物的下限', status='invented',
                    note='引擎自訂：開放後即使在第一關蛻變也給一顆，安裝包未見對應下限。')]),
    entry(id='evolveCost', module='lib/engine.ts', export='evolveCost',
          expression='英雄基礎費用 × 1e4^已昇階次數 × 1e6',
          parts=[entry(part='1e4 與 1e6 係數', status='invented',
                       note='昇階費用尚未由安裝包還原；HelperInfo 的 AscendCostExpo1–6 欄位尚未接入。')]),
    entry(id='skillPoints', module='lib/engine.ts', export='apply',
          expression='可用技能點 = floor(最高關卡 ÷ 50) − 1，只在最高關卡推進時增加',
          parts=[entry(part='每 50 關一點與起算偏移', status='baseline-75',
                       note='沿用 7.5 基準；安裝包未見對應的技能點發放欄位。')]),
    entry(id='petCombat', module='lib/tt2-pet-combat.ts', export='petDamageFactor',
          expression='寵物傷害係數依等級分段，出戰與未出戰分開計算',
          parts=[
              entry(part='分段係數', status='baseline-75', ref='PetInfo.json',
                    note='以 7.5 的 PetInfo 為準，8.2 對應欄位尚未逐格核對。'),
              entry(part='每 20 次有效點擊發動一次', status='baseline-75',
                    note='沿用 7.5 基準；PetTapCountToAttack 加成可減少次數，但基準 20 未對 8.2 核實。')]),
    entry(id='eggs', module='lib/tt2-collection.ts', export='advanceEggs',
          expression='每 4 小時補一顆寵物蛋，上限兩顆',
          parts=[entry(part='間隔與上限', status='baseline-75',
                       note='沿用 7.5 基準；安裝包未見對應的寵物蛋補充間隔欄位。')]),
    entry(id='perks', module='lib/tt2-perks.ts', export='perkValue',
          expression='增益每層 12 小時獨立計時；魔力藥水提高回復倍率，黃金雨依層數縮短自動購買間隔',
          parts=[entry(part='層數倍率與間隔', status='baseline-75',
                       note='取自 7.5 的 PerkInfo；原版的隨機配發與立即金幣尚未還原。')]),
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
        'awardPet', 'heroPowerBoost', 'heroSkillValue', 'equipmentEffect', 'equipmentValue', 'petBonus',
        'artifactCost', 'skillCost', 'skillDuration', 'skillCooldown', 'skillMana', 'critMultiplier',
        'monsterCount', 'discoveryCost', 'craftPrice', 'buildMultiplier', 'manaRegen', 'achievementTier',
        'advanceEggs', 'playerUpgradeCost', 'playerBaseDamage', 'themeIndex', 'goldReward', 'health', 'heroDps',
        'cost', 'critChance', 'manaMax', 'bossDuration', 'relicGain', 'evolveCost', 'buildDamage', 'skillPower',
        'petDamageFactor', 'artifactValue', 'upgradeArtifactCost', 'heroPassiveTotals', 'perkValue',
        'dailyTaskProgress', 'normalise'],
    'catalog': [
        'HEROES', 'SKILLS', 'SKILL_DATA', 'SKILL_ORDER', 'TT2_RULESET', 'bonusDefinitions',
        'EFFECT_LABELS', 'effectLabel', 'BUILD_COEFFICIENTS', 'PLAYER_DEFAULTS', 'RESOURCE_PERKS',
        'EGG_INTERVAL', 'PENDING_HERO_EFFECTS', 'heroSkills', 'THEME_STAGES', 'TT2_THEMES',
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
