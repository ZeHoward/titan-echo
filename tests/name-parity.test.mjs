import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TT2_ARTIFACTS, TT2_HEROES, TT2_PETS, TT2_SETS } from '../lib/tt2-data.ts';
import { HERO_NAMES, PET_NAMES, SET_NAMES } from '../lib/zh-tw.ts';
import { SOURCE_NAMES } from '../lib/tt2-source-names.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';
const parity = JSON.parse(readFileSync(new URL('set-name-parity.json', referenceRoot), 'utf8'));

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
