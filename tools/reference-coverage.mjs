// Planning inventory: filename routing is not proof of gameplay semantics or file format.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const reference = new URL('reference/tt2/8.2.0/', root);
const read = name => JSON.parse(readFileSync(new URL(name, reference), 'utf8'));
const manifest = read('manifest.json');
const imported = new Set(manifest.tables.map(t => t.table));
const localized = new Set(read('localization-index.json').files.map(f => f.name));
const shopSamples = new Set(read('shop-payload-samples.json').samples.map(s => s.name));
const quarantined = new Set(read('quarantine.json').tables.map(t => t.table));
const assets = new URL('work/apk-analysis/text-assets/', root);
const assetFiles = new Map(readdirSync(assets).map(file =>
  [file.replace(/^\d+_/, '').replace(/\.txt$/, ''), file]));
// Classify by what the file actually is, so the remaining "not imported" count is real work.
function inspect(name) {
  const file = assetFiles.get(name);
  if (!file) return { status: 'not-imported', kind: 'source-missing' };
  const bytes = readFileSync(new URL(file, assets)).subarray(0, 4096);
  const text = new TextDecoder('utf-8').decode(bytes);
  if (bytes.includes(0) || text.includes('\uFFFD')) return { status: 'not-a-data-table', kind: 'binary-resource' };
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return { status: 'not-a-data-table', kind: 'json-document' };
  if (trimmed.startsWith('info face=')) return { status: 'not-a-data-table', kind: 'bitmap-font-descriptor' };
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  // A one-line file is a character list, even when the characters themselves include commas.
  if (lines.length < 2) return { status: 'not-a-data-table', kind: 'single-line-character-list' };
  const header = lines[0];
  if (!header.includes(',')) return { status: 'not-a-data-table', kind: 'single-line-character-list' };
  // A real sheet header names its columns; a positional data row starts with numbers instead.
  if (header.split(',').some(column => /^-?\d+(\.\d+)?$/.test(column.trim()))) {
    return { status: 'not-a-data-table', kind: 'headerless-positional-rows' };
  }
  return { status: 'not-imported', kind: 'unparsed-sheet' };
}
const routes = [
  [/^(PetQuest|PetParadise)/, 'I06'], [/^Gemstone/, 'L04'], [/^Endgame/, 'L05'],
  [/^(Raid|SoloRaid)/, 'M04-M06'], [/^(ChallengeTournament|SuperChallengeTournament)/, 'M08'],
  [/^(Tournament|NewPlayerTournament|SuperTournament)/, 'M07'],
  [/^(Minigame|HolidayEvent|Anniversary|GlobalEvent)/, 'V01-V02'],
  [/^(Shop|AdChest|NewPrize)/, 'L02'], [/^(Avatar|ProfileBackground|PlayerTitle|Frame)/, 'V03'],
  [/^Localization/, 'V05'], [/^(ServerVar|ScheduledBonus|UpdateInfo)/, 'R01-R05'],
  [/^(Artifact|ActiveSkill|SkillTree|Equipment|C_Equipment|Helper|PlayerImprovements|TitanScaling|PetInfo|PassiveSkill|BonusInfo|ClanScroll|Daily)/, 'core-reference'],
];
const resources = manifest.resourceIndex.map(r => {
  const name = r.name.replace(/^\d+_/, '').replace(/\.txt$/, '');
  const route = routes.find(([pattern]) => pattern.test(name))?.[1] ?? 'needs-manual-triage';
  const base = { name, sourceSha256: r.sha256, route };
  if (imported.has(name)) return { ...base, status: 'imported', kind: 'data-table' };
  if (name === 'RaidEnemyLayout') return { ...base, status: 'atlas-ids-indexed', kind: 'sprite-atlas-json' };
  if (localized.has(name)) return { ...base, status: 'localization-indexed', kind: 'localization-strings' };
  if (shopSamples.has(name)) return { ...base, status: 'sample-indexed', kind: 'shop-server-response-sample' };
  if (quarantined.has(name)) return { ...base, status: 'quarantined', kind: 'recorded-with-reason' };
  return { ...base, ...inspect(name) };
});
const groups = {};
for (const r of resources.filter(r => r.status === 'not-imported')) (groups[r.route] ??= []).push(r.name);
const byStatus = resources.reduce((tally, r) => ({ ...tally, [r.status]: (tally[r.status] ?? 0) + 1 }), {});
const byKind = resources.filter(r => r.status === 'not-a-data-table')
  .reduce((tally, r) => ({ ...tally, [r.kind]: (tally[r.kind] ?? 0) + 1 }), {});
const report = { version: '8.2.0', classificationBasis: 'resource-name-routing plus first-bytes format check',
  caveat: 'Format detection says what a file is, not that its meaning, mechanics or activation are verified',
  byStatus, nonTableKinds: byKind, resources };
writeFileSync(new URL('docs/reference-coverage.json', root), JSON.stringify(report, null, 2) + '\n');
let text = '# 剩餘參考資源盤點\n\n';
text += `共 ${resources.length} 個 TextAsset：${byStatus.imported ?? 0} 張表已匯入、${byStatus['localization-indexed'] ?? 0} 個在地化檔已索引鍵、${byStatus['sample-indexed'] ?? 0} 個商店回應樣本已記錄形狀、1 個圖集已記錄 ID、${byStatus.quarantined ?? 0} 個已附理由不匯入，${byStatus['not-a-data-table'] ?? 0} 個經格式判定不是資料表，其餘 ${byStatus['not-imported'] ?? 0} 個仍待處理。\n\n`;
text += `不是資料表的內容依格式分類：${Object.entries(byKind).sort().map(([kind, count]) => `${kind} ${count}`).join('、')}。這些不列入待做系統數。\n\n`;
text += '以下依檔名分派到 ROADMAP 項目，僅作查找順序，不是格式或玩法判定。每日配送內容與線上季節選用仍待外部證據；同名不同來源變體不得直接覆寫。\n\n';
for (const [route, names] of Object.entries(groups).sort()) text += `## ${route}\n\n${names.sort().map(n => '- ' + n).join('\n')}\n\n`;
text += '由 `node tools/reference-coverage.mjs` 產生；逐資源雜湊與狀態見 reference-coverage.json。\n';
writeFileSync(new URL('docs/reference-coverage.md', root), text);
console.log(`Coverage indexed: ${resources.length} resources, ` + Object.entries(byStatus).sort().map(([k, v]) => `${k}=${v}`).join(', '));
