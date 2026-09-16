import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply, fresh, health, reward } from '../lib/engine.ts';
import { STAGE_CAP } from '../lib/tt2-limits.ts';
import { ZERO, toNumber } from '../lib/big-number.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';

const at = (stage, fn) => {
  const state = fresh(1000);
  state.stage = stage; state.best = stage; state.worldBest = [stage, stage];
  return fn(state);
};

test('the stage counter stops where the package says it does, not at an invented 1800', () => {
  const rows = JSON.parse(readFileSync(new URL('ServerVarsInfo.json', referenceRoot), 'utf8')).records;
  assert.equal(STAGE_CAP, Number(rows.find(row => row.id === 'maxStage').values.iOS));
  assert.equal(STAGE_CAP, 98000);
  const state = fresh(1000);
  state.stage = STAGE_CAP; state.best = STAGE_CAP; state.kills = 999; state.farming = false;
  // Clearing a boss at the cap must not move the stage past it.
  const after = apply({ ...state, hp: { ...ZERO } }, { type: 'tap', at: state.last + 1000 });
  assert.equal(after.stage, STAGE_CAP);
});

test('monster health and gold stay exact at the last stage instead of flattening', () => {
  // The old ceiling flattened health at stage 1982 and gold at 2307, both short of the cap.
  for (const stage of [1982, 2307, STAGE_CAP]) {
    for (const [label, value] of [['血量', at(stage, health)], ['金幣', at(stage, reward)]]) {
      assert.ok(Number.isFinite(value.s) && Number.isFinite(value.e), `${stage} 關${label}`);
      assert.ok(value.s >= 1 && value.s < 10, `${stage} 關${label}尾數 ${value.s}`);
    }
  }
  // Each stage still multiplies the previous one; nothing is clamped along the way.
  const growth = at(1983, health).e - at(1982, health).e;
  assert.ok(growth === 0 || growth === 1);
  assert.ok(at(STAGE_CAP, health).e > at(STAGE_CAP - 1, health).e - 1);
});

test('the last stage is past what a double holds, which is why the value is a pair', () => {
  const last = at(STAGE_CAP, health);
  // 18 x 1.32^97999: about 10^11817, roughly 11,500 orders of magnitude past Number.MAX_VALUE.
  assert.equal(last.e, 11817);
  assert.ok(last.e > 308);
  assert.equal(toNumber(last), Number.MAX_VALUE);
  assert.equal(at(STAGE_CAP, reward).e, 10173);
  // Before the change these two both sat on 1e240 from stage 2307 onwards.
  assert.ok(at(STAGE_CAP, health).e > 240 && at(STAGE_CAP, reward).e > 240);
});
