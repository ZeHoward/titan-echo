import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { MONSTERS, MONSTER_SHEETS, monsterSheet, sheetWarmOrder } from '../lib/content.ts';

const url = name => new URL(`../${name}`, import.meta.url);
const read = name => readFileSync(url(name), 'utf8');
const PUBLIC = url('public/');

/** Every `${basePath}file` the app asks the browser for. */
function requestedFiles() {
  const found = new Set();
  for (const file of ['app/game.tsx', 'app/game-content.tsx', 'app/tt2-panels.tsx', 'app/cloud-save.tsx', 'app/release-notes.tsx']) {
    for (const match of read(file).matchAll(/\$\{basePath\}([\w./-]+)/g)) found.add(match[1]);
    for (const match of read(file).matchAll(/basePath\+'([\w./-]+)'/g)) found.add(match[1]);
  }
  for (const match of read('app/globals.css').matchAll(/url\(['"]?([^)'"]+)['"]?\)/g)) found.add(match[1].replace(/^\//, ''));
  return found;
}

test('每個怪物都指向存在的圖集，五張圖集全部用得到', () => {
  assert.equal(MONSTERS.length, 60);
  assert.deepEqual(MONSTER_SHEETS, ['monsters-atlas.webp', 'monsters-2.webp', 'monsters-3.webp', 'monsters-4.webp', 'monsters-5.webp']);
  for (const monster of MONSTERS) {
    const sheet = monsterSheet(monster.id);
    assert.equal(sheet, MONSTER_SHEETS[monster.sheet], `怪物 ${monster.id}`);
    assert.ok(statSync(new URL(sheet, PUBLIC)).size > 0, `${sheet} 不存在`);
  }
  // The battle view can be one monster past the end of the table while a stage rolls over.
  assert.equal(monsterSheet(60), monsterSheet(0));
  assert.equal(monsterSheet(-1), monsterSheet(59));
});

test('預載順序把畫面上那張排第一，接著才是下一隻怪要用的那張', () => {
  for (let index = 0; index < 60; index += 1) {
    const order = sheetWarmOrder(index);
    assert.equal(order[0], monsterSheet(index), `索引 ${index} 的第一張不是畫面上那張`);
    assert.equal(new Set(order).size, order.length, `索引 ${index} 有重複`);
    assert.deepEqual([...order].sort(), [...MONSTER_SHEETS].sort(), `索引 ${index} 沒有涵蓋全部圖集`);
    // The next entry is the sheet the battle asks for next, not an arbitrary leftover.
    let next = index + 1;
    while (monsterSheet(next) === order[0]) next += 1;
    assert.equal(order[1], monsterSheet(next), `索引 ${index} 的第二張不是下一張要用的`);
  }
});

test('載入時不再一次抓走全部圖集：最先只暖畫面上那張，其餘走閒置排程', () => {
  const source = read('app/game.tsx');
  // The mount-time fetch is derived from the monster on screen, never a hardcoded sheet list.
  for (const sheet of MONSTER_SHEETS) assert.ok(!source.includes(`'${sheet}'`), `game.tsx 仍寫死 ${sheet}`);
  assert.ok(source.includes('warmImage(currentSheet)'), '沒有先暖畫面上那張圖集');
  assert.ok(source.includes('sheetWarmOrder('), '其餘圖集沒有照預載順序補');
  assert.ok(source.includes('requestIdleCallback'), '其餘圖集沒有排在閒置時段');
});

test('戰鬥畫面只請求 WebP，沒有留下會落空的 PNG 路徑', () => {
  for (const file of requestedFiles()) {
    if (!/\.(png|webp|svg|jpg)$/.test(file)) continue;
    assert.ok(file.endsWith('.webp'), `${file} 不是 WebP 衍生檔`);
    assert.ok(statSync(new URL(file, PUBLIC)).size > 0, `${file} 不在 public/`);
  }
});

test('public/ 只放實際會被請求的檔案，原始 PNG 留在 art/', () => {
  const served = readdirSync(PUBLIC).filter(name => statSync(new URL(name, PUBLIC)).isFile());
  // favicon.svg has no reference in the source: the browser asks for it by convention.
  // The sheets are named by monsterSheet() rather than written into the markup.
  const expected = [...requestedFiles(), ...MONSTER_SHEETS, 'favicon.svg'].filter(name => !name.includes('/'));
  assert.deepEqual(served.sort(), [...new Set(expected)].sort());
  assert.ok(!served.some(name => name.endsWith('.png')), `public/ 又出現原始 PNG：${served.filter(n => n.endsWith('.png'))}`);
  const originals = readdirSync(url('art/'));
  for (const sheet of [...MONSTER_SHEETS, 'worlds-atlas.webp', 'swordsman.webp']) {
    assert.ok(originals.includes(sheet.replace('.webp', '.png')), `${sheet} 沒有保留原始 PNG`);
  }
});

test('WebP 衍生檔比原始 PNG 小，劍士圖不再是首載最大的檔案', () => {
  const size = (dir, name) => statSync(url(`${dir}/${name}`)).size;
  for (const sheet of [...MONSTER_SHEETS, 'worlds-atlas.webp', 'swordsman.webp']) {
    const png = sheet.replace('.webp', '.png');
    assert.ok(size('public', sheet) < size('art', png), `${sheet} 沒有比 ${png} 小`);
  }
  assert.ok(size('public', 'swordsman.webp') < 200_000, '劍士圖仍超過 200KB');
});
