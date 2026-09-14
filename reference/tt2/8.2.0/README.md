# 8.2.0 獨立參考目錄

這是資料準備成果，尚未接入遊戲或改寫存檔。現行遊戲仍為 2.6.0／7.5 數值基準。

`manifest.json` 記錄安裝包、18 張已解析表的 SHA-256，以及 372 個 TextAsset 的大小與雜湊。未解析的資源只列索引，不宣稱它們皆為 CSV 或已完成 schema。

每張表以來源 ID 為鍵；英雄里程碑使用 `[Ascension,Level]` 複合鍵。`sourceOrdinal` 僅作來源定位，不能用來覆蓋玩家陣列。`legacy-2.6.json` 固定目前七組核心陣列的原始 ID 順序；不存在於目標表的 ID 映射為 null，後續遷移必須保留及處理，不能改配其他內容。

數字一律保留十進位字串，不轉成浮點數、不封頂。空字串與 `-` 分別保留，不能默認為零。schema 的 decimal／boolean／token 是依此固定來源的欄位值分類，不代表已確認遊戲公式；布林值也保留來源字串。排除名稱、敘述與圖片欄位；保留效果 ID、獎勵編碼和數值事實。

每筆 `activation=unverified`、`verification=pending`。`availabilityEvidence` 保存 Enabled、IsInGame、LimitedTime、SkillType、SetType 等實際存在的證據；缺少旗標不代表啟用。每日獎勵中的周年貨幣、模式專用增益尚待分類，不能直接變成常駐獎勵。伺服器覆蓋及時程仍未知。

重建：使用本機已忽略的原始資料執行 `python tools/import-reference-v8.py`。工具驗證安裝包及已盤點表雜湊，拒絕重複鍵和不完整 CSV 列。其餘表的本次雜湊記錄於 manifest；後續更新需審查來源及生成差異。CI 透過 `npm test` 驗證提交資料完整性、舊 ID 對照、換序、超大數值與活動證據。

R02 尚餘：支援系統表 schema、欄位語義約束與跨表引用驗證、模式／活動／停用分類；完成後才進入 R03 存檔遷移。本目錄的逐 ID pending 記錄是核對清單，不是玩法完成證據。
