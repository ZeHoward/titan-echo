import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION, RELEASES } from '../lib/releases.ts';

const source = readFileSync(new URL('../lib/releases.ts', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the package version and the version the game shows are the same', () => {
  assert.equal(pkg.version, APP_VERSION);
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});

test('only the newest entry carries APP_VERSION, so no two entries share a version', () => {
  // An older entry left on APP_VERSION silently relabels itself on every release,
  // which put two entries under the same version in the shipped changelog.
  assert.equal(source.match(/\{version:APP_VERSION,/g).length, 1);
  assert.equal(RELEASES[0].version, APP_VERSION);
  const numbered = RELEASES.filter(entry => entry.version).map(entry => entry.version);
  assert.equal(new Set(numbered).size, numbered.length);
});

test('every entry is readable: a date, a title and at least one change line', () => {
  for (const entry of RELEASES) {
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, entry.title);
    assert.ok(entry.title.length > 0, entry.date);
    assert.ok(entry.changes.length > 0, entry.title);
    for (const change of entry.changes) assert.ok(change.trim().length > 0, entry.title);
  }
  // The list reads newest first, which is the order the release page renders.
  const dates = RELEASES.map(entry => entry.date);
  assert.deepEqual([...dates].sort().reverse(), dates);
});
