// Application releases are independent from the save format and TT2 reference version.
export const APP_VERSION='2.1.0';
export const RELEASES=[
 {version:APP_VERSION,date:'2026-09-13',title:'版本資訊與更新紀錄',changes:['頁面左下角、頁尾與設定顯示遊戲版本，點擊可查看更新紀錄。','整理規則校正、繁體中文、保存修正與增益道具的更新內容。']},
 {version:null,date:'2026-09-13',title:'增益道具開放',changes:['魔力藥水可補滿魔力並提高回復速度。','黃金雨可用現有金幣自動招募、升級英雄。','增益每層獨立計時十二小時，蛻變後保留；可使用鑽石或登入兌換次數。']},
 {version:null,date:'2026-09-10',title:'保存穩定性與繁體中文',changes:['網頁版直接保存目前進度，避免保存時重新演算造成戰鬥回溯。','多分頁存檔衝突改為暫停提示，不自動覆蓋畫面。','英雄、寵物、技能樹、套裝、效果說明及介面文字改為繁體中文。']},
 {version:null,date:'2026-09-10',title:'二代規則校正與收藏系統',changes:['依固定的二代資料校正神器、基礎技能與技能樹效果。','加入裝備穿戴、製作、套裝收藏，以及寵物出戰、被動效果和寵物蛋。','加入十四天登入獎勵，保留修正前本機存檔備份與既有雲端連線。']},
] as const;
