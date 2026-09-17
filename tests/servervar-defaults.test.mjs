import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { PLAYER_DEFAULTS } from '../lib/tt2-player.ts';
import { HELPER_DEFAULTS } from '../lib/engine.ts';

const evidence = JSON.parse(readFileSync(new URL('servervar-defaults.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.match(evidence.binarySha256, /^[0-9a-f]{64}$/);
});

test('954 個靜態欄位裡解出 745 個純量預設值，其餘逐項列名而不是含混帶過', () => {
  assert.equal(evidence.recoveredCount, 745);
  assert.equal(Object.keys(evidence.recovered).length, 745);
  const unresolved = evidence.unrecovered;
  assert.equal(unresolved.count, 209);
  assert.equal(745 + 209, 954);
  // Every unresolved field is named, so the gap can be chased rather than guessed at.
  const named = Object.values(unresolved.names).reduce((n, list) => n + list.length, 0);
  assert.equal(named, unresolved.count);
  for (const [kind, count] of Object.entries(unresolved.byType)) {
    assert.equal(unresolved.names[kind].length, count, kind);
  }
});

test('三個本專案先前手工取得的值，走這條路也得到同一個數字', () => {
  assert.deepEqual(evidence.selfCheck, {
    helperUpgradeBase: 1.0800000429153442,
    playerUpgradeCostBase: 5,
    playerUpgradeCostGrowth: 1.0750000476837158,
  });
  // The engine's own constants are those values, to the float.
  assert.equal(HELPER_DEFAULTS.costGrowth, evidence.recovered.helperUpgradeBase.value);
  assert.equal(PLAYER_DEFAULTS.costBase, evidence.recovered.playerUpgradeCostBase.value);
  assert.equal(PLAYER_DEFAULTS.costGrowth, evidence.recovered.playerUpgradeCostGrowth.value);
});

test('與包內變數表互證：一致的照樣一致，被覆蓋的看得出是覆蓋', () => {
  const override = load('ServerVarOverride');
  const rows = Object.fromEntries(override.records.map(r => [r.values.ServerVarsKey, r.values.Value]));
  // The egg timer this project already relies on: the table says 4 and so does the compiled default.
  assert.equal(rows.hoursToCollectEgg, '4');
  assert.equal(evidence.recovered.hoursToCollectEgg.value, 4);
  assert.equal(rows.clanNameChangeCost, '800');
  assert.equal(evidence.recovered.clanNameChangeCost.value, 800);
  // And the case that shows a default is not a live value: the stage cap ships as 1,000,000 in code
  // and is overridden to 98,000 by the bundled table, which is the number the game actually uses.
  assert.equal(evidence.recovered.maxStage.value, 1_000_000);
  const info = load('ServerVarsInfo');
  const maxStage = info.records.find(r => r.values.ServerVarsKey === 'maxStage');
  assert.equal(maxStage.values.iOS, '98000');
  assert.ok(evidence.alsoInPackageTables.includes('maxStage'));
});

test('原本就記錄過的事實仍然成立', () => {
  // The register says helper crits are off by default; that came from this same static block.
  assert.equal(evidence.recovered.helperCanCrit.value, false);
  assert.ok(evidence.limits.some(limit => limit.includes('[ServerVar]')));
  assert.match(evidence.consequence, /default/);
});
