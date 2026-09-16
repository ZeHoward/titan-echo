import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TT2_ACTIVE, TT2_ARTIFACTS, TT2_HEROES, TT2_PETS, TT2_SETS, TT2_TREE } from '../lib/tt2-data.ts';
import { HERO_NAMES, PET_NAMES, SET_NAMES, TALENT_NAMES } from '../lib/zh-tw.ts';
import { SKILLS } from '../lib/engine.ts';
import { SOURCE_NAMES } from '../lib/tt2-source-names.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';
const parity = JSON.parse(readFileSync(new URL('set-name-parity.json', referenceRoot), 'utf8'));
const skillParity = JSON.parse(readFileSync(new URL('skill-name-parity.json', referenceRoot), 'utf8'));

test('hero, pet and artifact names come from the official strings this project imported', () => {
  for (const hero of TT2_HEROES) {
    assert.equal(HERO_NAMES[hero.name], SOURCE_NAMES[`HELPERNAME_${hero.id}`], hero.id);
  }
  for (const pet of TT2_PETS) {
    assert.equal(PET_NAMES[pet.name], SOURCE_NAMES[`PET_NAME_${pet.id}`], pet.id);
  }
  for (const artifact of TT2_ARTIFACTS) {
    assert.equal(artifact.name, SOURCE_NAMES[`ARTIFACT_NAME_${artifact.id}`], artifact.id);
  }
  assert.equal(TT2_HEROES.length + TT2_PETS.length + TT2_ARTIFACTS.length, 170);
});

test('set names are official where the package names them, and flagged where it does not', () => {
  const official = TT2_SETS.filter(set => SOURCE_NAMES[`EQUIPMENT_SET_${set.id}`]);
  for (const set of official) {
    assert.equal(SET_NAMES[set.id], SOURCE_NAMES[`EQUIPMENT_SET_${set.id}`], set.id);
  }
  assert.equal(official.length, 158);
  // Every set the project shows still has a readable name, official or not.
  for (const set of TT2_SETS) assert.ok(SET_NAMES[set.id], set.id);
});

test('the three names the package does not usably supply are recorded with the reason', () => {
  const flagged = Object.fromEntries(parity.entries.map(entry => [entry.id, entry]));
  assert.equal(parity.flagged, 23);
  // Two official Traditional Chinese strings still contain English, so copying them verbatim
  // would import the package's own mixed-language text.
  assert.equal(flagged.ScrollMaster.status, 'partly-untranslated');
  assert.equal(flagged.ScrollMaster.english, 'Elysian Guardian');
  assert.match(flagged.ScrollMaster.chineseTrad, /Elysian/);
  assert.equal(flagged.DaggerRogue.status, 'partly-untranslated');
  assert.match(flagged.DaggerRogue.chineseTrad, /Razorfist/);
  // The third is a template that wraps another name rather than naming a set.
  assert.equal(flagged.Corrupted.status, 'template');
  assert.match(flagged.Corrupted.english, /\{0\}/);
  for (const id of ['ScrollMaster', 'DaggerRogue', 'Corrupted']) {
    assert.equal(SOURCE_NAMES[`EQUIPMENT_SET_${id}`], undefined, `${id} 不應被當成官方名匯入`);
    assert.ok(SET_NAMES[id], id);
  }
  assert.match(parity.note, /not copied verbatim/);
});

test('twenty sets have no name in the package at all, in any language', () => {
  const unnamed = parity.entries.filter(entry => entry.status === 'not-named-in-package');
  assert.equal(unnamed.length, 20);
  for (const entry of unnamed) {
    assert.equal(entry.english, undefined, entry.id);
    assert.equal(entry.chineseTrad, undefined, entry.id);
  }
  // The parity file covers the full 8.2 set catalog, which is larger than the runtime list.
  assert.equal(parity.sets, 209);
  assert.ok(parity.sets > TT2_SETS.length);
});

test('六個主動技能的名稱逐字等於安裝包的字串', () => {
  assert.equal(skillParity.activeSkills.total, TT2_ACTIVE.length);
  assert.equal(skillParity.activeSkills.flagged, 0, '有技能的官方字串不能直接採用');
  for (const skill of SKILLS) {
    const official = SOURCE_NAMES[`ACTIVE_SKILL_NAME_${skill.id ?? ''}`];
    assert.ok(skill.name, '技能沒有名稱');
    // The name has to be one of the imported official strings, not something typed in.
    assert.ok(Object.values(skillParity.activeSkills.official).includes(skill.name), `${skill.name} 不是官方字串`);
    assert.ok(official === undefined || official === skill.name);
  }
  // 戰爭狂吼 is the package's spelling; this project used 戰爭狂嚎 until the strings were compared.
  assert.ok(SKILLS.some(skill => skill.name === '戰爭狂吼'));
  assert.ok(!SKILLS.some(skill => skill.name === '戰爭狂嚎'));
  // The effect labels name the same skill, so the old spelling must not survive anywhere it shows.
  for (const [file, source] of [
    ['lib/tt2-rules.ts', readFileSync(new URL('../lib/tt2-rules.ts', import.meta.url), 'utf8')],
    ['lib/zh-tw.ts', readFileSync(new URL('../lib/zh-tw.ts', import.meta.url), 'utf8')],
    ['app/game.tsx', readFileSync(new URL('../app/game.tsx', import.meta.url), 'utf8')],
  ]) {
    assert.ok(!source.includes('戰爭狂嚎'), `${file} 仍使用舊寫法`);
  }
});

test('天賦名稱：能照抄的都照抄，照抄不了的四個有記錄原因', () => {
  assert.equal(skillParity.talents.total, TT2_TREE.length);
  const flagged = new Map(skillParity.talents.entries.map(entry => [entry.id, entry]));
  assert.equal(flagged.size, 4, `旗標數變成 ${flagged.size}`);
  let copied = 0;
  for (const talent of TT2_TREE) {
    const shown = TALENT_NAMES[talent.name];
    assert.ok(shown, `${talent.id} 沒有中文名稱`);
    const entry = flagged.get(talent.id);
    if (entry) {
      // A flagged string is not copied: the package text itself still carries English.
      assert.equal(entry.status, 'partly-untranslated', talent.id);
      assert.match(entry.chineseTrad, /[A-Za-z]/, `${talent.id} 被標記卻沒有英文`);
      assert.notEqual(shown, entry.chineseTrad, `${talent.id} 照抄了含英文的字串`);
      assert.doesNotMatch(shown, /[A-Za-z]/, `${talent.id} 的現用名稱含英文`);
      continue;
    }
    assert.equal(shown, SOURCE_NAMES[`SKILLTREE_${talent.id.toUpperCase()}`], `${talent.id} 與官方不同`);
    copied += 1;
  }
  assert.equal(copied, TT2_TREE.length - 4);
});

test('官方名稱清單本身可重算，主題名稱不會因為重跑匯入而消失', () => {
  // Rerunning tools/import-apk-reference.py used to drop the fourteen background names, because they
  // were added outside it; they are part of the same import now.
  const backgrounds = Object.keys(SOURCE_NAMES).filter(key => key.startsWith('BACKGROUND_NAME_'));
  assert.equal(backgrounds.length, 14);
  const skills = Object.keys(SOURCE_NAMES).filter(key => key.startsWith('ACTIVE_SKILL_NAME_'));
  assert.equal(skills.length, 6);
  for (const value of Object.values(SOURCE_NAMES)) {
    assert.doesNotMatch(value, /[A-Za-z{}<>]/, `官方名稱清單混入未譯字串：${value}`);
  }
});
