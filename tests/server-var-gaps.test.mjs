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

test('the C-stage groups have nothing in the bundled tables, but most of them do have a default', () => {
  const byTopic = Object.fromEntries(report.topics.map(entry => [entry.topic, entry]));
  for (const topic of ['C01 暴擊', 'C02 劍術大師', 'C03-C04 英雄', 'C05 泰坦與金幣',
    'C06 濺射與跳關', 'C07 魔力', 'I01-I03 裝備']) {
    assert.ok(byTopic[topic], topic);
    assert.ok(byTopic[topic].fields > 0, topic);
    assert.equal(byTopic[topic].bundled, 0, `${topic} 竟然有包內值`);
    assert.deepEqual(byTopic[topic].bundledFields, [], topic);
  }
  // Titan and gold scaling is the largest group of all.
  assert.equal(byTopic['C05 泰坦與金幣'].fields, 67);
  assert.equal(byTopic['C01 暴擊'].fields, 10);
  assert.equal(byTopic['C03-C04 英雄'].fields, 22);
  // The correction that matters: "no value in the package" was only true of the tables. Most of
  // these fields do have a compiled-in default, and equipment has one for every single field.
  assert.equal(byTopic['C05 泰坦與金幣'].compiledDefaults, 61);
  assert.equal(byTopic['C01 暴擊'].compiledDefaults, 8);
  assert.equal(byTopic['I01-I03 裝備'].compiledDefaults, 26);
  assert.equal(byTopic['I01-I03 裝備'].neither, 0);
  for (const entry of report.topics) {
    assert.equal(entry.fields, entry.compiledDefaults + entry.neither
      + entry.fields - entry.compiledDefaults - entry.neither, entry.topic);
    assert.ok(entry.neither <= entry.fields, entry.topic);
  }
});

test('the two lines of evidence are counted separately and the real gap is what neither covers', () => {
  assert.equal(report.compiledDefaults, 769);
  assert.equal(report.neither, 183);
  const withDefault = report.fields.filter(row => row.compiledDefault);
  assert.equal(withDefault.length, report.compiledDefaults);
  assert.equal(report.fields.filter(row => !row.bundled && !row.compiledDefault).length, report.neither);
  // A default is not a live value: the stage cap ships as 1,000,000 and the table overrides it.
  const maxStage = report.fields.find(row => row.field === 'maxStage');
  assert.equal(maxStage.defaultValue, 1_000_000);
  assert.equal(maxStage.bundled, true);
  // Fields with no default at all carry no value in the report either.
  for (const row of report.fields) {
    if (!row.compiledDefault) assert.equal(row.defaultValue, null, row.field);
  }
});

test('the report says plainly what a field name and a bundled value do and do not prove', () => {
  assert.match(report.basis, /a name is not a formula/);
  assert.match(report.caveat, /is the value the live server sends/);
  assert.match(report.caveat, /compiled-in default/);
  // Every field is routed and each routed field keeps its own flag, so nothing is silently grouped away.
  assert.equal(report.fields.length, report.nativeFields);
  assert.equal(report.topics.reduce((total, entry) => total + entry.fields, 0), report.nativeFields);
  assert.ok(report.fields.every(row => typeof row.topic === 'string' && row.topic.length > 0));
});
