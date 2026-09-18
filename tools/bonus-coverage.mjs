/**
 * Cross-reference every BonusType three ways: does this project hand it out, does the engine read
 * it, and does the native game read it.
 *
 * A bonus that a talent or artifact grants but nothing consumes is a number the player can see and
 * buy and that does nothing - 2.14.0, 2.14.1 and 2.14.2 were each one instance of that, found by
 * hand. This lists them all at once, and splits the ones worth fixing from the ones where the
 * native game has no consumer either, using bonus-readers-evidence.json for the native side.
 *
 * The engine side is a source scan, so it has to account for ids that are assembled rather than
 * written out: `SKILL_DATA[i].id + 'SkillMana'` is a read of six bonuses that no literal search
 * would find. The suffixes are extracted from the source instead of hard-coded, so a new one is
 * picked up rather than silently miscounted as dead.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as data from '../lib/tt2-data.ts';
import { bonusDefinitions } from '../lib/tt2-rules.ts';
import { SKILL_DATA } from '../lib/engine.ts';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

/** The modules that actually compute with bonuses; UI and label tables do not count as a read. */
const ENGINE_FILES = [
  'lib/engine.ts', 'lib/tt2-rules.ts', 'lib/tt2-pet-combat.ts', 'lib/tt2-hero-passives.ts',
  'lib/tt2-player.ts', 'lib/tt2-limits.ts', 'lib/tt2-perks.ts', 'lib/tt2-collection.ts',
  'lib/tt2-stages.ts',
];

/**
 * Systems this project has not built yet. A bonus belongs to one when its own name says so, or
 * when the only native class reading it does. This is a judgement about the project's scope, not
 * a fact about the package - it is listed here so it can be argued with, and it decides nothing
 * except which bonuses get sorted into the priority section.
 */
const UNBUILT = [
  'ClanShip', 'Clan', 'Dagger', 'StreamOfBlades', 'GoldGun', 'GoldenMissile', 'Raid', 'Contract',
  'Fishing', 'Minigame', 'BallDrop', 'Tournament', 'Gemstone', 'Endgame', 'Season', 'Card',
  'Cannon', 'Portal', 'Monument', 'Research', 'Summon', 'Holiday', 'Anniversary', 'GlobalEvent',
  'Inbox', 'Frenzy', 'Warlord', 'Twilight', 'Hayst', 'Snap', 'Abyss', 'Alchemist', 'Kratos',
  'LightningStrike', 'MagnumOpus', 'ForbiddenContract', 'RoyalContract', 'Lifetime', 'AT',
];
const isUnbuilt = text => UNBUILT.some(name => text.includes(name));

const nativeEvidence = JSON.parse(read('reference/tt2/8.2.0/bonus-readers-evidence.json'));
const nativeTypes = JSON.parse(read('reference/tt2/8.2.0/native-bonus-types.json'));

const code = ENGINE_FILES.map(read).join('\n');

/** Ids the engine names outright, in any of the three quote styles. */
const literals = new Set();
for (const match of code.matchAll(/['"`]([A-Za-z][A-Za-z0-9]{2,})['"`]/g)) literals.add(match[1]);

/**
 * Ids the engine does not write out. Two shapes: a skill id plus a suffix, and a skill's own
 * effect field - the latter comes from the data table, so no source scan would ever see it.
 * The suffixes are collected from the source so a new one is picked up.
 */
const assembled = new Set();
const suffixes = new Set();
for (const match of code.matchAll(/\.id\s*\+\s*['"`]([A-Za-z]+)['"`]/g)) suffixes.add(match[1]);
for (const skill of SKILL_DATA) {
  for (const suffix of suffixes) assembled.add(skill.id + suffix);
  if (code.includes('SKILL_DATA[i].effect')) assembled.add(skill.effect);
}

/**
 * Every argument shape this scan knows how to resolve. A call whose id comes from somewhere else
 * would be counted as "nobody reads it", so an unrecognised shape stops the report instead: the
 * named ones are parameters that callers fill from literal arrays already caught above.
 */
const KNOWN_ARGUMENTS = new Set([
  'target', 'id', 'key', 'own',                       // filled by callers from literal lists
  'k.stage', 'k.stageMult', 'k.titan',                // SKIP_SOURCES, literal in engine.ts
  'SKILL_DATA[i].effect',                             // expanded above
  ...[...suffixes].map(s => `SKILL_DATA[i].id+'${s}'`),
]);
const unresolved = new Set();
for (const match of code.matchAll(/(?:stateEffect|baseEffect|effect)\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
  const argument = match[1].split(',').pop().trim();
  if (!argument || argument.includes(':')) continue;                 // a declaration, not a call
  if (/^['"`]/.test(argument) || /\?.*:/.test(argument)) continue;   // literal, or a literal ternary
  if (!KNOWN_ARGUMENTS.has(argument)) unresolved.add(argument);
}
if (unresolved.size) {
  throw new Error('這些加成查詢的參數形式沒有對應的展開規則，清單會把它們誤判成沒人讀：'
    + [...unresolved].join(', '));
}

/**
 * Not every skill has every bonus - there is no BurstDamageSkillDuration, natively either. The
 * engine skips those combinations (see skillBonus in engine.ts), so they are not reads; they are
 * published rather than dropped, because a combination appearing or leaving this list means a
 * skill gained or lost a bonus.
 */
const skipped = [...assembled].filter(id => !(id in bonusDefinitions)).sort();
for (const id of skipped) assembled.delete(id);

/**
 * Bonuses the engine consumes without ever naming them, so no source scan would see the read.
 * Listed explicitly rather than inferred, and each one is checked below against the thing it
 * claims to be - an index that shifts would otherwise turn a real read into a silent "nobody
 * reads it", which is exactly the mistake this report exists to prevent.
 */
const INDIRECT_READS = {
  AllArtifactDamageEffect: { artifact: 98, where: 'lib/tt2-rules.ts baseFrom：群組 Damage 的神器以索引 98 取用' },
  AllArtifactGoldEffect: { artifact: 99, where: 'lib/tt2-rules.ts baseFrom：群組 Gold 的神器以索引 99 取用' },
};
for (const [id, claim] of Object.entries(INDIRECT_READS)) {
  if (data.TT2_ARTIFACTS[claim.artifact]?.effect !== id) {
    throw new Error(`間接讀取登記失效：神器索引 ${claim.artifact} 不再是 ${id}`);
  }
}

const engineReads = id => literals.has(id) || assembled.has(id) || id in INDIRECT_READS;

/** Which project tables hand each bonus out. */
const sources = new Map();
for (const [table, rows] of Object.entries(data)) {
  if (!Array.isArray(rows) || !rows.length) continue;
  const blob = JSON.stringify(rows);
  for (const id of Object.keys(bonusDefinitions)) {
    if (!blob.includes(`"${id}"`)) continue;
    if (!sources.has(id)) sources.set(id, []);
    sources.get(id).push(table);
  }
}

/** The native system a bonus belongs to, named by the class that reads it. */
function nativeSystem(id) {
  const entry = nativeEvidence.read[id];
  if (!entry) return null;
  const classes = [...new Set(Object.keys(entry.methods).map(m => m.split('$$')[0]))];
  return classes.sort();
}

const rows = [];
for (const id of Object.keys(nativeTypes.values)) {
  if (id === 'None') continue;
  const granted = sources.get(id) ?? null;
  const engine = engineReads(id);
  const native = nativeSystem(id);
  let verdict;
  if (!granted) verdict = engine ? 'read-without-source' : 'not-in-project';
  else if (engine) verdict = 'live';
  else verdict = native ? 'dead-native-uses-it' : 'dead-native-ignores-it';
  // Priority: the native game consumes it, we do not, and it is not part of a system we skipped.
  const unbuilt = verdict === 'dead-native-uses-it'
    && (isUnbuilt(id) || native.every(isUnbuilt));
  rows.push({ id, verdict, sources: granted, engineReads: engine, nativeReaders: native,
    indirect: INDIRECT_READS[id]?.where ?? null,
    priority: verdict === 'dead-native-uses-it' && !unbuilt });
}

const by = verdict => rows.filter(r => r.verdict === verdict);
const counts = Object.fromEntries(
  ['live', 'dead-native-uses-it', 'dead-native-ignores-it', 'read-without-source', 'not-in-project']
    .map(v => [v, by(v).length]));

/** Group a list by the native class that consumes the bonus, largest group first. */
function group(list) {
  const grouped = new Map();
  for (const row of list) {
    const key = row.nativeReaders.join(' / ');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}
const priority = by('dead-native-uses-it').filter(r => r.priority);
const deferred = by('dead-native-uses-it').filter(r => !r.priority);
const groups = group(priority);

const report = {
  version: '8.2.0',
  role: '每個加成的三方對照：專案有沒有來源會給、引擎有沒有讀、原生有沒有取值點。',
  generatedFrom: {
    nativeEvidence: 'reference/tt2/8.2.0/bonus-readers-evidence.json',
    engineFiles: ENGINE_FILES,
    assembledSuffixes: [...suffixes].sort(),
    skippedCombinations: skipped,
    unbuiltSystems: UNBUILT,
    indirectReads: INDIRECT_READS,
  },
  counts,
  verdicts: {
    live: '專案有來源、引擎有讀：正常運作。',
    'dead-native-uses-it': '專案有來源、引擎沒讀，而且原生有取值點：**這些是可以接上的**。',
    'dead-native-ignores-it': '專案有來源、引擎沒讀，原生也掃不到取值點：接了大概也沒有依據。',
    'read-without-source': '引擎有讀，但專案沒有任何來源會給：恆為中性值，等來源出現才會生效。',
    'not-in-project': '專案沒有來源，引擎也沒讀。',
  },
  rows,
  limits: [...nativeEvidence.limits,
    '低估有具體實例：EquipmentModel.EquipmentSetCountBonusHandler 依稀有度從表裡取 BonusType 再以暫存器'
    + '傳給 GetBonus，所以 DamagePerLegendarySet 這一族會被歸成「原生也沒有取值點」，'
    + '實際上就在那個方法裡被消費——見 reference/tt2/8.2.0/count-bonus-evidence.json。'],
};
writeFileSync(fileURLToPath(new URL('docs/bonus-coverage.json', root)),
  JSON.stringify(report, null, 2) + '\n');

const lines = [];
lines.push('# 加成覆蓋率對照表', '');
lines.push('每個加成三方對照：**專案有沒有來源會給**、**引擎有沒有讀**、**原生有沒有取值點**。');
lines.push('由 `node tools/bonus-coverage.mjs` 產生；原生那一欄來自 `tools/audit-bonus-readers.py`。', '');
lines.push(`版本 ${report.version}。共 ${rows.length} 個加成。`, '');
lines.push('| 判定 | 意義 | 個數 |', '|---|---|---|');
for (const [key, count] of Object.entries(counts)) {
  lines.push(`| \`${key}\` | ${report.verdicts[key]} | ${count} |`);
}
lines.push('');
lines.push(`## 優先：落在已實作系統的（${priority.length}）`, '');
lines.push('原生有取值點、我們沒讀，而且**不屬於尚未實作的流派**——這些是可以直接接上的。');
lines.push('依**原生讀取它的類別**分組，類別名就說明了它屬於哪個系統。', '');
for (const [system, list] of groups) {
  lines.push(`### ${system}（${list.length}）`, '');
  for (const row of list) {
    lines.push(`- \`${row.id}\` ← ${row.sources.join('、')}`);
  }
  lines.push('');
}
lines.push(`## 等流派實作再說的（${deferred.length}）`, '');
lines.push('原生有取值點，但屬於本專案尚未實作的系統（見 `generatedFrom.unbuiltSystems`）。', '');
for (const [system, list] of group(deferred)) {
  lines.push(`- **${system}**：${list.map(r => `\`${r.id}\``).join('、')}`);
}
lines.push('');
lines.push('## 引擎有讀、但不是用名字查的', '');
lines.push('這些加成引擎確實有消費，只是沒有把名字寫出來，所以原始碼掃描看不到——逐項列在這裡才不會被誤判成沒作用。', '');
for (const [id, claim] of Object.entries(INDIRECT_READS)) lines.push(`- \`${id}\` ← ${claim.where}`);
lines.push('');
lines.push('## 原生也掃不到取值點的', '');
lines.push('專案有來源會給，但原生與我們都沒有取值點。接上去沒有依據，先不要動。', '');
lines.push(by('dead-native-ignores-it').map(r => `\`${r.id}\``).join('、') || '（無）', '');
lines.push('## 引擎有讀但專案沒有來源的', '');
lines.push('這些已經接好了，只是還沒有任何神器、天賦、寵物或套裝會給，所以恆為中性值。', '');
lines.push(by('read-without-source').map(r => `\`${r.id}\``).join('、') || '（無）', '');
lines.push('## 限制', '');
for (const limit of report.limits) lines.push(`- ${limit}`);
lines.push('');
writeFileSync(fileURLToPath(new URL('docs/bonus-coverage.md', root)), lines.join('\n'));

console.log(`${rows.length} bonuses: ` +
  Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`priority (already-built systems): ${priority.length} in ${groups.length} groups, largest: ` +
  groups.slice(0, 3).map(([s, l]) => `${s} (${l.length})`).join(', '));
console.log(`deferred until the build is implemented: ${deferred.length}`);
