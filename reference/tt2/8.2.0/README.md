# 8.2.0 獨立參考目錄

這是資料準備成果，尚未接入遊戲或改寫存檔。現行遊戲仍為 2.6.0／7.5 數值基準。

`manifest.json` 記錄安裝包、47 張已解析表（15,956 個表內有效 ID）的 SHA-256，以及 372 個 TextAsset 的大小與雜湊。未解析的資源只列索引，不宣稱它們皆為 CSV 或已完成 schema。

每張表以來源 ID 為鍵；英雄里程碑使用 `[Ascension,Level]` 複合鍵。`sourceOrdinal` 僅作來源定位，不能用來覆蓋玩家陣列。`legacy-2.6.json` 固定目前七組核心陣列的原始 ID 順序；不存在於目標表的 ID 映射為 null，後續遷移必須保留及處理，不能改配其他內容。

數字一律保留十進位字串，不轉成浮點數、不封頂。空字串與 `-` 分別保留，不能默認為零。schema 的 decimal／boolean／token 是依此固定來源的欄位值分類，不代表已確認遊戲公式；布林值也保留來源字串。排除名稱、敘述與圖片欄位；保留效果 ID、獎勵編碼和數值事實。

每筆 `activation=unverified`、`verification=pending`。`availabilityEvidence` 保存 Enabled、IsActive、IsInGame、LimitedTime、SkillType、SetType、Type 等實際存在的證據；缺少旗標不代表啟用。`validation.json` 對每個 ID 記錄來源啟用旗標、內容分類、分類依據和未知的線上可用性。每日獎勵混有周年貨幣，不可直接當成常駐獎勵；PerkInfo 沒有足夠模式證據，仍保留未分類。伺服器覆蓋及時程未知。

重建：使用本機已忽略的原始資料執行 `python tools/import-reference-v8.py`，再執行 `node tools/reference-validation.mjs`。工具驗證安裝包、既有全資源索引、原生列舉與解析器證據雜湊。除了下列已確認的單表例外，拒絕重複鍵；不完整 CSV 列一律拒絕。CI 透過 `npm test` 驗證提交資料完整性、舊 ID 對照、換序、超大數值、跨表引用與活動證據，並執行 `python3 -m unittest discover -s tests -p '*_test.py'` 驗證實際 Python 匯入規則。未知效果 ID、壞掉的前置引用、循環技能前置、非法數字及不成對的成就階段皆有反例測試。

本次檢查 17,531 處引用；其中 12 處不在 BonusInfo，但在原生 BonusType 列舉中存在，記錄在 `nativeOnly`。`native-bonus-types.json` 僅保存列舉 ID／數字與來源雜湊，不能用來推定效果公式。沒有未解析的引用 ID，不代表所有公式或所有資源都已驗證。

裝備副屬性表已解除隔離：原生 `ParseEquipmentEnhancementScalingInfo`（RVA 0x218994c）按遞增列號讀取；五個 TryGetCell 都成功才呼叫字典 set_Item，後者使用 OverwriteExisting。故同 ID 最後成功解析的列生效。59 筆來源列整理為 58 個 ID，AllActiveSkillAmount 的 PowerExp 從第 9 列的 0.4 被第 57 列的 1.002 覆寫（列號從 0 起）。兩筆都保留在表內 rowResolution.duplicateHistory，sourceOrdinal 指向最後生效列。這項結論只適用於目前安裝包資料，不推定歷史 7.5 解析器或線上覆蓋值。

證據位於 [enhancement-parser-evidence.json](enhancement-parser-evidence.json)。`python tools/audit-enhancement-parser.py` 可用本機 Capstone／pyelftools 重核：逐位元組比對 APK 中的原生程式庫、11 處指令、方法名稱、6 個字串引用及 OverwriteExisting 列舉值。匯入器不模擬全部 .NET 字串解析；遇到不支援的數值、未知 ID 或欄位變更會停止，避免靜默遺漏。`quarantine.json` 保留已解決記錄；其他表仍不允許覆寫重複 ID。

R02 尚餘：其餘支援表 schema，以及缺少來源證據的模式／可用性分類；已完成突襲技能、卡片費用、玩家、敵人及部位表；商店禮包、突襲關卡與區域已匯入，配送與複合獎勵格式已整理；原生解析與選擇索引已核對，發獎及配送仍待驗證。完成後才進入 R03 存檔遷移。本目錄的逐 ID pending 記錄是核對清單，不是玩法完成證據。

突襲資料範圍：44 張卡、150 級費用、3,000 級玩家資料、10 種敵人、66 筆部位定義（含 None 哨兵）。目前只檢查資料完整性與 ID 引用，未實作突襲戰鬥、傷害公式或合作事件。IsActive 全為 TRUE 也不代表已確認線上可用性。驗證器檢查 BonusTypeA 至 H，不漏掉後段效果；保留負值加成，避免把減益錯誤當作壞資料。

玩家資料的 PlayerRaidProgressionBundle 已連到 ShopBundleInfo；後者的 510 個複合獎勵欄位已列在 rewardReferences，剩下 3 個配送 ID 列在 deferredReferences，不能宣稱所有引用已完成。unresolved=0 只適用於目前已涵蓋的引用範圍。None 部位及保護／相對／連動關係依原表保留，不把 66 筆資料等同於 66 個可攻擊部位。

商店與關卡：639 筆禮包、140 個 TierID／LevelID 複合鍵、7 個區域。檢查禮包解鎖鏈、裝備列表、卡片 ID:數量及敵人池／區域引用；敵人池長度不等於 TitanCount。禮包資料含歷史日期、實驗分組及條件限制，不能把安裝包中的價格或存在性當成現行販售狀態，也未接入任何付款功能。

raid-layout-index.json 僅保存 RaidEnemyLayout 圖集 JSON 的來源雜湊與 65 個 frame ID，不包含原圖或圖集座標；測試核對這些 ID 與非 None 部位一致。它不是 RaidLevelInfo 的替代資料。

獎勵解析器僅處理目前來源中觀察到的格式，使用 native-reward-types.json 確認 RewardID 身分，並核對 RaidCard／Pet／EquipmentSet 的指定 ID。一般數量與物品數量保留十進位字串；EquipmentSet:ID 的數量留空，選擇槽保留一個選取索引，未選取為 -1，避免自行假定。重複資源保持順序與個別項目，不預先合併。未知類型、未知物品、負數、非整數或不支援格式使檢查失敗。

510 個欄位格式已通過，後續已核對原生分隔符與欄位對應，interpretation=native-verified-valid-dialect、deliveryRules=unverified；這不是原生發獎邏輯完成。DailyDelivery_STARTER／MEDIUM／LARGE 的配送表尚未取得。dump.cs 的 DailyDeliveryModel.UpdateFromShopListResponse（RVA 0x2134b40）、UpdateDailyBundlesFromResponse（0x2134c84）及 DailyDeliveryBundleInfo.ParseScheduleDict 顯示相關商店回應介面；僅方法簽章尚不足以確認完整資料流程。FakeDailyDeliveryBundleJson 不作正式來源。RewardClass 建構式（0x243335c）及選擇索引已於後續核對，缺少配送資料時保留待證據。

原生解析證據：[reward-parser-evidence.json](reward-parser-evidence.json)，可執行 `python tools/audit-reward-parser.py` 重核。工具以已逐位元組比對 APK 的程式庫雜湊為基準，檢查 12 處指令、3 個字串引用及 4 個方法範圍。一般獎勵支援逗號與分號；選擇槽先按逗號切候選，再用 RewardClass 解析候選內的分號獎勵。candidates 保留群組，entries 僅為展開的索引，不能全部發放。

nativeType／nativeValue／nativeItemId 保存原生欄位對應：Equipment:Rare:3 的 nativeType 是 EquipmentRare；RaidCard:MoonBeam:20 的 nativeItemId 是 MoonBeam；EquipmentSet:Jade 的 nativeValue 是 Jade，數量仍未知。ShopModel 使用每槽一個 int，缺少選擇返回 -1，新增空槽也以 -1 初始化。selectRewardCandidate 僅用於參考資料選取，不修改存檔、資源或執行購買；越界索引會拒絕。嚴格驗證器仍拒絕未支援或損壞格式，未模仿原生所有錯誤恢復行為。

寶石與終局新增 11 張表：GemstoneLevelCost 的 5,000 列與 GemstoneLevelSummonRateInfo 的 1,000 列是不同資料範圍，未做超出表範圍的延伸。首列權重合計 99,998，百分比是來源註記，兩者都原樣保存。EndgamePetInfo／EndgameSeasonArtifactInfo／EndgameSeasonRewardInfo 的 _1 資源是獨立來源變體，同名 ID 的旗標與數值可能不同；未選用任何一組作線上規則。

PetQuestLevelInfo 的 DifficultyChancePerLevel 每格為 10 個機率，驗證長度、範圍及合計；其他三列仍按數值驗證。此表是等級進度，並非完整任務模板。EndgameSeasonRewardInfo 兩組合計 8 筆外觀獎勵加入 deferredReferences，另有既有 3 筆每日配送；缺少線上季節時程時不啟用。

完整資源路由見 [reference-coverage.md](../../../docs/reference-coverage.md)（從儲存庫 docs 目錄開啟）；由 `node tools/reference-coverage.mjs` 產生，依檔名分派工作項目，不能當成來源格式或玩法已驗證。
