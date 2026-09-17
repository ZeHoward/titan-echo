// Which gameplay parameters live in server variables, and which of them the package actually carries.
// This is a planning inventory: a field name is not a formula, and a bundled value is not a live value.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const reference = new URL('reference/tt2/8.2.0/', root);
const read = name => JSON.parse(readFileSync(new URL(name, reference), 'utf8'));

const fields = read('native-server-var-fields.json').fields;
const bundled = new Map();
for (const table of ['ServerVarsInfo', 'ServerVarOverride']) {
  for (const row of read(`${table}.json`).records) bundled.set(row.id, { table, values: row.values });
}
// The second line of evidence: what ServerVarsModel's class constructor assigns before any server
// payload arrives. A default is not a live value, and the bundled tables override some of them.
const defaults = read('servervar-defaults.json').recovered;

// Topic routing follows the roadmap items these parameters gate.
const topics = [
  [/crit/i, 'C01 暴擊'],
  [/^(playerDamage|swordMaster|tapDamage|playerUpgrade|playerCost)/i, 'C02 劍術大師'],
  [/^(helper|ascend)/i, 'C03-C04 英雄'],
  [/^(monster|titan|stage|boss|gold)/i, 'C05 泰坦與金幣'],
  [/^(splash|skip|overflow)/i, 'C06 濺射與跳關'],
  [/mana/i, 'C07 魔力'],
  [/^(offline|idle|frame|tick)/i, 'C08 時間與離線'],
  [/^(skill|multiCast|spell)/i, 'B01-B02 法術'],
  [/^(clone|dagger|goldGun|ship|clan|pet|shadow|heavenly|twilight)/i, 'B03-B09 流派'],
  [/^(relic|prestige|artifact)/i, 'E01-E05 蛻變與神器'],
  [/^(equipment|set|craft|shard)/i, 'I01-I03 裝備'],
  [/^(raid|tournament|challenge)/i, 'M04-M08 突襲與賽事'],
];

const rows = fields.map(field => {
  const carried = bundled.get(field);
  const compiled = Object.hasOwn(defaults, field);
  return { field, topic: topics.find(([pattern]) => pattern.test(field))?.[1] ?? '未分類',
    bundled: Boolean(carried), source: carried?.table ?? null,
    compiledDefault: compiled, defaultValue: compiled ? defaults[field].value : null };
});
const byTopic = {};
for (const row of rows) {
  const entry = (byTopic[row.topic] ??= { topic: row.topic, fields: 0, bundled: 0, bundledFields: [],
    compiledDefaults: 0, neither: 0 });
  entry.fields += 1;
  if (row.bundled) { entry.bundled += 1; entry.bundledFields.push(row.field); }
  if (row.compiledDefault) entry.compiledDefaults += 1;
  if (!row.bundled && !row.compiledDefault) entry.neither += 1;
}
const ordered = Object.values(byTopic).sort((a, b) => b.fields - a.fields);
const report = { version: '8.2.0', nativeFields: fields.length, bundledKeys: bundled.size,
  compiledDefaults: rows.filter(r => r.compiledDefault).length,
  neither: rows.filter(r => !r.bundled && !r.compiledDefault).length,
  basis: 'native [ServerVar] field names routed by name; a name is not a formula',
  caveat: 'Neither a bundled value nor a compiled-in default is the value the live server sends',
  topics: ordered, fields: rows };
writeFileSync(new URL('docs/server-var-gaps.json', root), JSON.stringify(report, null, 2) + '\n');

const withDefault = rows.filter(r => r.compiledDefault).length;
const neither = rows.filter(r => !r.bundled && !r.compiledDefault).length;
let text = '# 伺服器變數缺口盤點\n\n';
text += `原生共有 ${fields.length} 個 \`[ServerVar]\` 欄位，有**兩條各自獨立的線索**：\n\n`;
text += `1. **安裝包的兩張變數表**帶了 ${bundled.size} 個鍵，其中 ${rows.filter(r => r.bundled).length} 個對得上原生欄位。\n`;
text += `2. **程式裡的編譯期預設值**：\`ServerVarsModel\` 的類別建構式在任何伺服器回應之前先賦值，`;
text += `其中 ${withDefault} 個欄位解得出來（見 reference/tt2/8.2.0/servervar-defaults.json）。\n\n`;
text += `兩者都沒有的欄位有 ${neither} 個——那才是真正無法從包內核實的部分。`;
text += '**要注意：預設值不是線上值**，伺服器可以整份覆蓋，例如 `maxStage` 的預設值是 1,000,000、被變數表覆寫成 98,000。\n\n';
text += '依 ROADMAP 項目分組（僅依欄位名稱路由，名稱不等於公式）：\n\n';
text += '| 項目 | 原生欄位數 | 變數表有值 | 程式有預設值 | 兩者皆無 | 變數表帶的欄位 |\n|---|---|---|---|---|---|\n';
for (const entry of ordered) {
  text += `| ${entry.topic} | ${entry.fields} | ${entry.bundled} | ${entry.compiledDefaults} | ${entry.neither} | ${entry.bundledFields.join('、') || '（無）'} |\n`;
}
text += '\n由 `node tools/server-var-gaps.mjs` 產生；逐欄位狀態（含每個欄位的預設值）見 server-var-gaps.json。\n';
writeFileSync(new URL('docs/server-var-gaps.md', root), text);
console.log(`Server var gaps: ${fields.length} native fields, ${rows.filter(r => r.bundled).length} carried in the package, `
  + `${withDefault} with a compiled-in default, ${neither} with neither`);
