import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadNativeServerVarFields } from '../tools/reference-validation.mjs';
const report = JSON.parse(readFileSync(new URL('../docs/server-var-gaps.json', import.meta.url), 'utf8'));

test('the package carries only a fraction of the native server variables', () => {
  assert.equal(report.nativeFields, loadNativeServerVarFields().size);
  assert.equal(report.nativeFields, 953);
  assert.equal(report.bundledKeys, 37);
  const carried = report.fields.filter(row => row.bundled);
  assert.equal(carried.length, 28);
  // The nine sheet keys with no native field are the drift already recorded in the validation report.
  assert.equal(report.bundledKeys - carried.length, 9);
  for (const row of carried) assert.ok(['ServerVarsInfo', 'ServerVarOverride'].includes(row.source), row.field);
});

test('every combat parameter group the C stage needs has no value in this package', () => {
  const byTopic = Object.fromEntries(report.topics.map(entry => [entry.topic, entry]));
  for (const topic of ['C01 暴擊', 'C02 劍術大師', 'C03-C04 英雄', 'C05 泰坦與金幣',
    'C06 濺射與跳關', 'C07 魔力', 'I01-I03 裝備']) {
    assert.ok(byTopic[topic], topic);
    assert.ok(byTopic[topic].fields > 0, topic);
    assert.equal(byTopic[topic].bundled, 0, `${topic} 竟然有包內值`);
    assert.deepEqual(byTopic[topic].bundledFields, [], topic);
  }
  // Titan and gold scaling is the largest gap of all.
  assert.equal(byTopic['C05 泰坦與金幣'].fields, 67);
  assert.equal(byTopic['C01 暴擊'].fields, 10);
  assert.equal(byTopic['C03-C04 英雄'].fields, 22);
});

test('the report says plainly what a field name and a bundled value do and do not prove', () => {
  assert.match(report.basis, /a name is not a formula/);
  assert.match(report.caveat, /not the value the live server sends/);
  // Every field is routed and each routed field keeps its own flag, so nothing is silently grouped away.
  assert.equal(report.fields.length, report.nativeFields);
  assert.equal(report.topics.reduce((total, entry) => total + entry.fields, 0), report.nativeFields);
  assert.ok(report.fields.every(row => typeof row.topic === 'string' && row.topic.length > 0));
});
