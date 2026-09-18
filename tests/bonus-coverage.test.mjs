import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, hydrate, skillDuration, skillMana, SKILLS, SKILL_DATA } from '../lib/engine.ts';
import { bonusDefinitions } from '../lib/tt2-rules.ts';
import { TT2_ARTIFACTS } from '../lib/tt2-data.ts';

const evidence = JSON.parse(readFileSync(new URL('bonus-readers-evidence.json', referenceRoot), 'utf8'));
const coverage = JSON.parse(readFileSync(new URL('../docs/bonus-coverage.json', import.meta.url), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('掃描歸因得夠完整，而且失敗的原因逐類記著', () => {
  const sites = evidence.callSites;
  assert.ok(sites.total > 800, `呼叫點只剩 ${sites.total} 個，掃描可能壞了`);
  assert.equal(sites.attributed + sites.unattributed, sites.total);
  assert.ok(sites.attributed / sites.total > 0.9,
    `歸因率掉到 ${(sites.attributed / sites.total * 100).toFixed(1)}%，結論的可信度跟著掉`);
  const reasons = sites.unattributedReasons;
  assert.equal(reasons.stoppedAtCall + reasons.writtenByRegister + reasons.noWriteInWindow,
    sites.unattributed);
});

test('對照組的加成都還被原生那幾個方法讀著', () => {
  for (const [label, method] of Object.entries(evidence.controls)) {
    assert.ok(evidence.read[label], `${label} 掃不到取值點，掃描可能壞了`);
    assert.ok(Object.keys(evidence.read[label].methods).includes(method), `${label} 不再由 ${method} 讀取`);
  }
});

test('暴擊傷害在原生仍然只有一個取值點', () => {
  assert.deepEqual(Object.keys(evidence.read.CritDamage.methods), ['PlayerModel$$RefreshCriticalValues']);
});

test('每個被拼出來的加成，不是真的存在就是被明確跳過', () => {
  const skipped = new Set(coverage.generatedFrom.skippedCombinations);
  for (const skill of SKILL_DATA) {
    for (const suffix of coverage.generatedFrom.assembledSuffixes) {
      const id = skill.id + suffix;
      assert.ok(id in bonusDefinitions || skipped.has(id),
        `${id} 既不在加成表裡，也沒有列進 skippedCombinations`);
    }
    assert.ok(skill.effect in bonusDefinitions, `${skill.effect} 不在加成表裡`);
  }
});

test('查一個不存在的加成不會被當成秒數或魔力加進去', () => {
  // 天堂聖擊沒有 BurstDamageSkillDuration——原生也沒有這個加成，因為它是瞬發技能。
  // 查不存在的加成會拿到乘法中性值 1，加進秒數就變成 3+1＝4 秒。
  assert.ok(coverage.generatedFrom.skippedCombinations.includes('BurstDamageSkillDuration'));
  const s = hydrate(fresh(1000));
  for (let i = 0; i < SKILL_DATA.length; i++) {
    assert.equal(skillDuration(s, i), SKILLS[i].duration,
      `${SKILL_DATA[i].id} 的持續時間在沒有任何加成時應該等於基礎值`);
    assert.equal(skillMana(s, i), SKILL_DATA[i].mana[0],
      `${SKILL_DATA[i].id} 的耗魔在沒有任何加成時應該等於基礎值`);
  }
});

test('以其他方式讀取的加成逐項登記，而且登記本身有被檢查', () => {
  // 這些引擎有消費、但沒有把名字寫出來，原始碼掃描看不到。登記錯了會把真的讀取誤判成沒作用，
  // 所以工具在產表時就會驗證每一筆宣稱——這裡再釘一次，確保登記沒有被悄悄清空。
  const indirect = coverage.generatedFrom.indirectReads;
  assert.ok(Object.keys(indirect).length > 0, '間接讀取的登記不該是空的');
  for (const [id, claim] of Object.entries(indirect)) {
    assert.equal(TT2_ARTIFACTS[claim.artifact].effect, id, `神器索引 ${claim.artifact} 應該是 ${id}`);
    const row = coverage.rows.find(r => r.id === id);
    assert.equal(row.verdict, 'live', `${id} 有讀就不該被算成沒作用`);
    assert.equal(row.indirect, claim.where);
  }
});

test('覆蓋率的分布記下來，加成接上或掉線都是看得見的改動', () => {
  assert.deepEqual(coverage.counts, {
    live: 105,
    'dead-native-uses-it': 124,
    'dead-native-ignores-it': 68,
    'read-without-source': 13,
    'not-in-project': 486,
  });
  const priority = coverage.rows.filter(r => r.priority);
  assert.equal(priority.length, 60, '落在已實作系統、可以接上的加成數量變了');
});

test('判定彼此互斥，每個加成只會落在一類', () => {
  const total = Object.values(coverage.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, coverage.rows.length);
  for (const row of coverage.rows) {
    if (row.verdict === 'live') assert.ok(row.sources && row.engineReads);
    if (row.verdict.startsWith('dead')) assert.ok(row.sources && !row.engineReads);
    if (row.priority) assert.equal(row.verdict, 'dead-native-uses-it');
  }
});
