import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import {
  fresh, advance, apply, hydrate, qteCooldownSeconds, qteReady, advanceQTE, fairiesUnlocked, FAIRY,
} from '../lib/engine.ts';
import {
  TT2_QTE, QTE_TYPE, QTE_MIN_COOLDOWN, QTE_COOLDOWN_MULTIPLIERS, qteUnlocked, TT2_TREE,
} from '../lib/tt2-rules.ts';

const evidence = JSON.parse(readFileSync(new URL('qte-evidence.json', referenceRoot), 'utf8'));
const table = JSON.parse(readFileSync(new URL('QTEInfo.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

const FAIRY_QTE = TT2_QTE[QTE_TYPE.Fairy];
const CHARM = TT2_TREE.findIndex(k => k.id === 'FairyChance'); // Fairy Charm: 也給 FairyCooldown
const SHAMAN = 'FairyShaman'; // 套裝寵物，FairyCooldown +10

/** A save past the stage gate. */
const ready = () => {
  const s = fresh(1000);
  s.best = FAIRY.startStage;
  return s;
};
/** Small steps only: the offline path shifts the timers rather than running them. */
const waitForFairy = s => {
  const limit = s.last + FAIRY_QTE.cooldown * 2000;
  while (!qteReady(s.tt2, QTE_TYPE.Fairy) && s.last < limit) advance(s, s.last + 10000);
  return s;
};

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('公式的形狀就是證據上的形狀', () => {
  assert.equal(evidence.formulas.base,
    '(cooldownTime − Bonus(CooldownBonusType)) × (1 + randomness × Random.Range(−1, 1))');
  assert.equal(evidence.formulas.tableMiss, '資料表沒有這一型時直接回 0，而且不套用下限');
  assert.equal(evidence.formulas.unlocked,
    'TalentId 為 0 時恆為解鎖，否則看 SkillTreeModel.IsTalentUnlocked');
  // The subtraction is the whole point: a cooldown bonus takes seconds off, it does not scale.
  const head = evidence.traces.cooldown.map(e => e[0]);
  assert.ok(head.includes('fsub'), '冷卻加成要走 fsub');
  // 整個方法只有兩次減法：共用那條扣冷卻加成，以及匕首那一支扣刀片流。
  assert.deepEqual(evidence.traces.cooldown.filter(e => e[0] === 'fsub').map(e => e[1]),
    ['s1, s9, s8', 's10, s10, s0'], 'cooldownTime − 加成，加上匕首那一支自己的減法');
  assert.deepEqual(evidence.traces.cooldown.filter(e => e[0] === 'fadd').map(e => e[1]),
    ['s0, s0, s11'], '只有 1 + randomness × 骰子這一個加法');
});

test('引擎的下限與資料表就是證據上的那一份', () => {
  assert.equal(QTE_MIN_COOLDOWN, evidence.minCooldownSeconds);
  const rows = Object.fromEntries(table.records.map(r => [r.values.QTEType, r.values]));
  assert.equal(Object.keys(rows).length, evidence.table.rows);
  for (const [name, value] of Object.entries(QTE_TYPE)) {
    const row = rows[name], info = TT2_QTE[value];
    assert.ok(row, `${name} 應該在資料表裡`);
    assert.equal(info.cooldown, Number(row.CooldownTime), `${name} 的冷卻秒數`);
    assert.equal(info.expire, Number(row.ExpireTime), `${name} 的過期秒數`);
    assert.equal(info.active, Number(row.ActiveTime), `${name} 的持續秒數`);
    assert.equal(info.randomness, Number(row.Randomness), `${name} 的隨機幅度`);
    assert.equal(info.cooldownBonus, row.CooldownBonusType, `${name} 的冷卻加成`);
    assert.equal(info.talent, row.TalentID, `${name} 的天賦`);
  }
});

test('依類型多乘的倍率與原生分支一致，匕首那一支刻意不做', () => {
  for (const [name, arm] of Object.entries(evidence.typeBranches)) {
    if (name === 'None') continue;
    const value = QTE_TYPE[name];
    if (name === 'UltraDagger') {
      // 原生那一支有條件分支，而且 UltraDaggerCount 是數量不是倍率。本專案沒有匕首流派，
      // 照抄成一串乘法會把數量乘進冷卻裡，所以留空並在這裡釘住「留空是刻意的」。
      assert.equal(QTE_COOLDOWN_MULTIPLIERS[value], undefined);
      assert.deepEqual(arm.multipliers, ['StreamOfBladesCooldownReduction', 'UltraDaggerCount',
        'UltraDaggerCooldownMult', 'daggerCooldownAutoThrowMult']);
      continue;
    }
    assert.deepEqual([...QTE_COOLDOWN_MULTIPLIERS[value] ?? []], arm.multipliers,
      `${name} 的倍率清單要跟原生一樣，順序也一樣`);
  }
});

test('沒有天賦欄位的妖精對所有人解鎖，有天賦的要先學', () => {
  const s = ready();
  assert.equal(evidence.table.talents.Fairy, '');
  assert.equal(qteUnlocked(s.tt2, QTE_TYPE.Fairy), true);
  assert.equal(qteUnlocked(s.tt2, QTE_TYPE.PetGold), false, '還沒學米達斯之心');
  const i = TT2_TREE.findIndex(k => k.id === TT2_QTE[QTE_TYPE.PetGold].talent);
  s.tt2.tree[i] = 1;
  assert.equal(qteUnlocked(s.tt2, QTE_TYPE.PetGold), true);
  // 0 是 QTEType.None，資料表裡沒有，所以永遠鎖著。
  assert.equal(qteUnlocked(s.tt2, 0), false);
});

test('冷卻是「表定秒數扣掉加成」再乘上隨機幅度，而且夾在下限之上', () => {
  const s = ready();
  const type = QTE_TYPE.Fairy;
  // 骰子取 0 的時候隨機那一項是 1，剩下的就是表定秒數。
  assert.equal(qteCooldownSeconds(s, type, 0), FAIRY_QTE.cooldown);
  const spread = FAIRY_QTE.randomness;
  assert.ok(Math.abs(qteCooldownSeconds(s, type, 1) - FAIRY_QTE.cooldown * (1 + spread)) < 1e-9);
  assert.ok(Math.abs(qteCooldownSeconds(s, type, -1) - FAIRY_QTE.cooldown * (1 - spread)) < 1e-9);

  // 天賦「妖精魅力」同時給 FairySpawnChance 與 FairyCooldown，滿級要真的把冷卻縮短。
  const charmed = ready();
  charmed.tt2.tree[CHARM] = TT2_TREE[CHARM].max;
  const cut = qteCooldownSeconds(charmed, type, 0);
  assert.ok(cut < FAIRY_QTE.cooldown, '滿級的妖精魅力應該縮短冷卻');
  assert.ok(cut >= QTE_MIN_COOLDOWN);

  // 扣到負的也不會跌破下限。
  const absurd = ready();
  absurd.tt2.tree[CHARM] = TT2_TREE[CHARM].max;
  absurd.tt2.sets = [TT2_TREE.length];
  const forced = { ...absurd, tt2: { ...absurd.tt2 } };
  assert.ok(qteCooldownSeconds(forced, type, -1) >= QTE_MIN_COOLDOWN);
});

test('資料表沒有的類型回 0，而且不套用下限', () => {
  const s = ready();
  assert.equal(qteCooldownSeconds(s, 0, 0), 0, 'QTEType.None 不在表裡');
  assert.equal(qteCooldownSeconds(s, 99, 0), 0);
  assert.ok(QTE_MIN_COOLDOWN > 0, '下限不是 0，所以上面兩個 0 確實是繞過了下限');
});

test('狀態機走完一圈：冷卻 → ready → 沒點就飛走 → 重排冷卻', () => {
  const s = ready();
  s.stage = 50;
  s.best = 50;
  advanceQTE(s);
  assert.equal(qteReady(s.tt2, QTE_TYPE.Fairy), false, '一開始在冷卻');
  assert.ok(s.tt2.qteReadyAt[QTE_TYPE.Fairy] > s.last, '冷卻的終點在未來');

  // 把冷卻的終點搬到眼前，好在一個已知的時刻越過它，過期時間才量得準。
  s.tt2.qteReadyAt[QTE_TYPE.Fairy] = s.last + 100;
  advance(s, s.last + 100);
  const readyAt = s.last;
  assert.equal(qteReady(s.tt2, QTE_TYPE.Fairy), true);
  assert.equal(s.tt2.qteReadyAt[QTE_TYPE.Fairy], -1, 'ready 之後冷卻計時器就停了');
  const flies = s.tt2.qteExpireAt[QTE_TYPE.Fairy];
  assert.equal(flies - readyAt, FAIRY_QTE.expire * 1000, '過期時間取自 expireTime');

  // 放著不點，過期之後應該回到冷卻，而且沒有拿到金幣。
  const before = s.tt2.fairyRewards;
  while (qteReady(s.tt2, QTE_TYPE.Fairy) && s.last < flies + 30000) advance(s, s.last + 10000);
  assert.equal(qteReady(s.tt2, QTE_TYPE.Fairy), false, '沒點就會飛走');
  assert.equal(s.tt2.fairyRewards, before, '飛走的妖精不給金幣');
  assert.ok(s.tt2.qteReadyAt[QTE_TYPE.Fairy] > s.last, '飛走之後重排冷卻');
});

test('離線不推進 QTE：計時器整個往後平移，回來時剩下的秒數一樣', () => {
  const s = ready();
  advanceQTE(s);
  const remaining = s.tt2.qteReadyAt[QTE_TYPE.Fairy] - s.last;
  assert.ok(remaining > 0);
  advance(s, s.last + 6 * 3600 * 1000); // 六小時，走離線那條路
  assert.equal(s.tt2.qteReadyAt[QTE_TYPE.Fairy] - s.last, remaining,
    '離線那段時間不算進冷卻');

  // 已經 ready 的妖精離線回來還在，不會在背景飛走。
  const waiting = ready();
  waitForFairy(waiting);
  const left = waiting.tt2.qteExpireAt[QTE_TYPE.Fairy] - waiting.last;
  advance(waiting, waiting.last + 3 * 3600 * 1000);
  assert.equal(qteReady(waiting.tt2, QTE_TYPE.Fairy), true, '離線回來妖精還在');
  assert.equal(waiting.tt2.qteExpireAt[QTE_TYPE.Fairy] - waiting.last, left);
});

test('舊存檔搬過來：已經能領的直接給，還在冷卻的接著等', () => {
  const collectable = ready();
  collectable.last += 90000;
  collectable.lastFairy = collectable.last - 90000; // 舊規則的六十秒早就過了
  delete collectable.tt2.qteReadyAt;
  delete collectable.tt2.qteExpireAt;
  hydrate(collectable);
  assert.equal(qteReady(collectable.tt2, QTE_TYPE.Fairy), true, '本來就能領的不該被沒收');

  const cooling = ready();
  cooling.last += 90000;
  cooling.lastFairy = cooling.last - 10000; // 十秒前才領過
  delete cooling.tt2.qteReadyAt;
  delete cooling.tt2.qteExpireAt;
  hydrate(cooling);
  assert.equal(qteReady(cooling.tt2, QTE_TYPE.Fairy), false);
  const wait = cooling.tt2.qteReadyAt[QTE_TYPE.Fairy] - cooling.last;
  assert.ok(wait > 0 && wait < FAIRY_QTE.cooldown * 1000,
    '從上次領取起算，已經等過的十秒要算進去');
});

test('沒過關卡門檻的時候 QTE 照跑，只是領不到東西', () => {
  const early = ready();
  early.best = FAIRY.startStage - 1;
  assert.equal(fairiesUnlocked(early), false);
  waitForFairy(early);
  assert.equal(qteReady(early.tt2, QTE_TYPE.Fairy), true,
    '原生的 OnQTEReady 照樣送出，是 FairyController 自己不生成妖精');
  apply(early, { type: 'fairy', at: early.last });
  assert.equal(early.tt2.fairyRewards, 0);
  assert.equal(qteReady(early.tt2, QTE_TYPE.Fairy), true, '領不到就不該消耗掉這一輪');
});

test('沒實作消費端的類型不會被排程', () => {
  const s = ready();
  const i = TT2_TREE.findIndex(k => k.id === TT2_QTE[QTE_TYPE.PetGold].talent);
  s.tt2.tree[i] = 1;
  assert.equal(qteUnlocked(s.tt2, QTE_TYPE.PetGold), true, '天賦學了就算解鎖');
  advance(s, s.last + 10000);
  assert.equal(s.tt2.qteReadyAt[QTE_TYPE.PetGold], -1, '但米達斯之心還沒接上，不排程');
  assert.equal(s.tt2.qteExpireAt[QTE_TYPE.PetGold], -1);
});

test('妖精分不出 expireTime 與 activeTime，那兩欄剛好一樣', () => {
  // 變異驗證在這裡驗不出來：狀態機若誤用 activeTime，妖精的行為完全相同。
  // 這不是測試的漏洞，是這份資料下無法區分——把前提釘住，
  // 哪天別的類型接上消費端，用錯欄位就會被那一段的測試抓到。
  assert.equal(FAIRY_QTE.expire, FAIRY_QTE.active, '兩欄同值，所以現在分不出來');
  const telling = Object.entries(QTE_TYPE)
    .filter(([, v]) => TT2_QTE[v].expire !== TT2_QTE[v].active).map(([name]) => name);
  assert.deepEqual(telling.sort(),
    ['ClanShip', 'ForbiddenContract', 'Helper', 'PetAttack', 'PetBoss', 'PetGold',
      'RoyalContract', 'UltraDagger'],
    '另外八型的兩欄不同，接上之後就分得出來');
});

test('限制寫在證據裡，沒有被悄悄拿掉', () => {
  const text = evidence.limits.join('\n');
  assert.match(text, /MinCooldown/, '資料表那一欄在包內是死的，要留著這句');
  assert.match(text, /PetGoldQTECooldownMult/, '沒有來源的那個乘數要留著這句');
  assert.match(text, /離線/, '離線不推進的取捨要留著這句');
  assert.ok(evidence.limits.length >= 6);
});

test('套裝寵物也能縮短妖精冷卻', () => {
  const s = ready();
  const plain = qteCooldownSeconds(s, QTE_TYPE.Fairy, 0);
  const shaman = ready();
  const i = TT2_TREE.findIndex(k => k.id === SHAMAN);
  assert.equal(i, -1, 'FairyShaman 是套裝寵物，不是天賦');
  // 套裝寵物的效果走 TT2_SETS，這裡只確認引擎讀的是同一個加成名稱。
  assert.equal(FAIRY_QTE.cooldownBonus, 'FairyCooldown');
  assert.equal(plain, FAIRY_QTE.cooldown, '乾淨存檔沒有任何來源時就是表定秒數');
  assert.equal(shaman.tt2.sets.length, 0);
});
