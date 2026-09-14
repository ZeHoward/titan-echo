# 8.2.0 獨立參考目錄

這是資料準備成果，尚未接入遊戲或改寫存檔。現行遊戲仍為 2.6.0／7.5 數值基準。

`manifest.json` 記錄安裝包、28 張已解析表（5,637 個有效 ID）的 SHA-256，以及 372 個 TextAsset 的大小與雜湊。未解析的資源只列索引，不宣稱它們皆為 CSV 或已完成 schema。

每張表以來源 ID 為鍵；英雄里程碑使用 `[Ascension,Level]` 複合鍵。`sourceOrdinal` 僅作來源定位，不能用來覆蓋玩家陣列。`legacy-2.6.json` 固定目前七組核心陣列的原始 ID 順序；不存在於目標表的 ID 映射為 null，後續遷移必須保留及處理，不能改配其他內容。

數字一律保留十進位字串，不轉成浮點數、不封頂。空字串與 `-` 分別保留，不能默認為零。schema 的 decimal／boolean／token 是依此固定來源的欄位值分類，不代表已確認遊戲公式；布林值也保留來源字串。排除名稱、敘述與圖片欄位；保留效果 ID、獎勵編碼和數值事實。

每筆 `activation=unverified`、`verification=pending`。`availabilityEvidence` 保存 Enabled、IsActive、IsInGame、LimitedTime、SkillType、SetType、Type 等實際存在的證據；缺少旗標不代表啟用。`validation.json` 對每個 ID 記錄來源啟用旗標、內容分類、分類依據和未知的線上可用性。每日獎勵混有周年貨幣，不可直接當成常駐獎勵；PerkInfo 沒有足夠模式證據，仍保留未分類。伺服器覆蓋及時程未知。

重建：使用本機已忽略的原始資料執行 `python tools/import-reference-v8.py`，再執行 `node tools/reference-validation.mjs`。工具驗證安裝包、既有全資源索引、原生列舉與解析器證據雜湊。除了下列已確認的單表例外，拒絕重複鍵；不完整 CSV 列一律拒絕。CI 透過 `npm test` 驗證提交資料完整性、舊 ID 對照、換序、超大數值、跨表引用與活動證據，並執行 `python3 -m unittest discover -s tests -p '*_test.py'` 驗證實際 Python 匯入規則。未知效果 ID、壞掉的前置引用、循環技能前置、非法數字及不成對的成就階段皆有反例測試。

本次檢查 8,384 處引用；其中 9 處不在 BonusInfo，但在原生 BonusType 列舉中存在，記錄在 `nativeOnly`。`native-bonus-types.json` 僅保存列舉 ID／數字與來源雜湊，不能用來推定效果公式。沒有未解析的引用 ID，不代表所有公式或所有資源都已驗證。

裝備副屬性表已解除隔離：原生 `ParseEquipmentEnhancementScalingInfo`（RVA 0x218994c）按遞增列號讀取；五個 TryGetCell 都成功才呼叫字典 set_Item，後者使用 OverwriteExisting。故同 ID 最後成功解析的列生效。59 筆來源列整理為 58 個 ID，AllActiveSkillAmount 的 PowerExp 從第 9 列的 0.4 被第 57 列的 1.002 覆寫（列號從 0 起）。兩筆都保留在表內 rowResolution.duplicateHistory，sourceOrdinal 指向最後生效列。這項結論只適用於目前安裝包資料，不推定歷史 7.5 解析器或線上覆蓋值。

證據位於 [enhancement-parser-evidence.json](enhancement-parser-evidence.json)。`python tools/audit-enhancement-parser.py` 可用本機 Capstone／pyelftools 重核：逐位元組比對 APK 中的原生程式庫、11 處指令、方法名稱、6 個字串引用及 OverwriteExisting 列舉值。匯入器不模擬全部 .NET 字串解析；遇到不支援的數值、未知 ID 或欄位變更會停止，避免靜默遺漏。`quarantine.json` 保留已解決記錄；其他表仍不允許覆寫重複 ID。

R02 尚餘：其餘支援表 schema，以及缺少來源證據的模式／可用性分類；下一批為突襲技能、卡片費用、玩家、敵人及部位表。完成後才進入 R03 存檔遷移。本目錄的逐 ID pending 記錄是核對清單，不是玩法完成證據。
