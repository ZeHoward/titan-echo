import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, hydrate, critMultiplier, tapDamage, buildDamage, stateEffect } from '../lib/engine.ts';
import { buildMultiplier, effect, artifactAllDamage, BUILD_COEFFICIENTS } from '../lib/tt2-rules.ts';
import { TT2_ARTIFACTS } from '../lib/tt2-data.ts';
import { toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('critical-damage-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const rules = readFileSync(new URL('../lib/tt2-rules.ts', import.meta.url), 'utf8');

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.match(evidence.binarySha256, /^[0-9a-f]{64}$/);
});

test('暴擊傷害加成在原生只有一個讀取點，而且是暴擊倍率那一個', () => {
  assert.deepEqual(evidence.critDamageReaders, ['PlayerModel$$RefreshCriticalValues']);
  assert.equal(evidence.methods['PlayerModel$$RefreshCriticalValues'], '0x23da120');
});

test('同一趟掃描的三個對照加成都掃得到讀取點，所以「只有一處」不是掃描失效', () => {
  const controls = evidence.controls;
  assert.deepEqual(Object.keys(controls).sort(), ['AllDamage', 'SwordMasterDamage', 'TapDamage']);
  for (const [label, control] of Object.entries(controls)) {
    assert.ok(control.readers.length > 0, `${label} 應該掃得到讀取點`);
  }
  assert.ok(controls.SwordMasterDamage.readers.includes('PlayerModel$$GetSwordMasterDamage'));
  assert.ok(controls.TapDamage.readers.includes('PlayerModel$$GetTapFromHelpers'));
});

test('暴擊倍率的基礎值是原生的 playerCritMult，引擎用的就是它', () => {
  assert.equal(evidence.serverVars.playerCritMult.defaultValue, 11.5);
  assert.equal(evidence.serverVars.playerCritMult.status, 'default');
  const s = hydrate(fresh(1000));
  assert.equal(critMultiplier(s), 11.5 * stateEffect(s, 'CritDamage'));
});

test('流派倍率完全不看暴擊傷害加成', () => {
  const s = hydrate(fresh(1000));
  const t = s.tt2;
  for (const build of Object.keys(BUILD_COEFFICIENTS)) {
    const plain = buildMultiplier(t, build, 0, false);
    const inflated = buildMultiplier(t, build, 0, false, id => (id === 'CritDamage' ? 7 : effect(t, id)));
    assert.equal(inflated, plain, `${build} 的倍率不該隨暴擊傷害加成變動`);
  }
});

test('升級暴擊傷害神器，一般傷害只吃它的通用傷害項，不吃暴擊那一份', () => {
  const index = TT2_ARTIFACTS.findIndex(a => a.effect === 'CritDamage');
  assert.ok(index >= 0, '應該有一件給 CritDamage 的神器');
  const before = hydrate(fresh(1000));
  before.level = 600;
  before.heroes = before.heroes.map(() => 50);
  const after = hydrate(structuredClone(before));
  after.tt2.artifacts[index] = 40;

  const critRatio = stateEffect(after, 'CritDamage') / stateEffect(before, 'CritDamage');
  assert.ok(critRatio > 1, '升到 40 級應該真的提高暴擊傷害加成');

  // 每件神器都另外帶一個通用傷害項，所以傷害會變；重點是它「只」變那麼多。
  const generic = artifactAllDamage(after.tt2) / artifactAllDamage(before.tt2);
  for (const [label, value] of [['點擊', tapDamage], ['寵物', s => buildDamage(s, 'pet')]]) {
    const ratio = toNumber(value(after)) / toNumber(value(before));
    assert.ok(Math.abs(ratio - generic) < 1e-9 * generic,
      `${label}傷害多吃了暴擊傷害加成：${ratio} 應該是 ${generic}`);
  }
  const applied = critMultiplier(after) / critMultiplier(before);
  assert.ok(Math.abs(applied - critRatio) < 1e-9 * critRatio,
    `暴擊倍率才是那件神器該影響的地方：${applied} 應該是 ${critRatio}`);
});

test('buildMultiplier 這一行不得再把暴擊傷害乘回去', () => {
  const line = rules.split('\n').find(l => l.startsWith('export function buildMultiplier'));
  assert.ok(line, '找不到 buildMultiplier');
  assert.ok(!line.includes('CritDamage'), 'buildMultiplier 又把 CritDamage 乘進一般傷害了');
});
