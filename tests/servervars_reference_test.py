"""Regression tests for the server var override row policy; no APK or external packages."""
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REFERENCE = ROOT / 'reference/tt2/8.2.0'
sys.path.insert(0, str(ROOT / 'tools'))
from servervars_reference import TABLE, resolve_server_var_overrides

def row(key, value):
    return {'ServerVarsKey': key, 'Value': value}

class ServerVarOverrideTests(unittest.TestCase):
    def test_last_parsed_row_wins_and_keeps_every_occurrence(self):
        rows = [row('a', '1'), row('b', '2'), row('a', '3')]
        selected, ordinals, history = resolve_server_var_overrides(TABLE, rows)
        self.assertEqual(selected['a']['Value'], '3')
        self.assertEqual(ordinals, {'a': 2, 'b': 1})
        self.assertEqual([r['sourceOrdinal'] for r in history['a']], [0, 2])
        self.assertNotIn('b', history)

    def test_blank_keys_are_skipped_the_way_the_native_guard_skips_them(self):
        selected, ordinals, history = resolve_server_var_overrides(TABLE, [row('', '1'), row('   ', '2'), row('a', '3')])
        self.assertEqual(list(selected), ['a'])
        self.assertEqual(ordinals, {'a': 2})
        self.assertEqual(history, {})

    def test_ambiguous_or_changed_input_stops_the_import(self):
        for bad in ([row('a', '')], [row('a', '  ')], [row(' a', '1')]):
            with self.subTest(rows=bad), self.assertRaises(ValueError):
                resolve_server_var_overrides(TABLE, bad)
        changed = row('a', '1')
        changed['Extra'] = '1'
        with self.assertRaises(ValueError):
            resolve_server_var_overrides(TABLE, [changed])
        with self.assertRaises(ValueError):
            resolve_server_var_overrides('ServerVarsInfo', [row('a', '1')])

    def test_all_pinned_source_rows_replay_to_the_published_catalog(self):
        data = json.loads((REFERENCE / f'{TABLE}.json').read_text(encoding='utf-8'))
        source = {r['sourceOrdinal']: r['values'] for r in data['records']}
        for occurrences in data['rowResolution']['duplicateHistory'].values():
            for r in occurrences:
                source[r['sourceOrdinal']] = r['values']
        self.assertEqual(sorted(source), list(range(data['rowResolution']['sourceRows'])))
        selected, ordinals, _ = resolve_server_var_overrides(TABLE, [source[i] for i in sorted(source)])
        self.assertEqual(selected, {r['id']: r['values'] for r in data['records']})
        self.assertEqual(ordinals, {r['id']: r['sourceOrdinal'] for r in data['records']})

    def test_resolution_does_not_mutate_source_rows(self):
        rows = [row('a', '1'), row('a', '2')]
        selected, _, history = resolve_server_var_overrides(TABLE, rows)
        selected['a']['Value'] = '9'
        history['a'][0]['values']['Value'] = '8'
        self.assertEqual([r['Value'] for r in rows], ['1', '2'])

class ScheduledBonusDeferralTests(unittest.TestCase):
    def test_scheduled_bonus_stays_out_of_the_catalog_with_its_reason_recorded(self):
        quarantine = json.loads((REFERENCE / 'quarantine.json').read_text(encoding='utf-8'))
        deferred = {entry['table']: entry for entry in quarantine['tables']}
        self.assertIn('ScheduledBonusInfo', deferred)
        self.assertEqual(deferred['ScheduledBonusInfo']['status'], 'not-imported')
        self.assertFalse((REFERENCE / 'ScheduledBonusInfo.json').exists())
        manifest = json.loads((REFERENCE / 'manifest.json').read_text(encoding='utf-8'))
        self.assertNotIn('ScheduledBonusInfo', [t['table'] for t in manifest['tables']])

if __name__ == '__main__':
    unittest.main()
