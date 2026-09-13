# Titan Echo · 泰坦遠征

以 Tap Titans 2 為目標的繁體中文網頁重製。現行遊戲為 2.6.0，已完成部分基礎規則；尚非完整的一比一復刻。已對 8.2.0 安裝包做資源提取與部分 ARM64 原生方法分析，未取得官方伺服器原始碼或線上覆蓋設定。

## 復刻進度與下一步

**[完整復刻代辦清單](ROADMAP.md)** 是後續工作的主清單，共 9 階段、60 個主項目，含狀態、驗收條件與執行順序。

固定目標為 TT2 8.2.0；現有 7.5 資料會經穩定 ID 映射與存檔遷移後逐步替換。資料已取得不等於玩法已完成。下一項為 R02：8.2 資料匯入與完整 ID 目錄。

來源見 [基準索引](docs/reference-baseline.json)；行為與限制見 [規則核對](public/rules.html)；研究歷程見 [技術核對紀錄](TT2-RULES.md)。舊版 CONTENT-COVERAGE.md 是歷史資料，不代表目前實作。

## GitHub Pages

**[直接開始遊戲](https://zehoward.github.io/titan-echo/)** · [GitHub 原始碼](https://github.com/ZeHoward/titan-echo)

GitHub Pages 是公開靜態版：不需登入，遊戲每 3 秒自動儲存在此瀏覽器的 IndexedDB。重新整理與關閉後重開會恢復進度，並結算離線收益。右上角可以修改本機冒險者名稱，設定可匯出 JSON 紀錄。

Pages 不會執行後端程式；透過 Google Apps Script / Sheets 可選擇保存及跨裝置復原各玩家獨立存檔，並非公會即時多人戰鬥。「本機紀錄」只顯示這個瀏覽器的進度。清除網站資料會刪除本機存檔。多人版本仍可使用下面的 SQLite 自架服務，程式及測試皆保留。

推送至 `main` 後，`.github/workflows/pages.yml` 會執行測試、檢查型別、建置並部署 GitHub Pages。網站子目錄由 Pages 設定自動取得，圖片、樣式及 JavaScript 都支援專案路徑。

手動產生 Pages 版時，設定 `VITE_PAGES_MODE=true`、`PAGES_BASE_PATH=/titan-echo/`，再執行 `npm run build:static`。未設定這兩個值時維持自架版的伺服器存檔行為。

## 直接遊玩（Windows 可攜版）

1. 解壓縮 `Titan-Echo-Web.zip`。
2. 雙擊 `START-GAME.cmd`，保持視窗開啟。
3. 用瀏覽器開啟 <http://localhost:4173>。
4. 點右上角帳號，輸入帳號與密碼，再按「建立帳號」。每位玩家建立不同帳號。

可攜版附 Node.js 24 執行環境，不需要安裝 npm 或申請 Google API。

同網路的其他電腦／手機開啟 `http://遊戲主機的區網IP:4173`，即可同時建立帳號、各自推關並共用排行榜。主機必須持續運作；Windows 防火牆需允許此連線。這是多人獨立進度，不是同一隻頭目的即時合作模式。

## 資料存在哪裡

自架版用 `data/game.sqlite`，單一 SQLite 資料檔取代外部資料庫服務。採用 WAL 與原子版本更新處理多人存檔。停止遊戲主機後，備份整個 `data` 目錄即可保留帳號、密碼雜湊、登入工作階段及所有玩家進度。請勿把這個目錄上傳到公開靜態空間。

正式網際網路架設請以 HTTPS 反向代理提供服務，設定 `COOKIE_SECURE=1`。可透過 `PORT`（預設 4173）、`HOST`（預設 0.0.0.0）及 `DATA_DIR` 調整監聽與資料目錄。這個自架版提供基本 scrypt 密碼保護、HttpOnly 工作階段與登入節流，沒有密碼找回或大型營運管理後台。

## 靜態網頁與雲端版

- `dist-static/` 是可直接上傳的靜態 HTML、CSS、JavaScript 和圖片。
- Pages 建置可以使用瀏覽器本機存檔；持久化多人帳號仍需要共用服務，不能僅靠每位玩家各自的瀏覽器檔案完成。
- 可攜版的 Node 服務負責提供靜態檔案與 `/api/*`，不必修改網頁。
- Sites 線上版使用 ChatGPT 登入與 Cloudflare D1，程式位於 `app/api/`。目前 Sites 發佈遵循擁有者私有權限；其他人須先獲得網站存取權限。自架版則可直接建立多個帳號。
- Sites 和自架版是不同存檔空間，不會互相同步。

## 目前可玩的部分

- 手動點擊、普通泰坦與頭目、超時農場及重試。
- 劍術大師基礎傷害、里程碑與升級費用；37 位英雄及部分等級被動、戰術洞察。
- 六個基礎法術、神器發現與升級、技能樹的部分效果。
- 寵物蓄力攻擊、出戰與蛋；裝備穿戴、製作與部分套裝效果。
- 登入獎勵、魔力藥水、黃金雨的部分功能。
- 本機存檔、可選 Google Sheets 雲端保存、備份與版本資訊。

傷害組合、英雄曲線、金幣、蛻變、取得機率與完整流派仍有缺口。現行 1800 關與 2000 級限制也列入待辦。公會、突襲與線上錦標賽尚未實作。

Pages 多分頁保存衝突會暫停並提示處理，不以較舊存檔直接覆蓋戰鬥畫面。詳細雲端設置見 [Google Sheets 說明](GOOGLE-SHEETS.md)。

## 開發

需要 Node.js 24+。

```sh
npm install
npm run dev
npm test
npx tsc --noEmit
npm run build:static
npm run start:standalone
npm run build
npm run db:generate
```

主要檔案：`lib/engine.ts` 共用戰鬥規則；`app/game.tsx` 遊戲介面；`server/standalone.mjs` 自架多人服務；`db/schema.ts` 雲端資料結構。原始圖片與提示詞說明見 `ASSETS.md`。

已驗證：2.6.0 的 78 項遊戲與保存測試、TypeScript 檢查及 Pages 正式建置。這些測試不代表已完成與原版同版本實測或多人共享玩法壓力測試。

## 參考與範圍

- 使用者提供的 [二代攻略](https://m.gamer.com.tw/forum/C.php?bsn=27714&snA=6761)。
- 固定的 [7.5 CSV 快照](https://github.com/rawrzcookie/TT2_CSV/tree/a959d19790af28d994d96bd8a315ca7185c04dfe/csv)。
- 本機分析的 8.2.0 安裝包與來源雜湊記錄於 [基準索引](docs/reference-baseline.json)。

目前圖像為本專案美術，沒有將原始 APK、美術資源包、完整反組譯輸出或玩家資料發布至 GitHub。對原版的未知部分會保留在代辦清單，不以自訂機制冒充已還原。
