// Planning inventory: filename routing is not proof of gameplay semantics or file format.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('reference/tt2/8.2.0/manifest.json', root), 'utf8'));
const imported = new Set(manifest.tables.map(t => t.table));
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
  return { name, sourceSha256: r.sha256,
    status: imported.has(name) ? 'imported' : name === 'RaidEnemyLayout' ? 'atlas-ids-indexed' : 'not-imported',
    route: routes.find(([pattern]) => pattern.test(name))?.[1] ?? 'needs-manual-triage' };
});
const groups = {};
for (const r of resources.filter(r => r.status === 'not-imported')) (groups[r.route] ??= []).push(r.name);
const report = { version: '8.2.0', classificationBasis: 'resource-name-routing-only',
  caveat: 'Not all TextAssets are data tables; routing does not imply verified format, mechanics or activation', resources };
writeFileSync(new URL('docs/reference-coverage.json', root), JSON.stringify(report, null, 2) + '\n');
let text = '# 剩餘參考資源盤點\n\n';
text += `共 ${resources.length} 個 TextAsset；${imported.size} 張表已匯入，1 個圖集已記錄 ID，其餘 ${resources.filter(r => r.status === 'not-imported').length} 個資源尚未匯入。這些資源包含非資料表內容，不能當成待做系統數或完成率。\n\n`;
text += '以下依檔名分派到 ROADMAP 項目，僅作查找順序，不是格式或玩法判定。每日配送內容與線上季節選用仍待外部證據；同名不同來源變體不得直接覆寫。\n\n';
for (const [route, names] of Object.entries(groups).sort()) text += `## ${route}\n\n${names.sort().map(n => '- ' + n).join('\n')}\n\n`;
text += '由 `node tools/reference-coverage.mjs` 產生；逐資源雜湊與狀態見 reference-coverage.json。\n';
writeFileSync(new URL('docs/reference-coverage.md', root), text);
console.log(`Coverage indexed: ${resources.length} resources, ${imported.size} imported tables`);
