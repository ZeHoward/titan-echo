import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';

const evidence = JSON.parse(readFileSync(new URL('equipment-drop-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const engine = readFileSync(new URL('../lib/engine.ts', import.meta.url), 'utf8');

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.match(evidence.binarySha256, /^[0-9a-f]{64}$/);
  assert.match(evidence.scriptSha256, /^[0-9a-f]{64}$/);
});

test('掉落的時機是客戶端算的，掉落的內容是伺服器給的', () => {
  assert.ok(evidence.clientSide.dropStage.rva.startsWith('0x'));
  // 三個方法合起來才是完整的往返：送出、收回、解析。少記一個就不足以支撐「不是客戶端算的」。
  const outcome = Object.keys(evidence.serverOutcome);
  assert.ok(outcome.includes('EquipmentController$$CollectRequest'));
  assert.ok(outcome.includes('EquipmentController$$ProcessEquipmentRewardList'));
  assert.ok(outcome.includes('EquipmentModel$$ParseEquipmentInfo'));
  for (const fact of Object.values(evidence.serverOutcome)) assert.match(fact.rva, /^0x[0-9a-f]+$/);
  for (const field of ['裝備 ID', '等級', '鎖定狀態', '副屬性清單']) {
    assert.ok(evidence.parsedFromResponse.includes(field), `沒有記錄 ${field} 來自回應`);
  }
});

test('四個伺服器變數的位移與預設值都記下來了，而且標明是可被線上覆蓋的預設值', () => {
  const vars = evidence.serverVariables;
  assert.equal(vars.equipmentStageMin.defaultValue, 16);
  assert.equal(vars.equipmentStageDelta.defaultValue, 20);
  assert.equal(vars.equipmentLevelReductionMin.defaultValue, 357803);
  for (const [name, fact] of Object.entries(vars)) {
    assert.match(fact.offset, /^0x[0-9a-f]+$/, `${name} 沒有位移`);
    assert.equal(fact.status, 'default', `${name} 不該被當成線上實際值`);
  }
});

test('引擎的掉落關卡與原生算式逐關相同', () => {
  const min = evidence.serverVariables.equipmentStageMin.defaultValue;
  const delta = evidence.serverVariables.equipmentStageDelta.defaultValue;
  // 原生計數 0 起算（回退路徑問的是 extraEquipmentDrops.Contains(關卡 + 1)），
  // 所以玩家看到的第 n 關在原生是 n - 1。
  const native = shown => {
    const step = (shown - 1) - min + 1;
    return step >= 0 && step % delta === 0;
  };
  const ours = shown => shown >= 16 && (shown - 16) % 20 === 0;
  for (let shown = 1; shown <= 98000; shown++) {
    assert.equal(ours(shown), native(shown), `第 ${shown} 關兩邊不一致`);
  }
  assert.ok(native(16) && native(36) && native(56));
  assert.ok(!native(15) && !native(17) && !native(35));
  // 引擎裡真的是這個條件，不是測試自己算給自己看的。
  // 條件住在 clearStage 裡，跳關時逐關跑一次，所以跳過去的掉落關卡不會漏掉也不會重複。
  assert.ok(engine.includes('cleared>=16&&(cleared-16)%20===0'), 'lib/engine.ts 的掉落條件變了');
});

test('高等級遞減記成惰性條款，沒有被當成可玩範圍內的公式', () => {
  const rule = evidence.clientSide.effectiveLevel;
  assert.equal(rule.inertBelow, 357803);
  assert.match(rule.rule, /floor/);
  // 關卡上限 98000，掉落等級遠在門檻以下，所以引擎沒有實作它是對的而不是漏掉。
  assert.ok(!engine.includes('equipmentLevelReduction'), 'engine 出現了不該生效的遞減');
});

test('引擎沒有偷偷長出一套自稱原版的掉落抽選', () => {
  // 這份證據存在的理由：掉落內容只能從伺服器回應得知，
  // 在那之前 lib/ 不可以出現宣稱是原生的等級／品質分布。要實作就得刻意改這個測試。
  const collection = readFileSync(new URL('../lib/tt2-collection.ts', import.meta.url), 'utf8');
  assert.ok(/web approximation/i.test(collection), 'dropGear 不再標明自己是網頁近似');
  for (const word of ['EquipmentReward', 'ParseEquipmentInfo', 'secondaryBonus']) {
    assert.ok(!collection.includes(word), `lib/tt2-collection.ts 出現 ${word}`);
  }
});
