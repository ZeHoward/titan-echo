# Titan Echo 工作約定

- 開始延續復刻工作時，先讀 `ROADMAP.md` 的「目前位置」與下一個工作項目，並參考 `TT2-RULES.md`。使用者當次明確指示優先。
- 按清單順序完成一個可驗證的工作項目後，再開始下一個；不要任意新增自訂遊戲機制。遇到缺少證據，記錄缺口，繼續可獨立完成的子步驟。
- 每個項目區分資料、公式、實際事件、介面、存檔與驗證。僅有資料表、名稱、倍率預覽或自己的單元測試，不能宣稱原版系統已完整還原。
- 固定目標為 TT2 8.2.0 內附資料及可核實的客戶端邏輯。7.5 是現行歷史資料基準，遷移時按穩定 ID 對照，禁止用不同版本的陣列位置直接覆蓋玩家資料。官方伺服器覆蓋值未知時明確記錄。
- 核心模組新增公式時，要同時在 `tools/build-formula-sources.py` 登記來源（資料表、原生方法、原生預設值，或明確標記為 7.5 沿用、專案自訂、伺服器供給）；`tests/formula-sources.test.mjs` 會擋下未登記的匯出。逐項對照見 [docs/formula-sources.md](docs/formula-sources.md)。**登記只是第一步**：接著要跑 `python tools/build-formula-sources.py` 與 `node tools/formula-sources.mjs` 重新產生登記表與可讀版，再更新 `tests/formula-sources.test.mjs` 裡寫死的三組數字（公式數、來源條目數、各狀態計數）與可讀版開頭那句「共 N 條公式、M 項來源條目」。數字寫死是刻意的——來源狀態變動必須是有人明確改過，不能悄悄漂移。
- **改動「引擎怎麼查加成」的程式碼後要跑 `node tools/bonus-coverage.mjs`**。它把 796 個加成做三方對照（本專案有沒有來源會給、引擎有沒有讀、原生有沒有取值點），產出 [docs/bonus-coverage.md](docs/bonus-coverage.md) 與 `docs/bonus-coverage.json`；`tests/bonus-coverage.test.mjs` 擋下計數漂移，數字寫死同樣是刻意的。判斷「引擎有沒有讀」靠原始碼掃描，所以**遇到沒見過的查詢參數形式會直接中止**——寫出 `stateEffect(s, 某個變數)` 這種形式時，要同時在該工具的 `KNOWN_ARGUMENTS` 登記它怎麼展開，否則那些加成會被誤判成沒人讀。原生那一欄來自 `python tools/audit-bonus-readers.py`，只有換安裝包才需要重跑。
- **有基礎值的加成要先看它是加法型還是乘法型，再決定要不要把基礎值加上去。**`BonusModel.SetDefaultBonuses` 給十四個加成設了編譯期基礎值（`reference/tt2/8.2.0/bonus-defaults-evidence.json`），但**不是每個都要寫進 `BONUS_DEFAULTS`**：加法型的中性值是 0，基礎值一定要加（例如 `ChestChance` 的 0.01）；乘法型的中性值本來就是 1，基礎值如果剛好也是 1.0 就**不能再加一次**，否則等於把效果加倍（`MultiMonstersGold` 就是這個情況，2.16.0 差點寫錯）。判斷依據是 `TT2_BONUSES` 的 `additive` 欄位，它與原生一致。目前已接七個，其餘的列在 `tests/bonus-defaults.test.mjs` 的「尚未接進引擎的基礎值」那則測試裡。
- **查一個不在 `bonusDefinitions` 裡的加成會拿到乘法中性值 1**，不是 0。用在乘法沒事，用在加總秒數或魔力就會憑空多一點——天堂聖擊的持續時間就是這樣變成 3＋1＝4 秒的（原生根本沒有 `BurstDamageSkillDuration`，它是瞬發技能）。凡是把加成「加上去」的地方都要先確認該加成存在，見 `lib/engine.ts` 的 `skillBonus`。
- **工作區的檔案是 CRLF**（repo 沒有 `.gitattributes`）。用腳本改檔時要先偵測或正規化換行，否則跨行的字串比對會失配，或寫出混合換行的檔案；`git checkout --` 還原之後也會是 CRLF。Python 的 `write_text` 在 Windows 會把整檔轉成 CRLF，不要用它改 repo 檔案。
- **接一個加成上去的完整收尾**（2.14.4–2.15.4 走了九次，漏一步就有測試轉紅）：① 改引擎，熱路徑用 `stateResolver(s)`／`effectResolver(t)` 取一次共用，不要逐次 `stateEffect`；② 寫 `tools/audit-*.py` 產出 `reference/tt2/8.2.0/*-evidence.json`；③ 寫讀那份 JSON 的測試；④ 做變異驗證；⑤ 跑上面兩條說的那三支產表工具並同步它們寫死的數字（`bonus-coverage` 的 `counts` 與 `priority.length` 也一樣要改）；⑥ 升版號與 `lib/releases.ts`；⑦ 更新 ROADMAP；⑧ commit-push → 等部署 → 線上加 `?v=` 實測。**既有的守衛測試會轉紅是刻意的**：專案用 `PENDING_HERO_EFFECTS` 這類清單與「未實作的效果不得生效」的測試把未完成的加成擋在外面，實作之後跟著更新即可。
- **`stateResolver`／`effectResolver` 回傳的是取得當下的快照**（2.14.7 為效能引入，一次計算只做一次快取戳記檢查）。熱路徑在一次計算內不改狀態所以安全，但**不要把 resolver 存起來跨計算重用**，狀態變了它不會跟著變；`tests/bonus-resolver.test.mjs` 釘住這件事。零星呼叫仍用 `stateEffect`／`effect`，它們內部就是取一次 resolver。
- 不把 APK、原始資源、完整反組譯輸出、玩家存檔或憑證提交到 Git；它們留在既有忽略目錄。提交自己實作的程式、必要數值事實、來源索引與測試。
- 玩家進度與雲端相容性是每項驗收條件。現行 Sheets 外層格式為 version 2、heroes[33]、artifacts[30]；如需變更，必須先實作並測試相容遷移，不能直接換欄位。
- 完成實作後更新 `ROADMAP.md` 的狀態、完成證據及下一項，並更新應用版本與更新紀錄；純規劃或文件更新不虛增遊戲版本。
- 使用者已要求發布到 GitHub Pages。完成已驗證的遊戲更新後依現有流程發布，確認部署結果。不要因存在 `.openai/hosting.json` 就把此 GitHub Pages 工作改成 Sites 發布。
- `app/globals.css` 的規則**不照選擇器分組**：同一個 class 的基礎宣告常散在檔案很後面（例如 `.pet-combat-status` 的 `position:absolute` 在近三萬字元處）。加 media query 覆寫時如果插在基礎宣告之前，同特異度下會被整條蓋掉而完全沒有效果，**一律加在檔案末尾**；改完要在實際寬度量一次 `getBoundingClientRect()`，不要只看程式碼。

