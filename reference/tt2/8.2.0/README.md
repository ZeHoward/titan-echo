# 8.2.0 獨立參考目錄

這是資料準備成果，尚未接入遊戲或改寫存檔。現行遊戲仍為 2.6.0／7.5 數值基準。

`manifest.json` 記錄安裝包、27 張已解析表（5,579 筆）的 SHA-256，以及 372 個 TextAsset 的大小與雜湊。未解析的資源只列索引，不宣稱它們皆為 CSV 或已完成 schema。

每張表以來源 ID 為鍵；英雄里程碑使用 `[Ascension,Level]` 複合鍵。`sourceOrdinal` 僅作來源定位，不能用來覆蓋玩家陣列。`legacy-2.6.json` 固定目前七組核心陣列的原始 ID 順序；不存在於目標表的 ID 映射為 null，後續遷移必須保留及處理，不能改配其他內容。

數字一律保留十進位字串，不轉成浮點數、不封頂。空字串與 `-` 分別保留，不能默認為零。schema 的 decimal／boolean／token 是依此固定來源的欄位值分類，不代表已確認遊戲公式；布林值也保留來源字串。排除名稱、敘述與圖片欄位；保留效果 ID、獎勵編碼和數值事實。

每筆 `activation=unverified`、`verification=pending`。`availabilityEvidence` 保存 Enabled、IsActive、IsInGame、LimitedTime、SkillType、SetType、Type 等實際存在的證據；缺少旗標不代表啟用。`validation.json` 對每個 ID 記錄來源啟用旗標、內容分類、分類依據和未知的線上可用性。每日獎勵混有周年貨幣，不可直接當成常駐獎勵；PerkInfo 沒有足夠模式證據，仍保留未分類。伺服器覆蓋及時程未知。

重建：使用本機已忽略的原始資料執行 `python tools/import-reference-v8.py`，再執行 `node tools/reference-validation.mjs`。工具驗證安裝包、既有全資源索引及原生列舉來源雜湊，拒絕重複鍵和不完整 CSV 列。CI 透過 `npm test` 驗證提交資料完整性、舊 ID 對照、換序、超大數值、跨表引用與活動證據。未知效果 ID、壞掉的前置引用、循環技能前置、非法數字及不成對的成就階段皆有反例測試。

本次檢查 8,326 處引用；其中 9 處不在 BonusInfo，但在原生 BonusType 列舉中存在，記錄在 `nativeOnly`。`native-bonus-types.json` 僅保存列舉 ID／數字與來源雜湊，不能用來推定效果公式。沒有未解析的引用 ID，不代表所有公式或所有資源都已驗證。

`quarantine.json` 隔離裝備副屬性表的重複鍵：AllActiveSkillAmount 的 PowerExp 同時有 0.4、1.002。尚未確認原生解析器採用方式，整張表不進可用目錄，不自行選第一筆或最後一筆。原生解析方法為 `ParseEquipmentEnhancementScalingInfo`，RVA 0x218994C，待核對其實際行為。

R02 尚餘：上述重複鍵處理、其餘支援表 schema，以及缺少來源證據的模式／可用性分類；完成後才進入 R03 存檔遷移。本目錄的逐 ID pending 記錄是核對清單，不是玩法完成證據。
