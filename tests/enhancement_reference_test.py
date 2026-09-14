"""Regression tests for the actual Python import policy; no APK or external packages."""
import importlib.util
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
from enhancement_reference import TABLE, resolve_enhancements

def row(power, identity='AllActiveSkillAmount'):
    return dict(BonusType=identity, AttributeBase='0.001', PowerBase='1', PowerInc='2E-4', PowerExp=power)

class EnhancementImportTests(unittest.TestCase):
    def test_last_row_wins_and_preserves_exact_decimal_text(self):
        selected, ordinals, history = resolve_enhancements(TABLE, [row('0.4'), row('1.002')], {'AllActiveSkillAmount'})
        self.assertEqual(selected['AllActiveSkillAmount']['PowerExp'], '1.002')
        self.assertEqual(selected['AllActiveSkillAmount']['PowerInc'], '2E-4')
        self.assertEqual(ordinals['AllActiveSkillAmount'], 1)
        self.assertEqual([r['values']['PowerExp'] for r in history['AllActiveSkillAmount']], ['0.4', '1.002'])
        reverse, _, _ = resolve_enhancements(TABLE, [row('1.002'), row('0.4')], {'AllActiveSkillAmount'})
        self.assertEqual(reverse['AllActiveSkillAmount']['PowerExp'], '0.4')

    def test_all_pinned_source_rows_replay_to_the_published_catalog(self):
        data = json.loads((ROOT/'reference/tt2/8.2.0'/f'{TABLE}.json').read_text())
        source = {r['sourceOrdinal']: r['values'] for r in data['records']}
        for occurrences in data['rowResolution']['duplicateHistory'].values():
            for r in occurrences:
                source[r['sourceOrdinal']] = r['values']
        self.assertEqual(sorted(source), list(range(59)))
        selected, ordinals, _ = resolve_enhancements(TABLE, [source[i] for i in sorted(source)],
            {r['id'] for r in data['records']})
        self.assertEqual(selected, {r['id']: r['values'] for r in data['records']})
        self.assertEqual(ordinals, {r['id']: r['sourceOrdinal'] for r in data['records']})

    def test_bad_cells_fail_closed_instead_of_silently_replacing_a_valid_row(self):
        for value in ['', '-', 'NaN', 'Infinity', '1e999', 'not-a-number']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                resolve_enhancements(TABLE, [row('0.4'), row(value)], {'AllActiveSkillAmount'})

    def test_unknown_ids_and_changed_schema_require_review(self):
        with self.assertRaises(ValueError):
            resolve_enhancements(TABLE, [row('1', 'UnknownBonus')], {'AllActiveSkillAmount'})
        changed = row('1'); changed['NewColumn'] = '1'
        with self.assertRaises(ValueError):
            resolve_enhancements(TABLE, [changed], {'AllActiveSkillAmount'})

    def test_overwrite_is_not_a_global_duplicate_policy(self):
        with self.assertRaises(ValueError):
            resolve_enhancements('ArtifactInfo', [row('1')], {'AllActiveSkillAmount'})
        spec = importlib.util.spec_from_file_location('import_reference', ROOT/'tools/import-reference-v8.py')
        importer = importlib.util.module_from_spec(spec); spec.loader.exec_module(importer)
        with self.assertRaisesRegex(ValueError, 'duplicate stable ID'):
            importer.index([{'ArtifactID': 'Artifact1'}, {'ArtifactID': 'Artifact1'}], ['ArtifactID'])

    def test_resolution_does_not_mutate_source_rows(self):
        rows = [row('0.4'), row('1.002')]
        selected, _, history = resolve_enhancements(TABLE, rows, {'AllActiveSkillAmount'})
        selected['AllActiveSkillAmount']['PowerExp'] = '3'
        history['AllActiveSkillAmount'][0]['values']['PowerExp'] = '4'
        self.assertEqual([r['PowerExp'] for r in rows], ['0.4', '1.002'])

if __name__ == '__main__':
    unittest.main()
